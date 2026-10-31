"""生产运行门禁：校验本次包/运行镜像及目标只读接受，完整probe后才能启动。"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import urllib.request
import zipfile

from deploy_supabase import DeployError, NoRedirect, env_file

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ROOT / "deploy/production/compose.yaml"
sys.path.insert(0, str(ROOT / "mcp"))
from host_config import parse_allowed_hosts


def check_mcp_hosts(values):
    try:
        hosts = parse_allowed_hosts(values.get("MCP_ALLOWED_HOSTS", ""))
    except ValueError as error:
        raise DeployError(str(error)) from None
    if "127.0.0.1:8080" not in hosts or not any(
            host.split(":")[0] not in ("localhost", "127.0.0.1") for host in hosts):
        raise DeployError("MCP白名单必须包含正式Host和本地探针127.0.0.1:8080")
    return hosts


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_bundle(directory):
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest.get("platform") != "official-supabase":
        raise DeployError("生产运行只接受本次官方发布包")
    release = manifest["release"]
    digest = hashlib.sha256(json.dumps(release["files"], sort_keys=True).encode()).hexdigest()
    if digest != release["source_sha256"]:
        raise DeployError("发布指纹自检失败")
    if sha(directory / "source.tar.gz") != manifest["source_archive_sha256"]:
        raise DeployError("源码归档摘要不匹配")
    if sha(directory / "frontend.zip") != manifest["frontend"]["archive_sha256"]:
        raise DeployError("前端归档摘要不匹配")
    with zipfile.ZipFile(directory / "frontend.zip") as archive:
        names = {item.filename for item in archive.infolist()}
        actual_names = {str(p.relative_to(directory / "frontend")) for p in (directory / "frontend").rglob("*") if p.is_file()}
        if names != actual_names:
            raise DeployError("前端实际目录有未归档或缺失文件")
        for item in archive.infolist():
            path = (directory / "frontend" / item.filename).resolve()
            raw_path = directory / "frontend" / item.filename
            if raw_path.is_symlink() or not path.is_relative_to((directory / "frontend").resolve()) or not path.is_file() or path.read_bytes() != archive.read(item):
                raise DeployError("实际前端目录与归档不一致")
    identity = json.loads((directory / "frontend/release-identity.json").read_text())
    if identity.get("source_sha256") != digest or identity.get("worker_contract") != release["worker_contract"]:
        raise DeployError("前端发布身份不匹配")
    # 接受快照中的运行配置；ECS无需保留.git或从Git版本推断产物。
    for name, expected in release["files"].items():
        if (name.startswith(("scripts/", "deploy/production/")) or name == "mcp/host_config.py") and sha(ROOT / name) != expected:
            raise DeployError("实际运行脚本/Compose与发布快照不同")
    return manifest


def check_acceptance(receipt, values, manifest, *, now=None):
    ref = values["SUPABASE_URL"].split("//", 1)[1].split(".", 1)[0]
    current = now or datetime.now(timezone.utc)
    captured = datetime.fromtimestamp(receipt.get("captured_at", 0), tz=timezone.utc)
    if not 0 <= (current - captured).total_seconds() <= 86400:
        raise DeployError("目标接受回执已过期或时间无效")
    if (receipt.get("technical_ready") is not True or receipt.get("isolated") is not False
            or receipt.get("environment") != f"official-supabase-{ref}"
            or receipt.get("source_sha256") != manifest["release"]["source_sha256"]):
        raise DeployError("需要该原目标和本次源码的真实只读接受回执")
    required = {"release_manifest", "database", "worker", "auth_settings", "private_storage", "frontend"}
    if set(receipt.get("checks", {})) != required or not all(receipt["checks"].values()):
        raise DeployError("目标接受检查不完整")


def worker_probe(values, manifest):
    base = values["SUPABASE_URL"]
    if base != manifest["frontend"]["backend_url"] or not re.fullmatch(r"https://[a-z]{20}\.supabase\.co", base):
        raise DeployError("运行后端与本次前端不匹配")
    path = Path(values["RUNTIME_SECRETS_DIR"]) / "video_worker_secret"
    if not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o077:
        raise DeployError("专用Worker密钥必须为普通0600文件")
    secret = path.read_text().strip()
    if len(secret) < 32 or "\n" in secret or "\r" in secret:
        raise DeployError("专用Worker密钥无效")
    request = urllib.request.Request(base + "/functions/v1/production-worker",
        data=b'{"action":"probe"}', method="POST",
        headers={"Authorization": "Bearer " + secret, "Content-Type": "application/json"})
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
        with opener.open(request, timeout=20) as response:
            reply = json.loads(response.read(16384))
    except Exception:
        raise DeployError("真实目标production-worker预检失败；没有启动派发") from None
    expected = manifest["release"]["worker_contract"]
    if (reply.get("ready") is not True or reply.get("missing") != []
            or reply.get("source_sha256") != manifest["release"]["source_sha256"]
            or any(reply.get(key) != value for key, value in expected.items())):
        raise DeployError("目标完整源码/迁移/媒体协议不匹配；没有启动派发")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["check", "start", "status", "stop"])
    parser.add_argument("--env-file", default=str(ROOT / "deploy/production/runtime.env"))
    parser.add_argument("--acceptance", default=str(ROOT / "deploy/production/acceptance.json"))
    parser.add_argument("--old-dispatch-disabled", action="store_true",
                        help="仅在已查询确认原云端Cron/旧主机派发停止后使用")
    args = parser.parse_args()
    values = env_file(args.env_file)
    compose = ["docker", "compose", "--env-file", str(Path(args.env_file).resolve()),
               "-f", str(COMPOSE), "--profile", "execution"]
    if args.action in ("status", "stop"):
        subprocess.run(compose + (["ps"] if args.action == "status" else ["stop"]), check=True, timeout=180)
        return
    directory = Path(values["RELEASE_DIR"]).resolve()
    check_mcp_hosts(values)
    manifest = verify_bundle(directory)
    receipt_path = Path(args.acceptance)
    if not receipt_path.is_file() or receipt_path.is_symlink() or receipt_path.stat().st_mode & 0o077:
        raise DeployError("缺少普通0600目标接受回执")
    check_acceptance(json.loads(receipt_path.read_text()), values, manifest)
    for role, variable in (("scheduler", "SCHEDULER_IMAGE"), ("renderer", "RENDERER_IMAGE"), ("mcp", "MCP_IMAGE")):
        inspected = subprocess.run(["docker", "image", "inspect", values[variable]], check=True,
                                   capture_output=True, text=True, timeout=30)
        info = json.loads(inspected.stdout)[0]
        if info["Id"] != manifest["images"][role]["image_id"]:
            raise DeployError(f"{role}运行镜像不是本次已验证的镜像ID")
    worker_probe(values, manifest)
    if args.action == "start":
        if not args.old_dispatch_disabled:
            raise DeployError("先只读确认旧Cron/旧主机派发已停止，再使用--old-dispatch-disabled")
        subprocess.run(compose + ["up", "-d", "--no-build", "--pull", "never"], check=True, timeout=120)
    print(json.dumps({"target_probe": "ready", "source_sha256": manifest["release"]["source_sha256"],
                      "started": args.action == "start", "production_accepted": False}))


if __name__ == "__main__":
    try:
        main()
    except (DeployError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        message = str(error) if isinstance(error, DeployError) else type(error).__name__
        print(json.dumps({"error": message, "start_succeeded": False,
                          "runtime_state": "请通过status核对；Compose错误可能已启动部分服务"}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
