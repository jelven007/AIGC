"""原官方Supabase专用发布：隔离构建、只读目标预检、摘要迁移及函数分步回执。"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import zipfile

from deploy_volcengine import checksum, migration_files, migration_sql, release_manifest, write_frontend_identity
from dev_environment import IMAGE
from bootstrap_supabase_cli import VERSION as CLI_VERSION

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".supabase-build"


class DeployError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def env_file(path, *, private=True):
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        raise DeployError(f"缺少普通配置文件：{path.name}")
    if private and path.stat().st_mode & 0o077:
        raise DeployError(f"{path.name}必须设置chmod 600")
    values = {}
    for line in path.read_text().splitlines():
        match = re.fullmatch(r"\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*", line)
        if match:
            values[match[1]] = match[2].strip("'\"")
    return values


def target_config(path):
    values = env_file(path)
    ref = values.get("SUPABASE_PROJECT_REF", "")
    base = values.get("SUPABASE_URL", "").rstrip("/")
    if not re.fullmatch(r"[a-z]{20}", ref) or base != f"https://{ref}.supabase.co":
        raise DeployError("配置必须绑定同一个官方Supabase项目ref和HTTPS根地址")
    public = env_file(ROOT / ".env.local")
    if public.get("VITE_SUPABASE_URL", "").rstrip("/") != base:
        raise DeployError("部署目标与当前已核对的开发后端不同")
    return values


def command(args, *, timeout=240, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout, cwd=ROOT, **kwargs)
    if result.returncode:
        # CLI、构建输出可能携带连接串或秘密，不输出原stdout/stderr。
        raise DeployError(f"{Path(args[0]).name}执行失败（退出码{result.returncode}）")
    return result.stdout


def api(values, suffix, *, body=None, method=None):
    token = values.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise DeployError("缺少SUPABASE_ACCESS_TOKEN")
    url = f"https://api.supabase.com/v1/projects/{values['SUPABASE_PROJECT_REF']}{suffix}"
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
        method=method or ("POST" if body is not None else "GET"),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with OPENER.open(request, timeout=45) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise DeployError("官方管理响应超过限制")
            return json.loads(raw)
    except urllib.error.HTTPError as error:
        if error.code == 401:
            raise DeployError("官方管理HTTP 401：SUPABASE_ACCESS_TOKEN失效，请恢复有效管理令牌") from None
        raise DeployError(f"官方管理HTTP {error.code}，未将响应正文输出") from None
    except (OSError, ValueError):
        raise DeployError("官方管理请求失败；未认定云端操作完成，请查询原回执") from None


def query(values, sql, *, read_only=True):
    data = api(values, "/database/query", body={"query": sql, "read_only": read_only})
    if not isinstance(data, list) or not all(isinstance(row, dict) for row in data):
        raise DeployError("官方数据库响应格式不匹配")
    return data


def inventory(values):
    project = api(values, "")
    if project.get("id") != values["SUPABASE_PROJECT_REF"]:
        raise DeployError("官方项目身份不匹配")
    functions = api(values, "/functions")
    if not isinstance(functions, list):
        raise DeployError("函数列表格式不匹配")
    shape = query(values, """SELECT to_regclass('shopro_deploy.schema_migrations') IS NOT NULL AS tracked,
        to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS official_history,
        to_regclass('public.profiles') IS NOT NULL AS initialized;""")[0]
    ledger = query(values, "SELECT version,name,sha256 FROM shopro_deploy.schema_migrations ORDER BY version;") if shape["tracked"] else []
    # 官方旧账是历史证据，不据名字或版本号伪造源码摘要账。
    history = query(values, "SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version;") if shape["official_history"] else []
    return {"project_ref": project["id"], "backend_url": values["SUPABASE_URL"].rstrip("/"),
        "captured_at": timestamp(), "shape": shape, "ledger": ledger, "official_history": history,
        "functions": [{key: item.get(key) for key in ("slug", "name", "version", "status", "verify_jwt")}
                      for item in functions], "production_accepted": False}


def pending_migrations(snapshot, files=None):
    files = migration_files() if files is None else files
    expected = {p.name.split("_")[0]: checksum(p) for p in files}
    if not snapshot["shape"]["tracked"] and (
        snapshot["shape"]["initialized"] or snapshot.get("official_history")):
        raise DeployError("官方旧库没有源码摘要账；先核对原迁移SQL/备份并登记可信基线，禁止从00001重放")
    applied = snapshot["ledger"]
    known = {item["version"]: item["sha256"] for item in applied}
    if len(known) != len(applied) or any(expected.get(version) != digest for version, digest in known.items()):
        raise DeployError("目标迁移存在重复、未知版本或SQL摘要漂移")
    versions = list(expected)
    if set(known) != set(versions[:len(known)]):
        raise DeployError("目标摘要迁移账存在断档")
    return [p for p in files if p.name.split("_")[0] not in known]


def guarded_migration_sql(snapshot, pending):
    """锁与原账比对和追加SQL处于同一事务，拒绝预检之后的并发漂移。"""
    sql = migration_sql(pending)
    if not pending:
        return sql
    observed = json.dumps(sorted((row["version"], row["sha256"]) for row in snapshot["ledger"]))
    guard = """DO $guard$ BEGIN
        IF (SELECT coalesce(jsonb_agg(jsonb_build_array(version,sha256) ORDER BY version),'[]'::jsonb)
            FROM shopro_deploy.schema_migrations) <> '""" + observed + """'::jsonb
        THEN RAISE EXCEPTION 'migration ledger changed'; END IF;
        END $guard$;
    """
    return sql.replace("\n-- " + pending[0].name, "\n" + guard + "\n-- " + pending[0].name, 1)


def image_receipts(release):
    mappings = {
        "scheduler": ("shoproai-video-scheduler:local", {
            f"scripts/{name}": f"/app/{name}" for name in ("run_video_worker.py", "alert_delivery.py", "runtime-contract.json")}),
        "renderer": ("shoproai-render-worker:local", {
            str(p.relative_to(ROOT)): f"/app/{p.name}" for p in (ROOT / "worker").iterdir()
            if p.suffix in (".py", ".lock", ".txt")}),
        "mcp": ("shoproai-mcp:local", {
            str(p.relative_to(ROOT)): f"/app/{p.name}" for p in (ROOT / "mcp").iterdir()
            if p.suffix == ".py" or p.name in ("tools.json", "requirements.lock")}),
        "backup": ("shoproai-backup:local", {
            **{f"scripts/{name}": f"/app/scripts/{name}" for name in ("backup_restore.py", "backup_archive.py", "accept_release.py")},
            "deploy/backup/requirements.lock": "/app/requirements.lock",
            **{str(p.relative_to(ROOT)): f"/app/supabase/migrations/{p.name}" for p in (ROOT / "supabase/migrations").glob("*.sql")}}),
    }
    receipts = {}
    for role, (image, files) in mappings.items():
        info = json.loads(command(["docker", "image", "inspect", image]))[0]
        script = "import hashlib,json; from pathlib import Path; m=" + repr(files) + "; print(json.dumps({k:hashlib.sha256(Path(v).read_bytes()).hexdigest() for k,v in m.items()}))"
        actual = json.loads(command(["docker", "run", "--rm", "--network", "none", "--read-only",
                                    "--entrypoint", "python", info["Id"], "-c", script]))
        if any(release["files"].get(name) != digest for name, digest in actual.items()):
            raise DeployError(f"{role}镜像源码与本次快照不匹配，请重建对应镜像")
        receipts[role] = {"image_id": info["Id"], "architecture": info["Architecture"],
                         "repo_digests": info.get("RepoDigests", []), "verified_files": actual,
                         "availability": "local_docker_daemon"}
    return receipts


def deterministic_zip(directory, target):
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                info = zipfile.ZipInfo(str(path.relative_to(directory)), date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes())


def prepare():
    public = env_file(ROOT / ".env.local")
    base, key = public.get("VITE_SUPABASE_URL", "").rstrip("/"), public.get("VITE_SUPABASE_ANON_KEY", "")
    if not re.fullmatch(r"https://[a-z]{20}\.supabase\.co", base) or not key:
        raise DeployError("prepare需要原官方Supabase公开配置")
    # 复用已有anon角色校验，避免把特权JWT放进浏览器。
    from deploy_volcengine import public_config
    OUTPUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".prepare-", dir=OUTPUT) as directory:
        work = Path(directory)
        key_file = work / "anon.local"
        key_file.write_text(key); key_file.chmod(0o600)
        public_config(argparse.Namespace(backend_url=base, anon_key_file=str(key_file)))
        key_file.unlink()
        release = release_manifest()
        frontend = work / "frontend"
        env_path = work / "build.env"
        build_values = {"VITE_SUPABASE_URL": base, "VITE_SUPABASE_ANON_KEY": key,
            "VITE_TERMS_URL": public.get("VITE_TERMS_URL", ""), "VITE_PRIVACY_URL": public.get("VITE_PRIVACY_URL", ""),
            "COREPACK_ENABLE_NETWORK": "0", "CI": "true"}
        if any("\n" in value or "\r" in value for value in build_values.values()):
            raise DeployError("构建公开配置不能包含换行")
        env_path.write_text("".join(f"{name}={value}\n" for name, value in build_values.items()))
        env_path.chmod(0o600)
        destination = "/app/" + str(frontend.relative_to(ROOT))
        command(["docker", "run", "--rm", "--network", "none", "--env-file", str(env_path),
            "-v", f"{ROOT}:/app", "-v", "shoproai-development-dependencies:/app/node_modules",
            "-v", "shoproai-development-corepack:/root/.cache/node/corepack",
            "-v", "shoproai-development-package-store:/pnpm/store", "-w", "/app", IMAGE,
            "bash", "-euc", 'corepack enable; test "$(node -p process.versions.node)" = "$(cat .node-version)"; '
            'test "$(corepack pnpm --version)" = "10.34.5"; '
            'corepack pnpm install --offline --frozen-lockfile --store-dir /pnpm/store; '
            'corepack pnpm run typecheck; corepack pnpm run build --outDir "$1"',
            "release-build", destination], timeout=300)
        env_path.unlink()
        if release_manifest()["source_sha256"] != release["source_sha256"]:
            raise DeployError("构建中源码发生变化，请用新快照重新构建")
        write_frontend_identity(frontend, release)
        deterministic_zip(frontend, work / "frontend.zip")
        images = image_receipts(release)
        files = migration_files()
        manifest = {"platform": "official-supabase", "release": release,
            "migrations": [{"version": p.name.split("_")[0], "name": p.name, "sha256": checksum(p)} for p in files],
            "functions": json.loads((ROOT / "deploy/volcengine/manifest.json").read_text())["functions"],
            "frontend": {"backend_url": base, "anon_key_sha256": hashlib.sha256(key.encode()).hexdigest(),
                "archive_sha256": checksum(work / "frontend.zip"),
                "registration_configured": bool(build_values["VITE_TERMS_URL"] and build_values["VITE_PRIVACY_URL"])},
            "build": {"node_image": IMAGE, "network": "none", "frozen_install": True, "fresh_output": True},
            "images": images, "prepared_at": timestamp(), "production_accepted": False}
        # 整包只收入摘要已声明的文件；不使用git archive遗漏本次未提交修改。
        with tarfile.open(work / "source.tar.gz", "w:gz") as archive:
            for name in sorted(release["files"]):
                archive.add(ROOT / name, arcname=name, recursive=False)
        if release_manifest()["source_sha256"] != release["source_sha256"]:
            raise DeployError("归档期间源码发生变化，未生成可接受发布包")
        manifest["source_archive_sha256"] = checksum(work / "source.tar.gz")
        (work / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
        final = OUTPUT / release["source_sha256"]
        if final.exists():
            raise DeployError("此源码快照的发布包已存在；拒绝覆盖")
        # 删除临时目录由上下文处理；将实际发布文件移动到独立不可覆盖目录。
        final.mkdir()
        for path in list(work.iterdir()):
            path.rename(final / path.name)
        print(json.dumps({"prepared": str(final), "source_sha256": release["source_sha256"],
                          "migrations": len(files), "functions": len(manifest["functions"]),
                          "production_accepted": False}, ensure_ascii=False))


def load_release(directory):
    directory = Path(directory).resolve()
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest.get("platform") != "official-supabase":
        raise DeployError("仅接受官方Supabase发布包")
    current = release_manifest()
    claimed = manifest["release"]
    digest = hashlib.sha256(json.dumps(claimed["files"], sort_keys=True).encode()).hexdigest()
    if digest != claimed["source_sha256"] or claimed["source_sha256"] != current["source_sha256"]:
        raise DeployError("当前源码与发布包漂移，请重新prepare")
    if checksum(directory / "frontend.zip") != manifest["frontend"]["archive_sha256"]:
        raise DeployError("前端归档摘要不匹配")
    if checksum(directory / "source.tar.gz") != manifest["source_archive_sha256"]:
        raise DeployError("源码归档摘要不匹配")
    return directory, manifest


@contextmanager
def verified_source_snapshot(directory, manifest):
    """云端写入只消费摘要已核对的归档，运行中工作区修改不能混入发布。"""
    with tempfile.TemporaryDirectory(prefix="shopro-release-") as temporary:
        snapshot_root = Path(temporary).resolve()
        expected = manifest["release"]["files"]
        seen = set()
        with tarfile.open(directory / "source.tar.gz", "r:gz") as archive:
            for member in archive.getmembers():
                target = snapshot_root / member.name
                if (member.name not in expected or member.name in seen or not member.isfile()
                        or not target.resolve().is_relative_to(snapshot_root)
                        or member.size > 64 * 1024 * 1024):
                    raise DeployError("源码归档包含未声明文件、链接或非法路径")
                data = archive.extractfile(member).read()
                if hashlib.sha256(data).hexdigest() != expected[member.name]:
                    raise DeployError("归档源码与发布文件指纹不匹配")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                seen.add(member.name)
        if seen != set(expected):
            raise DeployError("归档缺少发布源码")
        yield snapshot_root


def save_receipt(directory, action, data):
    folder = directory.parent / "receipts" / directory.name
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{action}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    with path.open("x") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
    path.chmod(0o600)
    return path


def cloud_action(args):
    directory, manifest = load_release(args.release)
    values = target_config(args.config)
    if manifest["frontend"]["backend_url"] != values["SUPABASE_URL"].rstrip("/"):
        raise DeployError("目标与前端归档后端不同")
    with verified_source_snapshot(directory, manifest) as snapshot_root:
        perform_cloud_action(args, directory, manifest, values, snapshot_root)


def perform_cloud_action(args, directory, manifest, values, snapshot_root):
    snapshot = inventory(values)
    save_receipt(directory, "inventory", snapshot)
    if args.action == "preflight":
        print(json.dumps({"project_ref": snapshot["project_ref"], "function_count": len(snapshot["functions"]),
            "tracked": snapshot["shape"]["tracked"], "production_accepted": False}))
        return
    files = [snapshot_root / "supabase/migrations" / item["name"] for item in manifest["migrations"]]
    if any(checksum(path) != item["sha256"] for path, item in zip(files, manifest["migrations"])):
        raise DeployError("发布迁移清单与归档不一致")
    pending = pending_migrations(snapshot, files)
    if args.action == "plan":
        path = save_receipt(directory, "migration-plan", {"project_ref": snapshot["project_ref"],
            "source_sha256": manifest["release"]["source_sha256"], "pending": [p.name for p in pending]})
        print(str(path)); return
    if args.action == "migrate":
        if not args.backup_file:
            raise DeployError("migrate必须指定当前目标的--backup-file")
        backup = Path(args.backup_file)
        if not backup.is_file() or backup.is_symlink() or backup.stat().st_size == 0:
            raise DeployError("备份文件无效")
        if pending:
            query(values, guarded_migration_sql(snapshot, pending), read_only=False)
        after = inventory(values)
        if pending_migrations(after, files):
            raise DeployError("迁移响应后仍有缺失，未认定完成")
        path = save_receipt(directory, "migrations", {"project_ref": snapshot["project_ref"],
            "source_sha256": manifest["release"]["source_sha256"], "backup_sha256": checksum(backup),
            "applied": [p.name for p in pending], "production_accepted": False})
        print(str(path)); return
    if pending:
        raise DeployError("目标尚有未发布迁移，拒绝先发布新函数")
    cli = Path(args.cli).resolve()
    if command([str(cli), "--version"]).strip() != CLI_VERSION:
        raise DeployError(f"必须使用官方Supabase CLI {CLI_VERSION}")
    environment = {key: value for key, value in os.environ.items() if not key.startswith("SUPABASE_")}
    environment["SUPABASE_ACCESS_TOKEN"] = values["SUPABASE_ACCESS_TOKEN"]
    existing_secrets = api(values, "/secrets")
    secret_names = {item["name"] for item in existing_secrets}
    secret_names.update(name for name in ("MODEL_CONFIG_ENCRYPTION_KEY", "MODEL_CONFIG_KEYRING") if values.get(name))
    if not secret_names.intersection({"MODEL_CONFIG_ENCRYPTION_KEY", "MODEL_CONFIG_KEYRING"}):
        raise DeployError("缺少模型加密主密钥/历史目录；先核对历史配置并安全保存，再发布新函数")
    # 保留原加密密钥目录，专用密钥保持原值；不擅自生成覆盖历史密钥。
    secrets = [{"name": "RELEASE_SOURCE_SHA256", "value": manifest["release"]["source_sha256"]}]
    for name in ("VIDEO_WORKER_SECRET", "MODEL_CONFIG_ENCRYPTION_KEY", "MODEL_CONFIG_KEYRING"):
        if values.get(name):
            secrets.append({"name": name, "value": values[name]})
    api(values, "/secrets", body=secrets)
    completed = []
    active_before = {item["slug"] or item["name"]: item for item in snapshot["functions"] if item["status"] == "ACTIVE"}
    prior = {}
    receipt_folder = directory.parent / "receipts" / directory.name
    for path in sorted(receipt_folder.glob("function-*.json")):
        receipt = json.loads(path.read_text())
        if receipt.get("source_sha256") == manifest["release"]["source_sha256"] and receipt.get("project_ref") == values["SUPABASE_PROJECT_REF"]:
            prior[receipt["function"]] = receipt
    for function in manifest["functions"]:
        name = function["name"]
        if (name in prior and active_before.get(name, {}).get("version") == prior[name].get("version")
                and active_before.get(name, {}).get("verify_jwt") == function["verify_jwt"]):
            completed.append(name)
            continue
        command([str(cli), "functions", "deploy", name, "--project-ref", values["SUPABASE_PROJECT_REF"],
                 "--workdir", str(snapshot_root), "--yes", "--use-api",
                 *(["--no-verify-jwt"] if not function["verify_jwt"] else [])],
                env=environment, timeout=180)
        completed.append(name)
        deployed = api(values, "/functions/" + name)
        save_receipt(directory, "function", {"project_ref": values["SUPABASE_PROJECT_REF"], "function": name,
            "version": deployed.get("version"),
            "source_sha256": manifest["release"]["source_sha256"], "captured_at": timestamp(),
            "production_accepted": False})
    after = inventory(values)
    active = {item["slug"] or item["name"] for item in after["functions"] if item["status"] == "ACTIVE"}
    if not set(completed).issubset(active):
        raise DeployError("函数发布后未全部ACTIVE")
    print(json.dumps({"functions_active": len(completed), "production_accepted": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "preflight", "plan", "migrate", "functions"])
    parser.add_argument("--config", default=str(ROOT / ".env.deploy.local"))
    parser.add_argument("--release")
    parser.add_argument("--backup-file")
    parser.add_argument("--cli", default=str(ROOT / ".supabase-tools" / CLI_VERSION / "supabase"))
    args = parser.parse_args()
    if args.action == "prepare":
        prepare()
    else:
        if not args.release:
            raise DeployError("请指定本次--release目录")
        cloud_action(args)


if __name__ == "__main__":
    try:
        main()
    except (DeployError, OSError, ValueError, subprocess.SubprocessError) as error:
        message = str(error) if isinstance(error, DeployError) else type(error).__name__
        print(json.dumps({"error": message, "production_accepted": False}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
