"""单机停机一致性加密快照；仅恢复到新项目、新目录及不存在的数据卷。"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

from self_hosted import ROOT, SelfHostError, compose, command, read_env, write_private, receipt, tls, publish_runtime

DATA_VOLUMES = ("postgres", "storage", "media", "scheduler-alerts")


def volume(project, name):
    return project + ("-postgres" if name == "postgres" else "_" + name)


def inner(action, name):
    from backup_restore import encrypt_file, decrypt_file
    key = bytes.fromhex(Path("/key").read_text().strip())
    if len(key) != 32:
        raise SelfHostError("快照密钥必须为32字节十六进制")
    with tempfile.TemporaryDirectory() as temporary:
        plain = Path(temporary) / "data.tar"
        if action == "export":
            with tarfile.open(plain, "w:") as archive:
                archive.add("/data", arcname="data", recursive=True)
            result = encrypt_file(plain, Path("/backup") / (name + ".enc"), key, name)
        else:
            result = decrypt_file(Path("/backup") / (name + ".enc"), plain, key, name)
            with tarfile.open(plain, "r:") as archive:
                for member in archive.getmembers():
                    path = Path(member.name)
                    if path.is_absolute() or ".." in path.parts or path.parts[0] != "data" or member.isdev():
                        raise SelfHostError("快照归档路径错误")
                    if member.issym() or member.islnk():
                        link = Path(member.linkname)
                        if link.is_absolute() or ".." in link.parts:
                            raise SelfHostError("快照归档链接错误")
                archive.extractall(temporary, filter="fully_trusted")
            target = Path("/data")
            if any(target.iterdir()):
                raise SelfHostError("恢复目录非空")
            incoming = Path(temporary) / "data"
            # 保留数据库/Storage文件的UID、GID和权限。
            command(["cp", "-a", str(incoming) + "/.", str(target)])
            os.chown(target, incoming.stat().st_uid, incoming.stat().st_gid)
            target.chmod(incoming.stat().st_mode & 0o777)
        print(json.dumps(result))


def helper(values, key, artifact, data, action, name):
    return json.loads(command(["docker", "run", "--rm", "--network", "none", "--user", "0:0",
        "-v", str(ROOT) + ":/workspace:ro", "-v", str(key) + ":/key:ro",
        "-v", str(artifact) + ":/backup" + (":ro" if action == "import" else ""),
        "-v", str(data) + ":/data" + (":ro" if action == "export" else ""),
        "--entrypoint", "python", values["BACKUP_IMAGE"], "/workspace/scripts/self_hosted_snapshot.py",
        "inner-" + action, "--name", name], timeout=600))


def backup(state, key, output):
    values = read_env(state / "runtime.env")
    if output.exists() or not key.is_file() or key.stat().st_mode & 0o077:
        raise SelfHostError("需要新快照目录及0600密钥文件")
    output.mkdir(mode=0o700)
    result = {"format": 1, "project": values["COMPOSE_PROJECT_NAME"], "files": {}, "cold_consistent": True}
    compose(state / "runtime.env", ["--profile", "execution", "stop"], timeout=300)
    try:
        for name in DATA_VOLUMES:
            result["files"][name] = helper(values, key, output, volume(values["COMPOSE_PROJECT_NAME"], name), "export", name)
        result["files"]["state"] = helper(values, key, output, state, "export", "state")
        (output / "manifest.json").write_text(json.dumps(result, indent=2))
        (output / "manifest.json").chmod(0o600)
    finally:
        compose(state / "runtime.env", ["--profile", "execution", "up", "-d", "--wait"], timeout=300)
    return {"backed_up": True, "encrypted": True, "cold_consistent": True, "files": len(result["files"])}


def restore(source_state, key, artifact, target, project, origin, subnet, dev_tls=False, certificate=None, certificate_key=None,
            bind="127.0.0.1"):
    values = read_env(source_state / "runtime.env")
    manifest = json.loads((artifact / "manifest.json").read_text())
    if (manifest.get("format") != 1 or manifest.get("cold_consistent") is not True
            or set(manifest["files"]) != {*DATA_VOLUMES, "state"} or target.exists()
            or project == manifest["project"]):
        raise SelfHostError("恢复必须使用新实例目录和不同项目")
    # 所有加密实物先认证，再创建数据库卷。
    with tempfile.TemporaryDirectory(prefix=".snapshot-verify-", dir=artifact.parent) as temporary:
        staging = Path(temporary)
        for name, expected in manifest["files"].items():
            destination = staging / name
            destination.mkdir()
            actual = helper(values, key, artifact, destination, "import", name)
            if actual != expected:
                raise SelfHostError("快照摘要不符")
        for name in DATA_VOLUMES:
            check = subprocess.run(["docker", "volume", "inspect", volume(project, name)], capture_output=True)
            if check.returncode == 0:
                raise SelfHostError("恢复数据卷已存在")
        restored_env = read_env(staging / "state/runtime.env")
        old_origin = restored_env["PUBLIC_ORIGIN"]
        if origin.rstrip("/") != old_origin:
            raise SelfHostError("快照恢复必须保留原HTTPS地址；作品引用和告警端点绑定原地址")
        from self_hosted import configure
        env = configure(target, origin, project=project, subnet=subnet, bind=bind)
        new = read_env(env)
        for name in ("COMPOSE_PROJECT_NAME", "SOURCE_DIR", "STATE_DIR", "PUBLIC_ORIGIN", "PUBLIC_HOST",
                     "HTTPS_PORT", "BIND_ADDRESS", "BACKEND_IP", "BACKEND_ALLOWED_IPS", "DOCKER_SUBNET", "DOCKER_IP_RANGE"):
            restored_env[name] = new[name]
        temporary_env = target / "runtime.env.restore"
        write_private(temporary_env, "".join(f"{k}={v}\n" for k, v in restored_env.items()))
        os.replace(temporary_env, env)
        for name in ("frontend", "edge", "receipts"):
            shutil.copytree(staging / "state" / name, target / name, dirs_exist_ok=True)
        for name in DATA_VOLUMES:
            command(["docker", "volume", "create", volume(project, name)])
            actual = helper(values, key, artifact, volume(project, name), "import", name)
            if actual != manifest["files"][name]:
                raise SelfHostError("恢复卷摘要不符")
    # 保留规范地址；隔离演练可用其他bind/IP及独立网段，生产提供有效证书。
    tls(restored_env, dev=dev_tls, certificate=certificate, key=certificate_key)
    publish_runtime(restored_env)
    receipt(target, "snapshot-restore.json", {"restored": True, "encrypted": True, "volumes": 4, "isolated": True})
    return {"restored": True, "encrypted": True, "volumes": 4, "isolated": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("backup", "restore", "inner-export", "inner-import"))
    parser.add_argument("--state-dir")
    parser.add_argument("--key-file")
    parser.add_argument("--output")
    parser.add_argument("--artifact")
    parser.add_argument("--project")
    parser.add_argument("--origin")
    parser.add_argument("--subnet", default="172.31.245.0/24")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--name")
    parser.add_argument("--dev-tls", action="store_true")
    parser.add_argument("--tls-cert")
    parser.add_argument("--tls-key")
    args = parser.parse_args()
    try:
        if args.action.startswith("inner-"):
            inner(args.action.removeprefix("inner-"), args.name)
        else:
            state, key, output = (Path(value).resolve() for value in (args.state_dir, args.key_file, args.output))
            result = (backup(state, key, output) if args.action == "backup" else
                      restore(state, key, Path(args.artifact).resolve(), output, args.project, args.origin, args.subnet,
                              args.dev_tls, args.tls_cert, args.tls_key, args.bind))
            print(json.dumps(result))
    except Exception as error:
        print(json.dumps({"error": str(error) if isinstance(error, SelfHostError) else type(error).__name__}))
        raise SystemExit(1)
