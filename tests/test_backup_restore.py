"""双隔离PG16及真实文件归档/恢复，执行加密工具与完整业务迁移。"""
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]


class DockerDrillTest(unittest.TestCase):
    def test_real_encrypted_backup_restore(self):
        suffix = uuid.uuid4().hex[:8]
        network = "shopro-backup-" + suffix
        containers = ["backup-source-" + suffix, "backup-target-" + suffix]
        subprocess.run(["docker", "network", "create", network], check=True, capture_output=True, timeout=30)
        self.addCleanup(lambda: subprocess.run(["docker", "network", "rm", network], capture_output=True, timeout=30))
        for container, alias in zip(containers, ["backup-source", "backup-target"]):
            subprocess.run(["docker", "run", "-d", "--name", container, "--network", network, "--network-alias", alias,
                            "-e", "POSTGRES_PASSWORD=isolated_backup_only", "postgres:16"],
                           check=True, capture_output=True, timeout=60)
            self.addCleanup(lambda name=container: subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=30))
            for _ in range(60):
                if subprocess.run(["docker", "exec", container, "pg_isready", "-t", "1"], capture_output=True, timeout=5).returncode == 0:
                    break
                time.sleep(0.25)
            else:
                self.fail("隔离PostgreSQL未就绪")
        archive = subprocess.run(["tar", "--format=ustar", "--exclude=__pycache__", "-cf", "-",
                                  "scripts/backup_restore.py", "scripts/backup_archive.py", "tests/test_backup_restore.py",
                                  "tests/db", "supabase/migrations"], cwd=ROOT, check=True, capture_output=True, timeout=30).stdout
        result = subprocess.run(["docker", "run", "--rm", "-i", "--network", network, "--user", "0:0",
                                 "-e", "BACKUP_TEST_INNER=true", "--entrypoint", "sh", "shoproai-backup:local",
                                 "-c", "mkdir /tmp/workspace /drill && tar -xf - -C /tmp/workspace && python /tmp/workspace/tests/test_backup_restore.py"],
                                input=archive, capture_output=True, timeout=180)
        self.assertEqual(result.returncode, 0, result.stdout.decode() + result.stderr.decode())
        print(result.stdout.decode().strip())
        print(result.stderr.decode().strip())


