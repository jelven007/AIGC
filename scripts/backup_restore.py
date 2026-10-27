"""加密数据库/Storage/历史密钥备份；仅向空的隔离环境恢复。"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import uuid

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ("public", "auth", "storage", "extensions", "shopro_deploy", "supabase_migrations")
COUNT_TABLES = ("auth.users", "storage.objects", "public.credit_logs", "public.user_plans",
                "public.orders", "public.video_jobs", "public.production_jobs",
                "public.model_config_versions", "public.operator_mutations",
                "public.media_deletions", "public.voice_deletions", "public.operations_alerts",
                "public.operations_alert_events", "public.operations_alert_deliveries",
                "public.platform_apps", "public.platform_connections", "public.platform_oauth_states",
                "public.measurement_sources")
CHUNK = 4 * 1024 * 1024


class BackupError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def protected_file(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise BackupError("private_file_permissions")
    return path


def inside(directory, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise BackupError("invalid_artifact_path")
    path = directory / relative
    if path.is_symlink() or not path.resolve().is_relative_to(directory.resolve()):
        raise BackupError("invalid_artifact_path")
    return path


def load_config(path):
    value = json.loads(protected_file(path).read_text())
    key = bytes.fromhex(protected_file(value["encryption_key_file"]).read_text().strip())
    if len(key) != 32:
        raise BackupError("invalid_encryption_key")
    return value, key


def pg_parameters(config):
    database = config["database"]
    if database.get("sslmode", "verify-full") not in ("verify-full", "require", "disable"):
        raise BackupError("invalid_database_config")
    result = {key: database[key] for key in ("host", "port", "dbname", "user")}
    result["sslmode"] = database.get("sslmode", "verify-full")
    result["password"] = protected_file(database["password_file"]).read_text().strip()
    result["connect_timeout"] = 10
    if database.get("sslrootcert"):
        result["sslrootcert"] = database["sslrootcert"]
    return result

def environment_identity(config):
    database = config["database"]
    storage = config["storage"]
    return {"database": [database["host"], int(database["port"]), database["dbname"]],
            "storage": storage.get("url", "").rstrip("/") or str(Path(storage.get("directory", "")).resolve())}


def pg_tool(config, command):
    values = pg_parameters(config)
    environment = dict(os.environ)
    for key, value in values.items():
        environment[{"dbname": "PGDATABASE", "sslrootcert": "PGSSLROOTCERT"}.get(key, "PG" + key.upper())] = str(value)
    result = subprocess.run(command, env=environment, capture_output=True, timeout=600)
    if result.returncode:
        raise BackupError("database_tool_failed")
    return result.stdout


def encrypt_file(source, target, key, label):
    aes = AESGCM(key)
    nonce = os.urandom(8)
    digest = hashlib.sha256()
    size = 0
    with source.open("rb") as incoming, target.open("xb") as outgoing:
        target.chmod(0o600)
        outgoing.write(b"SHB1" + nonce)
        for index in range(2 ** 32):
            data = incoming.read(CHUNK)
            size += len(data)
            digest.update(data)
            encrypted = aes.encrypt(nonce + struct.pack(">I", index), data, (label + ":" + str(index)).encode())
            outgoing.write(struct.pack(">I", len(encrypted)) + encrypted)
            if not data:
                break
        else:
            raise BackupError("artifact_too_large")
    return {"sha256": digest.hexdigest(), "size": size}


def decrypt_file(source, target, key, label):
    aes = AESGCM(key)
    digest = hashlib.sha256()
    size = 0
    try:
        with source.open("rb") as incoming, target.open("xb") as outgoing:
            target.chmod(0o600)
            header = incoming.read(12)
            if len(header) != 12 or header[:4] != b"SHB1":
                raise BackupError("invalid_encrypted_file")
            for index in range(2 ** 32):
                length = incoming.read(4)
                if len(length) != 4:
                    raise BackupError("truncated_encrypted_file")
                length = struct.unpack(">I", length)[0]
                if not 16 <= length <= CHUNK + 16:
                    raise BackupError("invalid_encrypted_file")
                data = incoming.read(length)
                if len(data) != length:
                    raise BackupError("truncated_encrypted_file")
                plain = aes.decrypt(header[4:] + struct.pack(">I", index), data, (label + ":" + str(index)).encode())
                digest.update(plain)
                size += len(plain)
                outgoing.write(plain)
                if not plain:
                    if incoming.read(1):
                        raise BackupError("unexpected_encrypted_data")
                    break
            else:
                raise BackupError("artifact_too_large")
    except Exception:
        target.unlink(missing_ok=True)
        raise BackupError("artifact_authentication_failed") from None
    return {"sha256": digest.hexdigest(), "size": size}


def storage_request(config, method, path, source=None, content_type="application/octet-stream"):
    storage = config["storage"]
    base = storage["url"].rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        raise BackupError("invalid_storage_url")
    if parsed.scheme != "https" and not (config.get("isolated") is True and parsed.scheme == "http"
                                          and parsed.hostname in ("127.0.0.1", "localhost")):
        raise BackupError("invalid_storage_url")
    secret = protected_file(storage["service_key_file"]).read_text().strip()
    headers = {"Authorization": "Bearer " + secret, "apikey": secret}
    data = None
    if source:
        # urllib上传是有界内存；大对象使用http.client分块发送。
        import http.client
        connection = (http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection)(
            parsed.hostname, parsed.port, timeout=60)
        try:
            target = parsed.path + "/storage/v1/object/" + path
            connection.putrequest("POST", target)
            for key, value in {**headers, "x-upsert": "true", "Content-Type": content_type,
                               "Content-Length": str(source.stat().st_size)}.items():
                connection.putheader(key, value)
            connection.endheaders()
            with source.open("rb") as incoming:
                while chunk := incoming.read(CHUNK):
                    connection.send(chunk)
            response = connection.getresponse()
            if response.status not in (200, 201):
                raise BackupError("storage_write_failed")
            response.read(16384)
            return
        finally:
            connection.close()
    request = urllib.request.Request(base + "/storage/v1/object/authenticated/" + path, method=method, headers=headers, data=data)
    return urllib.request.build_opener(NoRedirect).open(request, timeout=60)


def object_path(obj):
    bucket, name = obj["bucket_id"], obj["name"]
    if not bucket or not name or any(part in ("", ".", "..") for part in (bucket + "/" + name).split("/")):
        raise BackupError("invalid_storage_path")
    return urllib.parse.quote(bucket, safe="") + "/" + urllib.parse.quote(name, safe="/")


def copy_object(config, obj, target, upload=False):
    encoded = object_path(obj)
    if config["storage"].get("directory"):
        root = Path(config["storage"]["directory"])
        local = inside(root, obj["bucket_id"] + "/" + obj["name"])
        if upload:
            local.parent.mkdir(parents=True, exist_ok=True)
            if local.exists():
                raise BackupError("restore_storage_not_empty")
            shutil.copyfile(target, local)
            local.chmod(0o600)
        else:
            shutil.copyfile(local, target)
            target.chmod(0o600)
        return
    if upload:
        storage_request(config, "POST", encoded, target, (obj.get("metadata") or {}).get("mimetype", "application/octet-stream"))
        return
    with storage_request(config, "GET", encoded) as response, target.open("xb") as outgoing:
        target.chmod(0o600)
        while chunk := response.read(CHUNK):
            outgoing.write(chunk)


def counts(connection, tables=COUNT_TABLES):
    result = {}
    for table in tables:
        if connection.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0]:
            result[table] = connection.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(*table.split(".")))).fetchone()[0]
    return result

def table_hashes(connection, tables=COUNT_TABLES):
    result = {}
    connection.execute("SET LOCAL TIME ZONE 'UTC'")
    for table in tables:
        if connection.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0]:
            digest = hashlib.sha256()
            with connection.cursor(name="backup_hash_" + uuid.uuid4().hex) as cursor:
                cursor.execute(sql.SQL("SELECT md5(to_jsonb(t)::text) AS hash FROM {} t ORDER BY hash").format(
                    sql.Identifier(*table.split("."))))
                for row in cursor:
                    digest.update(row[0].encode())
            result[table] = digest.hexdigest()
    return result


def objects(connection):
    with connection.cursor(row_factory=psycopg.rows.dict_row) as cursor:
        cursor.execute("SELECT id::text,bucket_id,name,metadata,updated_at::text FROM storage.objects ORDER BY bucket_id,name")
        return cursor.fetchall()

def credential_keyring(secrets):
    try:
        if secrets.get("model_keyring"):
            ring = json.loads(protected_file(secrets["model_keyring"]).read_text())
        else:
            master = protected_file(secrets["model_master_key"]).read_text().strip()
            ring = {"active_key_id": "legacy", "legacy_key_id": "legacy", "keys": {"legacy": master}}
        valid_id = lambda value: isinstance(value, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", value, re.I)
        keys = ring["keys"]
        if (not isinstance(keys, dict) or not 1 <= len(keys) <= 16
                or any(not valid_id(k) or not isinstance(v, str) or not re.fullmatch(r"[0-9a-f]{64}", v, re.I)
                       for k, v in keys.items())
                or not valid_id(ring["active_key_id"]) or ring["active_key_id"] not in keys
                or ring.get("legacy_key_id") is not None
                and (not valid_id(ring["legacy_key_id"]) or ring["legacy_key_id"] not in keys)):
            raise ValueError()
        if secrets.get("model_keyring") and secrets.get("model_master_key") and ring.get("legacy_key_id"):
            if protected_file(secrets["model_master_key"]).read_text().strip().lower() != keys[ring["legacy_key_id"]].lower():
                raise ValueError()
        return {**ring, "keys": {k: bytes.fromhex(v) for k, v in keys.items()}}
    except Exception:
        raise BackupError("invalid_credential_keyring") from None


def decrypt_credential(context, cipher, ring):
    try:
        if not isinstance(cipher, str) or len(cipher) > 23000:
            raise ValueError()
        parts = cipher.split(".")
        modern = len(parts) == 4 and parts[0] == "v2"
        if not modern and len(parts) != 2:
            raise ValueError()
        key_id = parts[1] if modern else ring.get("legacy_key_id")
        iv, payload = [base64.b64decode(part, validate=True) for part in (parts[2:] if modern else parts)]
        if (len(iv) != 12 or not 17 <= len(payload) <= 16400
                or [base64.b64encode(part).decode() for part in (iv, payload)] != (parts[2:] if modern else parts)):
            raise ValueError()
        aad = json.dumps(["v2", key_id, context], ensure_ascii=False, separators=(",", ":")) if modern else context
        plain = AESGCM(ring["keys"][key_id]).decrypt(iv, payload, aad.encode())
        if not plain:
            raise ValueError()
        plain.decode("utf-8")
        return key_id
    except Exception:
        raise BackupError("historical_credential_decryption_failed") from None


def validate_credentials(connection, secrets):
    ring = credential_keyring(secrets)
    report = {"checked": 0, "by_table": {}, "by_key_id": {}}
    queries = {
        "model_config_versions": "SELECT slot AS context,key_ciphertext AS cipher FROM public.model_config_versions WHERE key_ciphertext IS NOT NULL",
        "platform_apps": "SELECT 'platform-app:'||platform AS context,secret_ciphertext AS cipher FROM public.platform_apps",
        "platform_connections": """SELECT 'platform-connection:'||user_id||':'||platform||':'||open_id AS context,
            token_ciphertext AS cipher,platform,app_snapshot FROM public.platform_connections""",
        "platform_oauth_states": "SELECT platform,app_snapshot FROM public.platform_oauth_states",
        "measurement_sources": "SELECT 'measurement:'||id AS context,key_ciphertext AS cipher FROM public.measurement_sources",
    }
    for table, query in queries.items():
        if not connection.execute("SELECT to_regclass(%s)", ("public." + table,)).fetchone()[0]:
            continue
        report["by_table"][table] = 0
        with connection.cursor(name="key_preflight_" + uuid.uuid4().hex, row_factory=psycopg.rows.dict_row) as cursor:
            cursor.execute(query)
            for row in cursor:
                credentials = [(row["context"], row["cipher"])] if "cipher" in row else []
                if "app_snapshot" in row:
                    snapshot = row["app_snapshot"]
                    if not isinstance(snapshot, dict) or snapshot.get("platform") != row["platform"] or not snapshot.get("secret_ciphertext"):
                        raise BackupError("historical_app_snapshot_invalid")
                    credentials.append(("platform-app:" + row["platform"], snapshot["secret_ciphertext"]))
                for context, cipher in credentials:
                    key_id = decrypt_credential(context, cipher, ring)
                    report["checked"] += 1
                    report["by_table"][table] += 1
                    report["by_key_id"][key_id] = report["by_key_id"].get(key_id, 0) + 1
    return report


def validate_model_keys(connection, master_file):
    # 兼容旧工具/format=1归档；新归档统一验证所有业务密文。
    return validate_credentials(connection, {"model_master_key": master_file})["by_table"].get("model_config_versions", 0)


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as incoming:
        while data := incoming.read(CHUNK):
            digest.update(data)
    return digest.hexdigest()


def evidence(connection):
    result = {}
    for table in ("shopro_deploy.schema_migrations", "supabase_migrations.schema_migrations"):
        if connection.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0]:
            # 官方statements可能含历史敏感正文，只保留版本/名称；火山保留原摘要。
            columns = "version,name,sha256" if table.startswith("shopro_deploy") else "version"
            with connection.cursor(row_factory=psycopg.rows.dict_row) as cursor:
                cursor.execute(sql.SQL("SELECT {} FROM {} ORDER BY version").format(
                    sql.SQL(columns), sql.Identifier(*table.split("."))))
                result[table] = cursor.fetchall()
    return result


def backup(config, key, output):
    if output.exists():
        raise BackupError("backup_output_exists")
    output.mkdir(parents=True, mode=0o700)
    output.chmod(0o700)
    started = time.time()
    try:
        with tempfile.TemporaryDirectory(prefix=".backup-", dir=output) as directory, psycopg.connect(**pg_parameters(config)) as connection:
            stage = Path(directory)
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            snapshot = connection.execute("SELECT pg_export_snapshot()").fetchone()[0]
            schemas = [row[0] for row in connection.execute(
                "SELECT nspname FROM pg_namespace WHERE nspname=ANY(%s) ORDER BY nspname", (list(SCHEMAS),))]
            manifest = {"format": 1, "id": str(uuid.uuid4()), "started_at": started,
                        "source": config.get("environment", "unspecified"), "source_identity": environment_identity(config),
                        "schemas": schemas,
                        "counts": counts(connection), "table_hashes": table_hashes(connection), "ledger": evidence(connection),
                        "migrations": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                       for p in sorted((ROOT / "supabase/migrations").glob("*.sql"))},
                        "roles": [row[0] for row in connection.execute(
                            "SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' AND rolname<>'postgres' ORDER BY rolname")],
                        "files": [], "objects": objects(connection), "secrets": []}
            with connection.cursor(row_factory=psycopg.rows.dict_row) as cursor:
                cursor.execute("""SELECT e.extname AS name,e.extversion AS version,n.nspname AS schema
                  FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE n.nspname=ANY(%s)
                  AND e.extname NOT IN ('pg_cron','pg_net','pg_graphql') ORDER BY e.extname""", (schemas,))
                manifest["extensions"] = cursor.fetchall()
            dump = stage / "database.dump"
            pg_tool(config, ["pg_dump", "--format=custom", "--no-owner", "--no-publications", "--no-subscriptions",
                             "--snapshot=" + snapshot, "--file=" + str(dump),
                             *["--schema=" + schema for schema in schemas]])
            def add_file(source, label):
                metadata = encrypt_file(source, output / label, key, label)
                manifest["files"].append({"path": label, **metadata})
                return metadata
            add_file(dump, "database.dump.enc")
            for index, obj in enumerate(manifest["objects"]):
                temporary = stage / f"object-{index}"
                copy_object(config, obj, temporary)
                expected = obj.get("metadata", {}).get("size") if obj.get("metadata") else None
                if expected is not None and int(expected) != temporary.stat().st_size:
                    raise BackupError("storage_size_changed")
                obj["file"] = f"object-{index}.enc"
                add_file(temporary, obj["file"])
                temporary.unlink()
            # 新事务再次核对实物映射，备份期间发生对象新增/覆盖/删除则停止。
            with psycopg.connect(**pg_parameters(config)) as current:
                if objects(current) != [{k: v for k, v in obj.items() if k != "file"} for obj in manifest["objects"]]:
                    raise BackupError("storage_changed_during_backup")
            secrets = config.get("secrets", {})
            if not secrets.get("model_master_key") and not secrets.get("model_keyring"):
                raise BackupError("credential_keyring_backup_required")
            manifest["credentials_checked"] = validate_credentials(connection, secrets)
            manifest["model_keys_checked"] = manifest["credentials_checked"]["by_table"].get("model_config_versions", 0)
            for name, path in secrets.items():
                if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", name):
                    raise BackupError("invalid_secret_name")
                protected_file(path)
                label = "secret-" + name + ".enc"
                add_file(Path(path), label)
                manifest["secrets"].append({"name": name, "file": label})
            manifest["finished_at"] = time.time()
            manifest["storage_mapping_verified"] = True
            plain = stage / "manifest.json"
            plain.write_text(json.dumps(manifest, ensure_ascii=False, default=str))
            encrypt_file(plain, output / "manifest.enc", key, "manifest.enc")
        return {"id": manifest["id"], "objects": len(manifest["objects"]), "files": len(manifest["files"]),
                "duration_seconds": round(time.time() - started, 3), "encrypted": True}
    except Exception:
        shutil.rmtree(output)
        raise


def verified_stage(artifact, stage, key):
    decrypt_file(inside(artifact, "manifest.enc"), stage / "manifest.json", key, "manifest.enc")
    manifest = json.loads((stage / "manifest.json").read_text())
    if manifest.get("format") != 1 or manifest.get("storage_mapping_verified") is not True:
        raise BackupError("invalid_manifest")
    seen = set()
    for item in manifest["files"]:
        label = item["path"]
        if not re.fullmatch(r"(database\.dump|object-\d+|secret-[a-z][a-z0-9_]*)\.enc", label) or label in seen:
            raise BackupError("invalid_manifest_file")
        seen.add(label)
        actual = decrypt_file(inside(artifact, label), inside(stage, label), key, label)
        if actual != {key: item[key] for key in ("sha256", "size")}:
            raise BackupError("artifact_checksum_failed")
    if "database.dump.enc" not in seen:
        raise BackupError("database_dump_missing")
    for obj in manifest["objects"]:
        object_path(obj)
        if obj["file"] not in seen:
            raise BackupError("object_file_missing")
    for secret in manifest["secrets"]:
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", secret["name"]) or secret["file"] not in seen:
            raise BackupError("secret_file_missing")
    return manifest


def restore(config, key, artifact, output):
    if config.get("isolated") is not True:
        raise BackupError("restore_requires_isolated_environment")
    if output.exists():
        raise BackupError("restore_output_exists")
    output.mkdir(parents=True, mode=0o700)
    output.chmod(0o700)
    started = time.time()
    # 所有文件认证在数据库/Storage写入之前完成。恢复故障保留记录，禁止盲重放。
    try:
        with tempfile.TemporaryDirectory(prefix=".restore-", dir=output) as directory:
            stage = Path(directory)
            manifest = verified_stage(artifact, stage, key)
            identity = environment_identity(config)
            if (identity["database"] == manifest["source_identity"]["database"]
                    or identity["storage"] == manifest["source_identity"]["storage"]):
                raise BackupError("restore_target_matches_source")
            with psycopg.connect(**pg_parameters(config)) as connection:
                if connection.execute("""SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                  WHERE n.nspname=ANY(%s) AND c.relkind IN ('r','p','v','m')""", (list(SCHEMAS),)).fetchone()[0]:
                    raise BackupError("restore_database_not_empty")
                if connection.execute("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname=ANY(%s)""", (list(SCHEMAS),)).fetchone()[0]:
                    raise BackupError("restore_database_not_empty")
                if connection.execute("""SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                  WHERE n.nspname=ANY(%s) AND t.typtype IN ('e','d','c')""", (list(SCHEMAS),)).fetchone()[0]:
                    raise BackupError("restore_database_not_empty")
                storage_dir = config["storage"].get("directory")
                if storage_dir and Path(storage_dir).exists() and any(Path(storage_dir).iterdir()):
                    raise BackupError("restore_storage_not_empty")
                for role in manifest["roles"]:
                    if not connection.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (role,)).fetchone():
                        connection.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(role)))
                if "service_role" in manifest["roles"]:
                    connection.execute("ALTER ROLE service_role BYPASSRLS")
                for schema in manifest["schemas"]:
                    connection.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema)))
                for extension in manifest["extensions"]:
                    if not connection.execute("SELECT 1 FROM pg_available_extension_versions WHERE name=%s AND version=%s",
                                              (extension["name"], extension["version"])).fetchone():
                        raise BackupError("required_extension_version_unavailable")
                    connection.execute(sql.SQL("CREATE EXTENSION {} WITH SCHEMA {} VERSION {}").format(
                        sql.Identifier(extension["name"]), sql.Identifier(extension["schema"]), sql.Literal(extension["version"])))
            toc = pg_tool(config, ["pg_restore", "--list", str(stage / "database.dump.enc")]).decode()
            # 预建schema和扩展后恢复原ACL/对象；pg_dump -n不自动保存扩展依赖。
            toc_path = stage / "restore.list"
            toc_path.write_text("\n".join(line for line in toc.splitlines()
                                         if not re.match(r"^\d+; \d+ \d+ SCHEMA ", line)))
            pg_tool(config, ["pg_restore", "--no-owner", "--exit-on-error", "--single-transaction",
                             "--use-list=" + str(toc_path),
                             "--dbname=" + config["database"]["dbname"], str(stage / "database.dump.enc")])
            with psycopg.connect(**pg_parameters(config)) as connection:
                if (counts(connection, manifest["counts"]) != manifest["counts"]
                        or table_hashes(connection, manifest["table_hashes"]) != manifest["table_hashes"]
                        or evidence(connection) != manifest["ledger"]):
                    raise BackupError("restored_database_mismatch")
            for index, obj in enumerate(manifest["objects"]):
                copy_object(config, obj, stage / obj["file"], upload=True)
                check = stage / f"roundtrip-{index}"
                copy_object(config, obj, check)
                if file_hash(check) != next(
                        f["sha256"] for f in manifest["files"] if f["path"] == obj["file"]):
                    raise BackupError("restored_storage_mismatch")
                check.unlink()
            secrets = output / "secrets"
            secrets.mkdir(mode=0o700)
            for secret in manifest["secrets"]:
                shutil.copyfile(stage / secret["file"], secrets / secret["name"])
                (secrets / secret["name"]).chmod(0o600)
            with psycopg.connect(**pg_parameters(config)) as connection:
                report = validate_credentials(connection, {s["name"]: str(secrets / s["name"]) for s in manifest["secrets"]})
                checked = report["by_table"].get("model_config_versions", 0)
                if checked != manifest["model_keys_checked"] or (
                        "credentials_checked" in manifest and report != manifest["credentials_checked"]):
                    raise BackupError("restored_model_keys_mismatch")
            receipt = {"id": manifest["id"], "objects": len(manifest["objects"]), "counts_verified": True,
                       "ledger_verified": True, "storage_verified": True, "secrets_verified": True,
                       "model_keys_checked": checked, "credentials_checked": report,
                       "isolated": True, "duration_seconds": round(time.time() - started, 3)}
            (output / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False))
            (output / "receipt.json").chmod(0o600)
            return receipt
    except Exception:
        (output / "FAILED").write_text("恢复未通过；隔离库不得启动调度，核对证据后另建空环境。\n")
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("backup", "verify", "restore", "key-preflight"))
    parser.add_argument("--config", required=True)
    parser.add_argument("--output")
    parser.add_argument("--artifact")
    args = parser.parse_args()
    try:
        if args.action == "key-preflight":
            config = json.loads(protected_file(args.config).read_text())
            with psycopg.connect(**pg_parameters(config)) as connection:
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                receipt = validate_credentials(connection, config.get("secrets", {}))
            print(json.dumps(receipt, ensure_ascii=False))
            return 0
        config, key = load_config(args.config)
        if args.action == "backup" and args.output:
            receipt = backup(config, key, Path(args.output))
        elif args.action == "restore" and args.output and args.artifact:
            receipt = restore(config, key, Path(args.artifact), Path(args.output))
        elif args.action == "verify" and args.artifact:
            with tempfile.TemporaryDirectory() as directory:
                manifest = verified_stage(Path(args.artifact), Path(directory), key)
                receipt = {"id": manifest["id"], "verified": True, "files": len(manifest["files"])}
        else:
            raise BackupError("required_argument_missing")
        print(json.dumps(receipt, ensure_ascii=False))
        return 0
    except Exception as cause:
        print(json.dumps({"error": str(cause) if isinstance(cause, BackupError) else "backup_restore_failed"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
