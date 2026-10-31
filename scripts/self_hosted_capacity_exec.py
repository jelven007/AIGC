"""在ECS私有目录执行容量验收并采集容器/数据库样本，不打印凭据。"""
import argparse
import json
from pathlib import Path
import subprocess
import threading
import time

from self_hosted import ROOT, read_env


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "seed", "refresh", "logins", "load", "burst", "burst-check", "cleanup", "mcp", "guard"))
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--label", required=True)
    parser.add_argument("--seconds", type=int, default=180)
    parser.add_argument("--interval", type=float, default=1)
    parser.add_argument("--login-concurrency", type=int, default=100)
    args = parser.parse_args()
    values = read_env(args.state_dir / "runtime.env")
    if not args.work_dir.is_dir() or args.work_dir.stat().st_mode & 0o077:
        raise RuntimeError("测试回执需要已经存在的0700目录")
    command = ["docker", "run", "--rm", "--user", "0:0",
        "--network", values["COMPOSE_PROJECT_NAME"] + "_default",
        "-v", str(ROOT) + ":/workspace:ro", "-v", str(args.work_dir) + ":/capacity",
        "-v", str(args.state_dir / "tls") + ":/certs:ro",
        "-e", "SUPABASE_URL=" + values["PUBLIC_ORIGIN"],
        "-e", "SUPABASE_ANON_KEY=" + values["ANON_KEY"],
        "-e", "SUPABASE_SERVICE_ROLE_KEY=" + values["SERVICE_ROLE_KEY"],
        "--entrypoint", "python", values["MCP_IMAGE"],
        "/workspace/scripts/self_hosted_capacity_test.py", args.action,
        "--fixture", "/capacity/users.json", "--output", "/capacity/" + args.label + ".json",
        "--seconds", str(args.seconds), "--interval", str(args.interval),
        "--login-concurrency", str(args.login_concurrency),
        "--media", "/capacity/source.mp4"]
    stop, samples = threading.Event(), []

    def monitor():
        while not stop.is_set():
            stats = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{json .}}"],
                capture_output=True, text=True, timeout=15)
            query = """SELECT json_build_object('connections',count(*),
                'active',count(*) FILTER(WHERE state='active'),
                'lock_waiters',count(*) FILTER(WHERE wait_event_type='Lock'),
                'blocked',count(*) FILTER(WHERE cardinality(pg_blocking_pids(pid))>0),
                'render_running',(SELECT count(*) FROM public.production_jobs WHERE kind='render' AND status='running'),
                'render_pending',(SELECT count(*) FROM public.production_jobs WHERE kind='render' AND status IN ('pending','retry')))
                FROM pg_stat_activity;"""
            database = subprocess.run(["docker", "exec", "-i", values["COMPOSE_PROJECT_NAME"] + "-db-1",
                "bash", "-c", 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres -At'],
                input=query, capture_output=True, text=True, timeout=15)
            samples.append({"at": time.time(), "containers": [json.loads(line) for line in stats.stdout.splitlines()
                if line.startswith("{")], "database": json.loads(database.stdout) if database.returncode == 0 else None})
            stop.wait(2)
    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    try:
        log = args.work_dir / (args.label + ".log")
        with log.open("w") as stream:
            log.chmod(0o600)
            result = subprocess.run(command, stdout=stream, stderr=stream)
    finally:
        stop.set()
        thread.join(timeout=35)
        telemetry = args.work_dir / (args.label + "-telemetry.json")
        telemetry.write_text(json.dumps(samples, indent=2))
        telemetry.chmod(0o600)
    report = args.work_dir / (args.label + ".json")
    summary = json.loads(report.read_text()) if report.exists() else {"passed": False, "report_missing": True}
    summary["render_completed_count"] = len(summary.pop("render_completed", []))
    print(json.dumps(summary, ensure_ascii=False))
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
