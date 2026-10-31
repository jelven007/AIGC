"""火山 BaaS 部署：本地准备、带校验值的迁移、函数部署和 Pages 发布。"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "deploy/volcengine/manifest.json"
OUTPUT = ROOT / ".volcengine-build"
LEDGER = "shopro_deploy.schema_migrations"
CONTRACT = json.loads((ROOT / "scripts/runtime-contract.json").read_text())


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def migration_files():
    excluded = set(json.loads(MANIFEST.read_text())["skip_migrations"])
    files = [path for path in sorted((ROOT / "supabase/migrations").glob("*.sql"))
             if path.name not in excluded]
    versions = [path.name.split("_", 1)[0] for path in files]
    if len(set(versions)) != len(versions):
        raise ValueError("迁移版本号重复")
    return files


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def release_manifest():
    """仅记录可从本地源码验证的事实，不推断云端启用或验收状态。"""
    paths = set()
    for directory, patterns in {
        "src": ["*.ts", "*.tsx", "*.css"],
        "supabase/functions": ["*.ts", "deno.json", "deno.lock"],
        "supabase/migrations": ["*.sql"],
        "worker": ["*.py", "*.txt", "*.lock", "*.onnx", "LICENSE", "NOTICE", "Dockerfile"],
        "mcp": ["*.py", "*.json", "*.txt", "*.lock", "Dockerfile.mcp"],
        "scripts": ["*.py", "*.mjs", "*.sh", "runtime-contract.json"],
        "deploy": ["*.json", "*.yaml", "*.yml", "*.conf", "*.template", "*.example", "*.sql", "*.ts", "Dockerfile", "Dockerfile.*", "requirements.txt", "*.lock"],
    }.items():
        for pattern in patterns:
            for path in (ROOT / directory).rglob(pattern):
                if any(part in ("node_modules", "__pycache__", ".temp") for part in path.relative_to(ROOT).parts):
                    continue
                if path.name in ("config.json", "alert-delivery.json", "acceptance.json") or path.name.endswith(".local"):
                    continue
                paths.add(path)
    for name in ("package.json", "pnpm-lock.yaml", ".node-version", ".npmrc", ".dockerignore", ".env.example",
                 "index.html",
                 "vite.config.mjs", "vite.config.dev.ts", "tsconfig.check.json",
                 "tailwind.config.js", "postcss.config.js",
                 "supabase/config.toml", "docs/ai/evaluation-v1.json", "docs/lifecycle.json"):
        paths.add(ROOT / name)
    # 静态资源也进入产物；只记录TS/CSS会漏掉首页、字体和图片变化。
    paths.update(p for p in (ROOT / "public").rglob("*") if p.is_file())
    for pattern in ("*.svg", "*.png", "*.jpg", "*.json", "*.woff", "*.woff2"):
        paths.update((ROOT / "src").rglob(pattern))
    files = {str(p.relative_to(ROOT)): checksum(p) for p in sorted(paths)}
    catalog = json.loads((ROOT / "mcp/tools.json").read_text())
    tools = catalog["tools"]
    source_digest = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    return {
        "schema_version": 1,
        "version": json.loads((ROOT / "package.json").read_text())["version"],
        "git_sha": run_local(["git", "rev-parse", "HEAD"]).strip(),
        "source_sha256": source_digest,
        "files": files,
        "functions": [item["name"] for item in json.loads(MANIFEST.read_text())["functions"]],
        "protocols": {"render": 4, "edit": 2},
        "worker_contract": CONTRACT,
        "mcp": {"tool_count": len(tools), "catalog_sha256": checksum(ROOT / "mcp/tools.json")},
        "runtime": {"node": "22.23.4", "pnpm": "10.34.5", "deno": "2.2.6"},
    }


def check_release_receipt():
    receipt = json.loads((OUTPUT / "manifest.json").read_text()).get("release", {})
    current = release_manifest()
    if receipt.get("source_sha256") != current["source_sha256"] or receipt.get("git_sha") != current["git_sha"]:
        raise RuntimeError("源码与全栈发布回执不一致，请重新 prepare")

def write_frontend_identity(directory, release):
    identity = {key: release[key] for key in ("version", "git_sha", "source_sha256", "worker_contract")}
    (directory / "release-identity.json").write_text(json.dumps(identity, ensure_ascii=False))


def migration_sql(files):
    # 每一批迁移及回执在同一事务，响应丢失后可从数据库回执恢复。
    setup = f"""
