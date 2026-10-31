"""稳定开发入口：公开配置来自.env.local；不使用临时代理或部署密钥。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ROOT / "deploy/development/compose.yaml"
IMAGE = "node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da"
DEPENDENCIES = "shoproai-development-dependencies"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def public_environment():
    path = ROOT / ".env.local"
    if not path.exists():
        raise RuntimeError("缺少.env.local，请按.env.example配置公开后端URL和anon key")
    values = {}
    for line in path.read_text().splitlines():
        match = re.match(r"^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$", line)
        if match:
            values[match[1]] = match[2].strip("'\"")
    url = values.get("VITE_SUPABASE_URL", "").rstrip("/")
    key = values.get("VITE_SUPABASE_ANON_KEY", "")
    parsed = urlparse(url)
    if not key or not parsed.hostname or parsed.username or parsed.password:
        raise RuntimeError("公开后端配置无效")
    if parsed.scheme != "https" and parsed.hostname not in ("127.0.0.1", "localhost"):
        raise RuntimeError("远端后端必须使用HTTPS")
    env = dict(os.environ)
    # 只从已核对的项目公开配置注入，不继承旧容器或宿主VITE覆盖。
    env.update(SHOPRO_DEV_BACKEND_URL=url, SHOPRO_DEV_ANON_KEY=key)
    return url, key, env


def docker(args, *, capture=False, check=True, env=None):
    result = subprocess.run(
        ["docker", *args], cwd=ROOT, env=env, text=True,
        capture_output=capture, timeout=120 if capture else None,
    )
    if check and result.returncode:
        raise RuntimeError(f"Docker命令失败（退出码{result.returncode}）")
    return result


def compose(args, *, capture=False, check=True):
    _, _, env = public_environment()
    return docker(["compose", "-f", str(COMPOSE), *args], capture=capture, check=check, env=env)


def backend_report(url, key):
    def probe(path, method="GET", *, auth=False):
        request = urllib.request.Request(url + path, method=method,
                                         headers={"apikey": key, "Authorization": "Bearer " + key})
        try:
            with OPENER.open(request, timeout=10) as response:
                body = json.loads(response.read(4096)) if auth else None
                state = "ready" if auth and response.status == 200 and body.get("name") == "GoTrue" else "reachable"
                if auth and state != "ready":
                    state = "unavailable"
                return {"state": state, "http_status": response.status}
        except urllib.error.HTTPError as error:
            return {"state": "missing" if error.code == 404 else "unavailable", "http_status": error.code}
        except (OSError, ValueError, AttributeError):
            return {"state": "unavailable", "http_status": None}
    auth = probe("/auth/v1/health", auth=True)
    checks = {
        "model_settings_function": probe("/functions/v1/model-settings", "OPTIONS"),
        "model_configs_table": probe("/rest/v1/model_configs?select=slot&limit=0"),
    }
    states = {item["state"] for item in checks.values()}
    business = {"state": "missing" if "missing" in states else "unavailable" if "unavailable" in states else "reachable",
                "checks": checks, "authenticated_acceptance": "unverified"}
    return {"auth": auth, "business": business,
            "worker": {"state": "unverified", "reason": "公开开发配置不含专用Worker凭据；使用生产运行门禁核对完整源码和协议"},
            "full_stack_ready": False}


def backend_check():
    url, key, _ = public_environment()
    report = backend_report(url, key)
    lock = hashlib.sha256((ROOT / "pnpm-lock.yaml").read_bytes()).hexdigest()
    print(json.dumps({
        "backend": url, **report, "node": (ROOT / ".node-version").read_text().strip(),
        "pnpm": "10.34.5", "pnpm_lock_sha256": lock,
        "public_configuration": ".env.local", "temporary_proxy": False,
    }, ensure_ascii=False), flush=True)
    if report["auth"]["state"] != "ready":
        raise RuntimeError("目标Auth不可达或响应无效；请查看auth层诊断")


def seed_dependencies():
    existing = docker(["volume", "inspect", DEPENDENCIES], capture=True, check=False)
    if existing.returncode == 0:
        return
    docker(["volume", "create", DEPENDENCIES], capture=True)
    seed = ROOT / "node_modules"
    # 复用已经通过Linux Node22检查的依赖；最终仍执行权威锁冻结安装。
    if (seed / ".pnpm").exists():
        docker(["run", "--rm", "--entrypoint", "sh",
                "-v", f"{seed}:/seed:ro", "-v", f"{DEPENDENCIES}:/dependencies",
                IMAGE, "-c", "cp -a /seed/. /dependencies/"], capture=True)


def replace_legacy():
    found = docker(["inspect", "shoproai-web"], capture=True, check=False)
    if found.returncode:
        return
    container = json.loads(found.stdout)[0]
    labels = container["Config"].get("Labels") or {}
    if labels.get("com.docker.compose.project") == "shoproai-development":
        return
    owns = any(item.get("Source") == str(ROOT) and item.get("Destination") == "/app"
               for item in container.get("Mounts", []))
    if not owns:
        raise RuntimeError("5173容器属于其他检出，不能自动替换")
    archive_name = "shoproai-web-legacy-" + container["Id"][:12]
    print("替换已确认属于本检出的旧前端容器；保留旧容器作为恢复入口", flush=True)
    docker(["stop", "--timeout", "10", "shoproai-web"], capture=True)
    docker(["rename", "shoproai-web", archive_name], capture=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["run", "check", "status", "stop", "restart"])
    args = parser.parse_args()
    if args.action == "check":
        backend_check()
    elif args.action == "status":
        backend_check()
        compose(["ps"])
    elif args.action == "stop":
        compose(["stop", "web"])
    elif args.action == "restart":
        backend_check()
        compose(["restart", "web"])
    else:
        backend_check()
        compose(["config", "--quiet"], capture=True)
        seed_dependencies()
        replace_legacy()
        print("启动持久开发环境：http://127.0.0.1:5173", flush=True)
        # 前台Compose由调用方追踪；容器和依赖卷具有稳定名称与重启策略。
        result = compose(["up", "--no-build", "web"], check=False)
        return result.returncode
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
