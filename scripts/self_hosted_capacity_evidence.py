"""汇总容量实测和运行限额，公开输出不包含账号密码、JWT或服务密钥。"""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

from self_hosted import ROOT, read_env


def memory(value):
    number, unit = re.match(r"([\d.]+)([a-zA-Z]+)", value.strip()).groups()
    scale = {"B": 1, "kB": 1000, "MB": 1000**2, "GB": 1000**3,
             "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "TiB": 1024**4}
    return float(number) * scale[unit]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    values = read_env(args.state_dir / "runtime.env")
    report = {"origin": values["PUBLIC_ORIGIN"], "project": values["COMPOSE_PROJECT_NAME"],
              "phases": {}, "telemetry": {}}
    for name in ("baseline-login-burst", "baseline-mixed", "capacity-login-final", "capacity-smoke",
                 "capacity-final", "capacity-mcp", "capacity-overload", "capacity-overload-final",
                 "capacity-mcp-final", "capacity-guard", "capacity-recovered-final", "capacity-final-gateway",
                 "capacity-cleanup", "capacity-cleanup-final"):
        path = args.work_dir / (name + ".json")
        if not path.exists():
            continue
        result = json.loads(path.read_text())
        completed = result.pop("render_completed", [])
        result["render_completed_count"] = len(completed)
        if completed:
            dates = [(datetime.fromisoformat(c["created_at"]), datetime.fromisoformat(c["completed_at"])) for c in completed]
            durations = sorted((end-start).total_seconds() for start, end in dates)
            result["media"] = {"first_create_to_last_completion_seconds": round(
                (max(end for _, end in dates)-min(start for start, _ in dates)).total_seconds(), 3),
                "task_end_to_end_p50_seconds": round(durations[len(durations)//2], 3),
                "task_end_to_end_p95_seconds": round(durations[int(len(durations)*.95)], 3),
                "minimum_bytes": min(c["bytes"] for c in completed),
                "maximum_bytes": max(c["bytes"] for c in completed),
                "all_attempts_one": all(c["attempts"] == 1 for c in completed),
                "durations": sorted({c["duration"] for c in completed}),
                "resolutions": sorted({c["resolution"] for c in completed})}
        report["phases"][name] = result
        samples_path = args.work_dir / (name + "-telemetry.json")
        if not samples_path.exists():
            continue
        samples = json.loads(samples_path.read_text())
        maxima, cpu_peak, memory_peak, database = {}, 0, 0, {}
        for sample in samples:
            cpu_total = memory_total = 0
            for container in sample["containers"]:
                container_name = container["Name"]
                if not container_name.startswith(values["COMPOSE_PROJECT_NAME"] + "-"):
                    continue
                cpu = float(container["CPUPerc"].rstrip("%"))
                used = memory(container["MemUsage"].split("/")[0])
                cpu_total += cpu
                memory_total += used
                item = maxima.setdefault(container_name, {"cpu_percent_peak": 0, "memory_mib_peak": 0, "pids_peak": 0})
                item["cpu_percent_peak"] = max(item["cpu_percent_peak"], cpu)
                item["memory_mib_peak"] = round(max(item["memory_mib_peak"], used / 1024**2), 2)
                item["pids_peak"] = max(item["pids_peak"], int(container["PIDs"]))
            cpu_peak = max(cpu_peak, cpu_total)
            memory_peak = max(memory_peak, memory_total)
            for key, value in (sample.get("database") or {}).items():
                database[key + "_peak"] = max(database.get(key + "_peak", 0), value)
        report["telemetry"][name] = {"samples": len(samples), "cpu_percent_sum_peak": round(cpu_peak, 2),
            "host_64cpu_utilization_percent_peak": round(cpu_peak / 64, 2),
            "memory_gib_sum_peak": round(memory_peak / 1024**3, 3),
            "database": database, "containers": maxima}
    containers = json.loads(subprocess.check_output(["docker", "inspect", *subprocess.check_output(
        ["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=" + values["COMPOSE_PROJECT_NAME"]],
        text=True).split()]))
    report["runtime"] = {"containers": len(containers), "healthy": sum(
        c["State"].get("Health", {}).get("Status") == "healthy" for c in containers),
        "oom_killed": sum(c["State"].get("OOMKilled", False) for c in containers),
        "restarts": sum(c["RestartCount"] for c in containers),
        "cpu_budget": sum(c["HostConfig"]["NanoCpus"] / 1e9 for c in containers),
        "renderer_image": values["RENDERER_IMAGE"], "mcp_image": values["MCP_IMAGE"],
        "renderer_replicas": int(values["RENDERER_REPLICAS"])}
    report["configuration_sha256"] = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in
        ("deploy/self-hosted/compose.yaml", "deploy/self-hosted/capacity-100.json",
         "deploy/self-hosted/nginx.conf", "deploy/self-hosted/nginx.conf.template")}
    recovery = args.state_dir / "receipts/capacity-recovery.json"
    if recovery.exists():
        report["recovery"] = json.loads(recovery.read_text())
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    args.output.chmod(0o600)
    print(json.dumps({"phases": list(report["phases"]), "runtime": report["runtime"]}))


if __name__ == "__main__":
    main()