if os.environ.get("BACKUP_TEST_INNER") == "true":
    import base64
    import copy
    import importlib.util
    import json
    import sys
    sys.path.insert(0, str(ROOT / "scripts"))
    import backup_archive as archiver
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import psycopg

    spec = importlib.util.spec_from_file_location("backup_restore", ROOT / "scripts/backup_restore.py")
    backup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backup)
    class RestoreDrillTest(unittest.TestCase):
        @classmethod
        def setUpClass(cls):
            cls.directory = Path("/drill")
            def private(name, value):
                path = cls.directory / name
                path.write_text(value)
                path.chmod(0o600)
                return str(path)
            password = private("password", "isolated_backup_only")
            encryption = private("encryption", "a" * 64)
            cls.master = private("master", "b" * 64)
            cls.ring = private("keyring", json.dumps({"active_key_id": "current", "legacy_key_id": "old",
                                                    "keys": {"old": "b" * 64, "current": "c" * 64}}))
            cls.source = {"environment": "isolated-source", "isolated": True, "encryption_key_file": encryption,
                          "database": {"host": "backup-source", "port": 5432, "dbname": "postgres", "user": "postgres",
                                       "password_file": password, "sslmode": "disable"},
                          "storage": {"directory": "/drill/storage-source"},
                          "secrets": {"model_master_key": cls.master, "model_keyring": cls.ring,
                                      "worker_secret": private("worker", "isolated_worker_secret")}}
            cls.target = copy.deepcopy(cls.source)
            cls.target["database"]["host"] = "backup-target"
            cls.target["storage"]["directory"] = "/drill/storage-target"
            # 真实HTTP下载/上传往返；只替换托管平台，不替换加密或备份工具。
            import http.server
            import threading
            import urllib.parse
            cls.storage_source = Path(cls.source["storage"]["directory"])
            cls.storage_target = Path(cls.target["storage"]["directory"])
            cls.storage_target.mkdir()
            storage_secret = private("storage-key", "isolated_storage_service")
            cls.archive_objects = {}
            class Handler(http.server.BaseHTTPRequestHandler):
                def log_message(self, *_):
                    pass
                def path_file(self):
                    namespace, path = urllib.parse.unquote(self.path).split("/storage/v1/object/", 1)
                    root = cls.storage_source if namespace == "/source" else cls.storage_target
                    return root / path.removeprefix("authenticated/")
                def do_GET(self):
                    if self.headers.get("Authorization") != "Bearer isolated_storage_service":
                        self.send_error(401); return
                    if self.path.startswith("/archive/"):
                        data = cls.archive_objects[self.path]
                        self.send_response(200); self.end_headers(); self.wfile.write(data)
                        return
                    path = self.path_file()
                    if not path.is_file():
                        self.send_error(404); return
                    self.send_response(200); self.end_headers()
                    self.wfile.write(path.read_bytes())
                def do_PUT(self):
                    if self.headers.get("Authorization") != "Bearer isolated_storage_service":
                        self.send_error(401); return
                    import hashlib
                    data = self.rfile.read(int(self.headers["Content-Length"]))
                    cls.archive_objects[self.path] = data
                    identifier, digest = self.headers["Idempotency-Key"].split(":")
                    self.send_response(200); self.end_headers()
                    self.wfile.write(json.dumps({"accepted": True, "backup_id": identifier,
                        "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}).encode())
                def do_POST(self):
                    if self.headers.get("Authorization") != "Bearer isolated_storage_service":
                        self.send_error(401); return
                    path = self.path_file()
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(self.rfile.read(int(self.headers["Content-Length"])))
                    self.send_response(200); self.end_headers(); self.wfile.write(b"{}")
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            cls.addClassCleanup(server.server_close)
            cls.addClassCleanup(server.shutdown)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            cls.source["storage"] = {"url": f"http://127.0.0.1:{server.server_port}/source", "service_key_file": storage_secret}
            cls.target["storage"] = {"url": f"http://127.0.0.1:{server.server_port}/target", "service_key_file": storage_secret}
            cls.source["archive"] = {"url": f"http://127.0.0.1:{server.server_port}/archive", "secret_file": storage_secret}
            cls.key = bytes.fromhex("a" * 64)
            with psycopg.connect(**backup.pg_parameters(cls.source)) as connection:
                connection.execute((ROOT / "tests/db/bootstrap.sql").read_text())
                for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
                    if migration.name.startswith(("00018_", "00019_")):
                        continue
                    connection.execute(migration.read_text())
                cls.user, cls.admin = str(uuid.uuid4()), str(uuid.uuid4())
                connection.execute("INSERT INTO plans(name,price,credits,level) VALUES('免费版',0,100,0)")
                connection.execute("INSERT INTO auth.users(id,raw_app_meta_data) VALUES(%s,'{}'),(%s,'{\"role\":\"admin\"}')", (cls.user, cls.admin))
                slot = "video.SeedanceMini"
                iv = os.urandom(12)
                cls.model_plain = b"original_supplier_key_for_isolated_drill"
                cipher = base64.b64encode(iv).decode() + "." + base64.b64encode(
                    AESGCM(bytes.fromhex("b" * 64)).encrypt(iv, cls.model_plain, slot.encode())).decode()
                connection.execute("SET request.jwt.claim.role='service_role'")
                version = connection.execute("SELECT save_model_config(%s,NULL,'{\"name\":\"drill\",\"model\":\"drill\"}',true,%s,%s,true)",
                                             (slot, cipher, cls.admin)).fetchone()[0]
                cls.job = connection.execute("""SELECT create_video_job(%s,%s,'SeedanceMini',
                 '{"prompt":"隔离恢复原任务","duration":5,"resolution":"720P","ratio":"16:9"}',%s)""",
                                             (cls.user, str(uuid.uuid4()), version)).fetchone()[0]
                connection.execute("UPDATE video_jobs SET submission_state='unknown',status='processing' WHERE id=%s", (cls.job["id"],))
                connection.execute("SELECT refresh_operations_alerts(false)")
                cls.alert_event = str(connection.execute("SELECT id FROM operations_alert_events ORDER BY created_at,id LIMIT 1").fetchone()[0])
                delivery = connection.execute("SELECT claim_alert_delivery('operations')").fetchone()[0]
                connection.execute("SELECT finish_alert_delivery('operations',%s,%s,%s)",
                    (delivery["event_id"], delivery["lease_token"], json.dumps({"event_id": delivery["event_id"], "accepted": True})))
                def modern(context, key_id):
                    nonce = os.urandom(12)
                    aad = json.dumps(["v2", key_id, context], ensure_ascii=False, separators=(",", ":")).encode()
                    encrypted = AESGCM(bytes.fromhex(("b" if key_id == "old" else "c") * 64)).encrypt(nonce, cls.model_plain, aad)
                    return ".".join(("v2", key_id, base64.b64encode(nonce).decode(), base64.b64encode(encrypted).decode()))
                for key_id in ("old", "current"):
                    version = connection.execute("SELECT save_model_config(%s,%s,'{\"name\":\"rotated\",\"model\":\"drill\"}',true,%s,%s,true)",
                                                 (slot, version, modern(slot, key_id), cls.admin)).fetchone()[0]
                snapshot = {"platform": "tiktok", "secret_ciphertext": modern("platform-app:tiktok", "old")}
                connection.execute("""INSERT INTO platform_apps(platform,client_key,secret_ciphertext,redirect_uri,scopes)
                    VALUES('tiktok','isolated-client',%s,'https://app.example/callback','{}')""", (modern("platform-app:tiktok", "current"),))
                connection.execute("""INSERT INTO platform_connections(user_id,platform,open_id,display_name,token_ciphertext,scopes,expires_at,app_snapshot,status)
                    VALUES(%s,'tiktok','original-open','drill',%s,'{}',now()+interval '1 hour',%s,'revoked')""",
                                   (cls.user, modern(f"platform-connection:{cls.user}:tiktok:original-open", "old"), json.dumps(snapshot)))
                connection.execute("""INSERT INTO platform_oauth_states(state_hash,user_id,platform,app_snapshot,expires_at,used_at)
                    VALUES('isolated-state',%s,'tiktok',%s,now()-interval '1 hour',now())""", (cls.user, json.dumps(snapshot)))
                source_id = str(uuid.uuid4())
                connection.execute("""INSERT INTO measurement_sources(id,user_id,name,authorization_reference,key_ciphertext,key_digest,created_by,enabled)
                    VALUES(%s,%s,'drill','isolated-authorized-source',%s,%s,%s,false)""",
                                   (source_id, cls.user, modern(f"measurement:{source_id}", "current"), "d" * 64, cls.admin))
                cls.expected_credentials = 8
                cls.object_bytes = b"private storage object" * 1000
                cls.object_name = cls.user + "/original.bin"
                connection.execute("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('materials',%s,%s)",
                                   (cls.object_name, json.dumps({"size": len(cls.object_bytes), "mimetype": "application/octet-stream"})))
                connection.execute("CREATE SCHEMA shopro_deploy")
                connection.execute("CREATE TABLE shopro_deploy.schema_migrations(version text PRIMARY KEY,name text,sha256 text)")
                connection.execute("INSERT INTO shopro_deploy.schema_migrations VALUES('00058','00058_operations_alerts.sql',%s)",
                                   (backup.file_hash(ROOT / "supabase/migrations/00058_operations_alerts.sql"),))
            obj = cls.storage_source / "materials" / cls.object_name
            obj.parent.mkdir(parents=True)
            obj.write_bytes(cls.object_bytes)
            cls.artifact = cls.directory / "artifact"
            cls.backup_receipt = backup.backup(cls.source, cls.key, cls.artifact)

        def test_a_tamper_wrong_key_and_nonisolated_restore_rejected_before_writes(self):
            with tempfile.TemporaryDirectory(dir=self.directory) as directory:
                with self.assertRaises(backup.BackupError):
                    backup.verified_stage(self.artifact, Path(directory), b"c" * 32)
            file = self.artifact / "database.dump.enc"
            original = file.read_bytes()
            modified = bytearray(original)
            modified[-3] ^= 1
            file.write_bytes(modified)
            try:
                with self.assertRaises(backup.BackupError):
                    backup.restore(self.target, self.key, self.artifact, self.directory / "tampered-result")
                with psycopg.connect(**backup.pg_parameters(self.target)) as connection:
                    self.assertIsNone(connection.execute("SELECT to_regclass('public.video_jobs')").fetchone()[0])
            finally:
                file.write_bytes(original)
            with self.assertRaisesRegex(backup.BackupError, "isolated"):
                backup.restore({**self.target, "isolated": False}, self.key, self.artifact, self.directory / "invalid-result")
            with self.assertRaisesRegex(backup.BackupError, "matches_source"):
                backup.restore({**self.target, "storage": self.source["storage"]}, self.key, self.artifact, self.directory / "wrong-storage")

        def test_b_real_database_storage_old_key_unknown_and_replay_restored(self):
            archive_config = self.directory / "archive-config.json"
            archive_config.write_text(json.dumps(self.source)); archive_config.chmod(0o600)
            archive_receipt = self.directory / "archive-receipt.json"
            pulled = self.directory / "pulled"
            for arguments in [
                ["upload", "--artifact", str(self.artifact)],
                ["pull", "--output", str(pulled)],
            ]:
                result = subprocess.run([sys.executable, str(ROOT / "scripts/backup_archive.py"), *arguments,
                    "--config", str(archive_config), "--receipt", str(archive_receipt)],
                    capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(json.loads(result.stdout)["backup_id"], self.backup_receipt["id"])
            receipt = backup.restore(self.target, self.key, pulled, self.directory / "restored")
            self.assertEqual(receipt["model_keys_checked"], 3)
            self.assertEqual(receipt["credentials_checked"]["checked"], self.expected_credentials)
            self.assertTrue(receipt["ledger_verified"])
            self.assertEqual((self.storage_target / "materials" / self.object_name).read_bytes(), self.object_bytes)
            self.assertEqual((self.directory / "restored/secrets/model_master_key").read_text(), "b" * 64)
            self.assertEqual((self.directory / "restored/secrets/model_keyring").read_text(),
                             Path(self.ring).read_text())
            with psycopg.connect(**backup.pg_parameters(self.target)) as connection:
                state = connection.execute("SELECT submission_state,billing_state,charge_id FROM video_jobs WHERE id=%s", (self.job["id"],)).fetchone()
                self.assertEqual(state[:2], ("unknown", "reserved"))
                self.assertEqual(str(state[2]), self.job["charge_id"])
                connection.execute("SET request.jwt.claim.role='service_role'")
                replay = connection.execute("""SELECT create_video_job(%s,%s,'SeedanceMini',
                 '{"prompt":"隔离恢复原任务","duration":5,"resolution":"720P","ratio":"16:9"}',%s)""",
                                            (self.user, self.job["request_key"], self.job["model_config_version_id"])).fetchone()[0]
                self.assertEqual(replay["id"], self.job["id"])
                self.assertEqual(connection.execute("SELECT count(*) FROM credit_logs WHERE user_id=%s AND amount<0", (self.user,)).fetchone()[0], 1)
                self.assertIsNone(connection.execute("SELECT to_regclass('cron.job')").fetchone()[0])
                self.assertEqual(str(connection.execute("SELECT id FROM operations_alert_events WHERE id=%s",
                    (self.alert_event,)).fetchone()[0]), self.alert_event)
                self.assertGreater(connection.execute("SELECT count(*) FROM operations_alert_deliveries WHERE delivered_at IS NOT NULL").fetchone()[0], 0)
            with self.assertRaisesRegex(backup.BackupError, "not_empty"):
                backup.restore(self.target, self.key, self.artifact, self.directory / "repeated")
            self.assertNotIn(self.model_plain, b"".join(p.read_bytes() for p in self.artifact.iterdir()))
            print(json.dumps({"backup": self.backup_receipt, "archive": json.loads(archive_receipt.read_text()), "restore": receipt}))

        def test_c_preflight_checks_immutable_and_disabled_history_and_missing_key(self):
            config_file = self.directory / "preflight-config.json"
            config_file.write_text(json.dumps(self.source)); config_file.chmod(0o600)
            result = subprocess.run([sys.executable, str(ROOT / "scripts/backup_restore.py"),
                                     "key-preflight", "--config", str(config_file)],
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["checked"], self.expected_credentials)
            with psycopg.connect(**backup.pg_parameters(self.source)) as connection:
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                report = backup.validate_credentials(connection, self.source["secrets"])
                self.assertEqual(report["checked"], self.expected_credentials)
                self.assertEqual(report["by_key_id"], {"old": 5, "current": 3})
                self.assertEqual(report["by_table"]["platform_oauth_states"], 1)
                self.assertEqual(report["by_table"]["platform_connections"], 2)
                ring = json.loads(Path(self.ring).read_text())
                del ring["keys"]["old"]
                ring["legacy_key_id"] = None
                missing = self.directory / "missing-keyring"
                missing.write_text(json.dumps(ring)); missing.chmod(0o600)
                with self.assertRaises(backup.BackupError):
                    backup.validate_credentials(connection, {"model_keyring": str(missing)})
            self.assertNotIn(self.model_plain.decode(), json.dumps(report))

    if __name__ == "__main__":
        unittest.main(defaultTest="RestoreDrillTest", verbosity=2)
elif __name__ == "__main__":
    unittest.main(defaultTest="DockerDrillTest", verbosity=2)
