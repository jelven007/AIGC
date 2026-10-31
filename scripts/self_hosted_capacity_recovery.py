"""容量发布后冷快照、26容器重启及新项目恢复演练；始终切回原实例。"""
import argparse
import ipaddress
import json
from pathlib import Path
import time

from self_hosted import ROOT, command, compose, read_env, receipt
from self_hosted_snapshot import backup, restore


def ensure_subnet_unused(subnet):
    requested = ipaddress.ip_network(subnet)
    if requested.version != 4 or not requested.is_private or not 32 <= requested.num_addresses <= 65536:
        raise RuntimeError("隔离恢复需要私有IPv4网段，地址数32至65536")
    identifiers = command(["docker", "network", "ls", "-q"]).split()
    networks = json.loads(command(["docker", "network", "inspect", *identifiers]))
    if any(requested.overlaps(ipaddress.ip_network(config["Subnet"]))
           for network in networks for config in network["IPAM"].get("Config") or []):
        raise RuntimeError("隔离恢复网段与现有Docker网络冲突；选择空闲网段后再开始快照")


def health(state):
    rows = [json.loads(line) for line in compose(state / "runtime.env",
        ["--profile", "execution", "ps", "--format", "json"]).splitlines() if line.strip()]
    if len(rows) != 26 or any(row["Health"] != "healthy" for row in rows):
        raise RuntimeError("容量实例必须有26个健康常驻容器")
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("state-dir", "target-dir", "artifact", "key-file"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--project", required=True)
    parser.add_argument("--subnet", required=True)
    parser.add_argument("--resume", action="store_true", help="继续已认证导入的新恢复实例，不覆盖或重新导入数据")
    args = parser.parse_args()
    state, target = args.state_dir, args.target_dir
    values = read_env(state / "runtime.env")
    if not args.resume and (args.artifact.exists() or target.exists()):
        raise RuntimeError("快照和恢复目录必须是新路径")
    if not args.resume:
        ensure_subnet_unused(args.subnet)
    report = {"passed": False, "origin": values["PUBLIC_ORIGIN"], "project": values["COMPOSE_PROJECT_NAME"]}
    report["restored_project"] = args.project
    report["restored_subnet"] = args.subnet
    if args.resume:
        restored_values = read_env(target / "runtime.env")
        manifest = json.loads((args.artifact / "manifest.json").read_text())
        if (restored_values["COMPOSE_PROJECT_NAME"] != args.project
                or restored_values["PUBLIC_ORIGIN"] != values["PUBLIC_ORIGIN"]
                or restored_values["DOCKER_SUBNET"] != args.subnet
                or manifest.get("project") != values["COMPOSE_PROJECT_NAME"]
                or manifest.get("cold_consistent") is not True):
            raise RuntimeError("恢复实例与已验证快照不匹配")
        report["backup"] = {"backed_up": True, "encrypted": True, "cold_consistent": True, "files": 5}
        report["restore"] = json.loads((target / "receipts/snapshot-restore.json").read_text())
        report["resumed_existing_restored_snapshot"] = True
        report["restarted_services_healthy"] = health(state)
    started = time.monotonic()
    try:
        if not args.resume:
            report["backup"] = backup(state, args.key_file, args.artifact)
            report["restarted_services_healthy"] = health(state)
            print(json.dumps({"phase": "cold_backup_and_restart", **report["backup"]}), flush=True)
            report["restore"] = restore(state, args.key_file, args.artifact, target, args.project,
                values["PUBLIC_ORIGIN"], args.subnet, dev_tls=True, bind="0.0.0.0")
        compose(state / "runtime.env", ["--profile", "execution", "stop"], timeout=300)
        command(["python3", str(ROOT / "scripts/self_hosted.py"), "up", "--state-dir", str(target)], timeout=600)
        result = compose(target / "runtime.env", ["--profile", "setup", "run", "--rm",
            "--entrypoint", "python", "--user", "0", "-e", "SELF_HOSTED_ISOLATED_ACCEPTANCE=true",
            "-v", str(target) + ":/state:ro", "acceptance", "/workspace/tests/self_hosted_restore_acceptance.py"],
            timeout=300)
        report["acceptance"] = json.loads(result)
        report["restored_services_healthy"] = health(target)
        report["passed"] = report["acceptance"]["passed"] is True
    except Exception as error:
        report["error"] = str(error)
    finally:
        if (target / "runtime.env").exists():
            compose(target / "runtime.env", ["--profile", "execution", "stop"], timeout=300)
        command(["python3", str(ROOT / "scripts/self_hosted.py"), "up", "--initial-admin",
            "--state-dir", str(state)], timeout=600)
        report["original_services_healthy"] = health(state)
        report["original_default_admin_rechecked"] = True
        report["seconds"] = round(time.monotonic() - started, 2)
        receipt(state, "capacity-recovery.json", report)
    print(json.dumps(report), flush=True)
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