BEGIN;
SELECT pg_advisory_xact_lock(7348219901);
CREATE SCHEMA IF NOT EXISTS shopro_deploy;
REVOKE ALL ON SCHEMA shopro_deploy FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS {LEDGER} (
  version text PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
"""
    chunks = [setup]
    for path in files:
        # 历史文件只有顶层事务标记；不能把内层 COMMIT 带入部署事务。
        source = re.sub(r"(?im)^\s*(BEGIN|COMMIT);\s*$", "", path.read_text())
        version = path.name.split("_", 1)[0]
        chunks.append(f"\n-- {path.name}\n{source}\n")
        chunks.append(f"INSERT INTO {LEDGER}(version,name,sha256) VALUES "
                      f"('{version}','{path.name}','{checksum(path)}');\n")
    chunks.append("COMMIT;\n")
    return "".join(chunks)


def run_local(args, **kwargs):
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True, timeout=240, **kwargs)
    if result.returncode:
        # 命令输出可能含密钥或连接串，失败时只报告程序与状态码。
        raise RuntimeError(f"{Path(args[0]).name} 执行失败（退出码 {result.returncode}）")
    return result.stdout


def public_config(args):
    if not args.backend_url or not args.anon_key_file:
        raise ValueError("前端构建必须指定 --backend-url 和 --anon-key-file")
    url = args.backend_url.rstrip("/")
    if urlparse(url).scheme != "https":
        raise ValueError("火山后端地址必须使用 HTTPS")
    key = Path(args.anon_key_file).read_text().strip()
    if not key:
        raise ValueError("anon key 文件为空")
    if not key.startswith("sb_publishable_"):
        try:
            payload = key.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        except Exception:
            raise ValueError("前端密钥必须为 anon JWT 或 publishable key") from None
        if claims.get("role") != "anon":
            raise ValueError("禁止将 service_role 或用户 JWT 用作前端 anon key")
    return url, key


def legal_config(args):
    result = {}
    for name in ("terms", "privacy"):
        value = getattr(args, f"{name}_url", None) or os.environ.get(f"VITE_{name.upper()}_URL", "")
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError(f"注册发布必须提供正式 HTTPS --{name}-url 或 VITE_{name.upper()}_URL")
        result[name] = value
    return result


def strings(data):
    if isinstance(data, str):
        yield data
    elif isinstance(data, list):
        for value in data:
            yield from strings(value)
    elif isinstance(data, dict):
        for value in data.values():
            yield from strings(value)


def cli(args, action, target=True):
    executable = shutil.which(args.cli)
    if not executable:
        raise RuntimeError("未安装 byted-supabase-cli；参见部署文档")
    command = [executable, "--agent", "yes", "--region", args.region, *action]
    if target:
        if not args.workspace_id:
            raise ValueError("云端操作必须指定 --workspace-id")
        command += ["--workspace-id", args.workspace_id]
        if args.branch_id:
            command += ["--branch-id", args.branch_id]
    return run_local(command)


def rows(data):
    """兼容 CLI 的 rows/data/结果集包装，不从日志猜测执行成功。"""
    if isinstance(data, list):
        if all(isinstance(row, dict) and not any(
            key in row for key in ("rows", "Rows", "results")) for row in data):
            return data
        return [item for block in data for item in rows(block)]
    if isinstance(data, dict):
        for key in ("rows", "data", "Data", "Rows", "results"):
            if key in data:
                return rows(data[key])
    raise RuntimeError("无法识别 CLI SQL 输出格式")


def query(args, statement):
    return rows(json.loads(cli(args, ["db", "query", statement, "-o", "json"])))


def ensure_login(args):
    # 本地配置探测不触发登录；缺少 profile 立即退出，避免浏览器等待。
    cli(args, ["configure", "get", "-o", "json"], target=False)
    cli(args, ["projects", "list", "--limit", "10", "-o", "json"], target=False)


def prepare(args):
    files = migration_files()
    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT / "bootstrap.sql").write_text(migration_sql(files))
    receipt = {
        "platform": "volcengine-supabase",
        "release": release_manifest(),
        "migrations": [{"version": p.name.split("_", 1)[0], "name": p.name, "sha256": checksum(p)} for p in files],
        "functions": json.loads(MANIFEST.read_text())["functions"],
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
    if not args.skip_build:
        url, key = public_config(args)
        legal = legal_config(args)
        env = dict(os.environ, VITE_SUPABASE_URL=url, VITE_SUPABASE_ANON_KEY=key,
                   VITE_TERMS_URL=legal["terms"], VITE_PRIVACY_URL=legal["privacy"])
        run_local(["pnpm", "run", "typecheck"])
        run_local(["pnpm", "run", "build"], env=env)
        write_frontend_identity(ROOT / "dist", receipt["release"])
        receipt["frontend"] = {
            "backend_url": url, "anon_key_sha256": hashlib.sha256(key.encode()).hexdigest(),
            "legal_urls": legal,
        }
        with zipfile.ZipFile(OUTPUT / "frontend.zip", "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted((ROOT / "dist").rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(ROOT / "dist"))
        receipt["frontend"]["archive_sha256"] = checksum(OUTPUT / "frontend.zip")
        (OUTPUT / "manifest.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
    print(f"已准备 {len(files)} 个生产迁移与部署清单：{OUTPUT}")


def migrate(args):
    existing = query(args, "SELECT to_regclass('shopro_deploy.schema_migrations') IS NOT NULL AS tracked, "
                     "to_regclass('public.profiles') IS NOT NULL AS initialized;")[0]
    if existing["tracked"]:
        applied = query(args, f"SELECT version,sha256 FROM {LEDGER} ORDER BY version;")
    else:
        if existing["initialized"]:
            raise RuntimeError("目标含业务表但无部署回执；需先核对历史迁移，禁止盲目重放")
        applied = []
    known = {row["version"]: row["sha256"] for row in applied}
    files = migration_files()
    for path in files:
        version = path.name.split("_", 1)[0]
        if version in known and known[version] != checksum(path):
            raise RuntimeError(f"已应用的迁移校验值变更：{path.name}")
    if set(known) - {p.name.split("_", 1)[0] for p in files}:
        raise RuntimeError("目标包含当前代码未知的迁移")
    pending = [p for p in files if p.name.split("_", 1)[0] not in known]
    if pending:
        with tempfile.TemporaryDirectory(prefix="migrate-", dir=OUTPUT) as directory:
            path = Path(directory) / "pending.sql"
            path.write_text(migration_sql(pending))
            cli(args, ["db", "query", "-f", str(path)])
    verified = query(args, f"SELECT version,sha256 FROM {LEDGER} ORDER BY version;")
    if {row["version"]: row["sha256"] for row in verified} != {
        p.name.split("_", 1)[0]: checksum(p) for p in files
    }:
        raise RuntimeError("迁移回执验证失败")
    print(f"迁移验证通过，本次应用 {len(pending)} 个")


def functions(args):
    check_release_receipt()
    for function in json.loads(MANIFEST.read_text())["functions"]:
        command = ["functions", "deploy", function["name"], "--runtime", "deno"]
        if not function["verify_jwt"]:
            command.append("--no-verify-jwt")
        cli(args, command)
        print(f"已部署 {function['name']}")
    cli(args, ["functions", "list", "-o", "json"])


def field(data, name):
    if isinstance(data, dict):
        if name in data:
            return data[name]
        for value in data.values():
            try:
                return field(value, name)
            except KeyError:
                pass
    raise KeyError(f"CLI 未返回 {name}")


def pages(args):
    if not args.pages_project_id:
        raise ValueError("发布必须指定 --pages-project-id；首次创建命令见部署文档")
    archive = OUTPUT / "frontend.zip"
    if not archive.is_file():
        raise RuntimeError("请先执行 prepare 构建前端")
    url, key = public_config(args)
    receipt = json.loads((OUTPUT / "manifest.json").read_text()).get("frontend", {})
    if receipt.get("backend_url") != url or receipt.get("anon_key_sha256") != hashlib.sha256(key.encode()).hexdigest() \
      or receipt.get("archive_sha256") != checksum(archive):
        raise RuntimeError("前端构建配置或归档校验值不匹配，请重新 prepare")
    if receipt.get("legal_urls") != legal_config(args):
        raise RuntimeError("正式协议配置与构建回执不匹配，请重新 prepare")
    check_release_receipt()
    endpoints = json.loads(cli(args, ["endpoints", "list", "-o", "json"]))
    if not any(value.rstrip("/") == url or value == urlparse(url).hostname for value in strings(endpoints)):
        raise RuntimeError("构建地址不匹配目标 workspace endpoint，禁止发布")
    keys = json.loads(cli(args, ["projects", "api-keys", "--reveal", "-o", "json"]))
    if key not in set(strings(keys)):
        raise RuntimeError("构建 anon key 不属于目标 workspace")
    verify(args)
    resource = json.loads(cli(args, ["pages", "upload", str(archive), "-o", "json"], target=False))
    resource_id = field(resource, "ProjectDeployResourceID")
    cli(args, ["pages", "bind", args.pages_project_id, "--framework-prefix", "VITE_"])
    cli(args, ["pages", "deploy", args.pages_project_id, "--resource-id", resource_id], target=False)
    print("Pages 发布请求已提交；使用 pages deploy list 和 pages binding 查看结果")


def verify(args):
    check_release_receipt()
    applied = query(args, f"SELECT version,sha256 FROM {LEDGER} ORDER BY version;")
    if {row["version"]: row["sha256"] for row in applied} != {
        p.name.split("_", 1)[0]: checksum(p) for p in migration_files()
    }:
        raise RuntimeError("目标数据库迁移尚未就绪")
    if not args.worker_secret_file:
        raise ValueError("验证必须指定 --worker-secret-file")
    url, _ = public_config(args)
    secret = Path(args.worker_secret_file).read_text().strip()
    request = Request(f"{url}/functions/v1/production-worker", data=b'{"action":"probe"}',
                      headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"})
    try:
        with build_opener(NoRedirect).open(request, timeout=30) as response:
            raw = response.read(65537)
            if len(raw) > 65536:
                raise ValueError("invalid response")
            result = json.loads(raw)
        prepared = json.loads((OUTPUT / "manifest.json").read_text())["release"]
        if (result.get("ready") is not True or any(result.get(key) != value for key, value in CONTRACT.items())
                or result.get("missing") != [] or result.get("source_sha256") != prepared["source_sha256"]):
            raise ValueError("not ready")
    except Exception:
        raise RuntimeError("Worker 只读预检失败，请检查部署与专用密钥") from None
    print("数据库回执和 Worker 只读预检通过；后台调度及真实模型仍需运行验收")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "migrate", "functions", "verify", "pages"])
    parser.add_argument("--workspace-id")
    parser.add_argument("--branch-id")
    parser.add_argument("--region", default="cn-beijing")
    parser.add_argument("--cli", default="byted-supabase-cli")
    parser.add_argument("--pages-project-id")
    parser.add_argument("--backend-url")
    parser.add_argument("--anon-key-file")
    parser.add_argument("--terms-url")
    parser.add_argument("--privacy-url")
    parser.add_argument("--worker-secret-file")
    parser.add_argument("--skip-build", action="store_true")
    args = parser.parse_args()
    try:
        OUTPUT.mkdir(exist_ok=True)
        if args.action != "prepare":
            ensure_login(args)
        {"prepare": prepare, "migrate": migrate, "functions": functions, "verify": verify, "pages": pages}[args.action](args)
        return 0
    except (RuntimeError, ValueError, KeyError, subprocess.TimeoutExpired, OSError, json.JSONDecodeError) as cause:
        print(str(cause), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
