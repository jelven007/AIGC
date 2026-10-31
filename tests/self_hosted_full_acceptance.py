"""新建实例的全栈验收编排；全部请求和媒体处理使用实际部署组件。"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from self_hosted import COMPOSE, ROOT, compose, read_env, receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--project", required=True)
    args = parser.parse_args()
    if os.environ.get("SELF_HOSTED_ISOLATED_ACCEPTANCE") != "true":
        raise RuntimeError("只允许显式指定的新建隔离验收实例")
    state = Path(args.state_dir).resolve()
    env = state / "runtime.env"
    values = read_env(env)
    if values["COMPOSE_PROJECT_NAME"] != args.project:
        raise RuntimeError("验收项目不匹配")
    if (state / "receipts/full-acceptance.json").exists():
        raise RuntimeError("此实例已有全栈验收回执")
    prefix = ["docker", "compose", "--env-file", str(env), "-f", str(COMPOSE), "--profile", "setup"]

    def run(name, script, *extra, mounts=()):
        command = [*prefix, "run", "--rm", "--user", "0", "--entrypoint", "python",
                   "-e", "SELF_HOSTED_ISOLATED_ACCEPTANCE=true",
                   "-e", "SERVICE_ROLE_KEY=" + values["SERVICE_ROLE_KEY"],
                   "-e", "PUBLIC_ORIGIN=" + values["PUBLIC_ORIGIN"],
                   "-e", "ANON_KEY=" + values["ANON_KEY"]]
        for mount in mounts:
            command.extend(["-v", mount])
        command.extend(["acceptance", "/workspace/tests/" + script, *extra])
        result = subprocess.run(command, capture_output=True, text=True, timeout=240)
        log = state / "receipts" / (name + ".log")
        log.write_text(result.stdout + result.stderr)
        log.chmod(0o600)
        if result.returncode:
            raise RuntimeError(name + "失败，详见" + str(log))
        checks = json.loads(result.stdout.strip().splitlines()[-1])
        receipt(state, name + ".json", checks)
        print(json.dumps({"check": name, "passed": checks.get("passed", checks.get("prepared"))}), flush=True)

    fixtures = state / "fixtures"
    fixtures.mkdir(mode=0o755, exist_ok=True)
    for color in ("red", "blue"):
        subprocess.run(["docker", "run", "--rm", "--network", "none", "--user", "0",
            "-v", str(fixtures) + ":/fixtures", "--entrypoint", "ffmpeg", values["RENDERER_IMAGE"],
            "-v", "error", "-y", "-f", "lavfi", "-i", "color=" + color + ":s=1280x720:r=30:d=1",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-c:a", "aac",
            "-shortest", "/fixtures/" + color + ".mp4"], check=True, timeout=60)
    run("business-checks", "self_hosted_business.py")
    network = values["COMPOSE_PROJECT_NAME"] + "_default"
    media_command = ["docker", "run", "--rm", "--user", "0", "--network", network,
        "-v", str(ROOT) + ":/workspace:ro", "-v", str(state / "tls/ca.crt") + ":/run/tls/ca.crt:ro",
        "-v", str(state / "receipts") + ":/receipts:ro",
        "-e", "SELF_HOSTED_ISOLATED_ACCEPTANCE=true",
        "-e", "PUBLIC_ORIGIN=" + values["PUBLIC_ORIGIN"], "-e", "ANON_KEY=" + values["ANON_KEY"],
        "--entrypoint", "python", values["RENDERER_IMAGE"], "/workspace/tests/self_hosted_media_output.py"]
    media = subprocess.run(media_command, capture_output=True, text=True, timeout=90)
    if media.returncode:
        log = state / "receipts/media-output-error.log"
        log.write_text(media.stdout + media.stderr)
        log.chmod(0o600)
        raise RuntimeError("真实成片校验失败")
    receipt(state, "media-output-checks.json", json.loads(media.stdout))
    run("cache-checks", "self_hosted_cache.py")
    run("bootstrap-lifecycle-checks", "self_hosted_bootstrap_lifecycle.py")
    run("recovery-prepared", "self_hosted_recovery.py", "prepare",
        mounts=(str(state / "receipts") + ":/recovery",))
    compose(env, ["--profile", "execution", "restart", "scheduler", "maintenance", "renderer", "mcp",
                  "proxy", "functions", "realtime", "storage", "rest", "auth", "db"], timeout=300)
    compose(env, ["--profile", "execution", "up", "-d", "--wait"], timeout=300)
    run("recovery-checks", "self_hosted_recovery.py", "verify",
        mounts=(str(state / "receipts") + ":/recovery",))
    result = {"passed": True, "origin": values["PUBLIC_ORIGIN"], "project": args.project,
              "real_business_media_permissions_and_recovery": True,
              "live_model_payment_platform_acceptance": False}
    receipt(state, "full-acceptance.json", result)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
