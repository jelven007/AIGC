"""启动/查看/停止独立 Docker 调度器，启动前先执行不消费任务的远端预检。"""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / "deploy/video-scheduler"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "status", "stop", "logs"])
    args = parser.parse_args()
    compose = ["docker", "compose", "-f", str(DIRECTORY / "compose.yaml"),
               "--env-file", str(DIRECTORY / ".env")]
    if not (DIRECTORY / ".env").is_file() or not (DIRECTORY / "video_worker_secret").is_file():
        print("缺少 deploy/video-scheduler/.env 或 video_worker_secret；参见 docs/VIDEO_SCHEDULER.md",
              file=sys.stderr)
        return 1
    try:
        configuration = subprocess.run(compose + ["config", "--format", "json"], capture_output=True,
            text=True, timeout=30, check=True)
        production = json.loads(configuration.stdout)["services"]["video-scheduler"]["environment"].get(
            "PRODUCTION_WORKER_ENABLED") == "true"
    except (subprocess.SubprocessError, ValueError, KeyError, TypeError):
        print("调度配置不可读或无效，请检查Compose环境文件。", file=sys.stderr)
        return 1
    services = ["video-scheduler"]
    if production:
        compose += ["--profile", "production"]
        services.append("maintenance-scheduler")
    if args.action == "start":
        try:
            result = subprocess.run(compose + ["run", "--rm", "--build", "--no-deps", "video-scheduler",
                "python", "/app/run_video_worker.py", "--probe"], cwd=DIRECTORY, timeout=240)
            if result.returncode:
                print("预检未通过，未启动调度。请检查匹配的Worker、迁移契约和专用密钥。", file=sys.stderr)
                return result.returncode
            return subprocess.run(compose + ["up", "-d", "--no-build"] + services,
                cwd=DIRECTORY, timeout=60).returncode
        except subprocess.TimeoutExpired:
            print("预检或构建超时，未启动后台调度。", file=sys.stderr)
            return 1
    commands = {
        "status": ["ps", "--format", "json"],
        "stop": ["stop"] + services,
        "logs": ["logs", "--tail", "30"] + services,
    }
    try:
        return subprocess.run(compose + commands[args.action], cwd=DIRECTORY, timeout=180).returncode
    except subprocess.TimeoutExpired:
        print("调度器管理命令超时。", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
