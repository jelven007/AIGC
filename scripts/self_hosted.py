"""单机自托管入口；配置和数据目录独立于云端发布工具。"""
import argparse
import base64
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ROOT / "infra/self-hosted/compose.yaml"


class SelfHostError(RuntimeError):
    pass


def jwt_key(secret, role):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode().rstrip("=")
    now = int(time.time())
    content = encode({"alg": "HS256", "typ": "JWT"}) + "." + encode(
        {"role": role, "iss": "supabase", "iat": now, "exp": now + 10 * 365 * 86400})
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), content.encode(), hashlib.sha256).digest())
    return content + "." + signature.decode().rstrip("=")


def read_env(path):
    path = Path(path)
    if not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o077:
        raise SelfHostError("配置需要普通0600文件")
    return dict(line.split("=", 1) for line in path.read_text().splitlines() if line and not line.startswith("#"))


def write_private(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(content)


def public_config(values):
    return {"deployment": "self-hosted", "backendUrl": values["PUBLIC_ORIGIN"],
            "backendAnonKey": values["ANON_KEY"], "usernameLogin": True}


def configure(directory, origin, *, project="shopro-selfhost", bind="127.0.0.1", subnet="172.31.247.0/24"):
    try:
        url = urlsplit(origin)
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or url.path not in ("", "/") or url.query or url.fragment or not 1 <= (url.port or 443) <= 65535
                or not re.fullmatch(r"[a-z0-9.-]+", url.hostname)):
            raise ValueError()
        if not re.fullmatch(r"[a-z][a-z0-9-]{2,40}", project):
            raise ValueError()
        network = ipaddress.ip_network(subnet)
        if network.version != 4 or not network.is_private or not 32 <= network.num_addresses <= 65536:
            raise ValueError()
    except ValueError:
        raise SelfHostError("需要无凭据HTTPS根地址及有效项目名") from None
    try:
        literal_backend_ip = str(ipaddress.ip_address(url.hostname))
    except ValueError:
        literal_backend_ip = None
    directory = directory.resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_mode & 0o077:
        raise SelfHostError("实例目录必须为0700私有目录")
    path = directory / "runtime.env"
    if path.exists():
        values = read_env(path)
        if values["PUBLIC_ORIGIN"] != origin.rstrip("/") or values["COMPOSE_PROJECT_NAME"] != project:
            raise SelfHostError("实例已有其他目标配置，请使用独立目录")
        upgrade = "BACKEND_ALLOWED_IPS" not in values or "DOCKER_IP_RANGE" not in values
        values.setdefault("BACKEND_ALLOWED_IPS", literal_backend_ip or values["BACKEND_IP"])
        values.setdefault("DOCKER_IP_RANGE", str(list(network.subnets())[1]))
        ring = json.loads(values["MODEL_KEYRING"])
        if "active" in ring and "active_key_id" not in ring:
            # 早期未运行实例的序列化升级，保留原始密钥字节。
            values["MODEL_KEYRING"] = json.dumps({"active_key_id": ring["active"], "legacy_key_id": None,
                "keys": {name: base64.b64decode(value, validate=True).hex() for name, value in ring["keys"].items()}},
                separators=(",", ":"))
            upgrade = True
        if upgrade:
            temporary = directory / "runtime.env.upgrade"
            write_private(temporary, "".join(f"{name}={value}\n" for name, value in values.items()))
            os.replace(temporary, path)
        return path
    for folder in ("tls", "frontend", "edge", "receipts", "media", "secrets"):
        (directory / folder).mkdir(mode=0o700)
    secret = secrets.token_hex(32)
    images = json.loads((ROOT / "infra/self-hosted/images.json").read_text())
    values = {
        "COMPOSE_PROJECT_NAME": project, "SOURCE_DIR": str(ROOT), "STATE_DIR": str(directory),
        "PUBLIC_ORIGIN": origin.rstrip("/"), "PUBLIC_HOST": url.hostname, "HTTPS_PORT": str(url.port or 443),
        "BIND_ADDRESS": bind, "BACKEND_IP": str(network.network_address + 10), "DOCKER_SUBNET": str(network),
        "DOCKER_IP_RANGE": str(list(network.subnets())[1]),
        "BACKEND_ALLOWED_IPS": literal_backend_ip or str(network.network_address + 10),
        "POSTGRES_PASSWORD": secrets.token_hex(24), "JWT_SECRET": secret,
        "ANON_KEY": jwt_key(secret, "anon"), "SERVICE_ROLE_KEY": jwt_key(secret, "service_role"),
        "VIDEO_WORKER_SECRET": secrets.token_hex(32), "SECRET_KEY_BASE": secrets.token_hex(64),
        "RENDER_WORKER_SECRET": secrets.token_hex(32),
        "REALTIME_DB_ENC_KEY": secrets.token_hex(8),
        "MODEL_KEYRING": json.dumps({"active_key_id": "v1", "legacy_key_id": None, "keys": {"v1": secrets.token_hex(32)}},
                                   separators=(",", ":")),
        "DISABLE_SIGNUP": "true", "SMTP_HOST": "", "SMTP_PORT": "587", "SMTP_USER": "", "SMTP_PASS": "",
        "SMTP_ADMIN_EMAIL": "noreply@" + url.hostname,
        "SCHEDULER_IMAGE": "shoproai-video-scheduler:local", "RENDERER_IMAGE": "shoproai-render-worker:local",
        "MCP_IMAGE": "shoproai-mcp:local", "BACKUP_IMAGE": "shoproai-backup:local",
        **{name.upper() + "_IMAGE": value["image"] for name, value in images.items()},
    }
    write_private(path, "".join(f"{name}={value}\n" for name, value in values.items()))
    return path


def command(args, *, timeout=180, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout, **kwargs)
    if result.returncode:
        # Docker配置/容器日志可能有凭据；失败正文由管理员在本地受控检查。
        raise SelfHostError(f"{args[0]}执行失败（退出码{result.returncode}）")
    return result.stdout


def compose(env, args, *, timeout=180):
    return command(["docker", "compose", "--env-file", str(env), "-f", str(COMPOSE), *args], timeout=timeout)


def tls(values, dev=False, certificate=None, key=None):
    directory = Path(values["STATE_DIR"]) / "tls"
    if (directory / "server.crt").exists() and (directory / "server.key").exists():
        if not dev or (directory / "server.crt").read_bytes() != (directory / "ca.crt").read_bytes():
            (directory / "ca.crt").chmod(0o644)
            return
        for name in ("server.crt", "server.key", "ca.crt"):
            os.replace(directory / name, directory / (name + ".legacy"))
    if certificate and key:
        write_private(directory / "server.crt", Path(certificate).read_text())
        write_private(directory / "server.key", Path(key).read_text())
        write_private(directory / "ca.crt", Path(certificate).read_text())
    elif dev:
        # CA与终端证书分离；rustls会拒绝将CA证书作为TLS终端证书。
        try:
            ipaddress.ip_address(values["PUBLIC_HOST"])
            alternative_name = "IP:" + values["PUBLIC_HOST"]
        except ValueError:
            alternative_name = "DNS:" + values["PUBLIC_HOST"]
        write_private(directory / "server.ext", "basicConstraints=critical,CA:FALSE\n"
                      "keyUsage=critical,digitalSignature,keyEncipherment\n"
                      "extendedKeyUsage=serverAuth\nsubjectAltName=" + alternative_name + "\n")
        command(["docker", "run", "--rm", "--network", "none", "--user", "0",
                 "-v", f"{directory}:/tls", "-e", "TLS_HOST=" + values["PUBLIC_HOST"],
                 "--entrypoint", "bash", values["BACKUP_IMAGE"], "-c",
                 'umask 077 && openssl req -x509 -newkey rsa:2048 -nodes -days 30 '
                 '-subj "/CN=Shopro isolated development CA" -addext "basicConstraints=critical,CA:TRUE" '
                 '-addext "keyUsage=critical,keyCertSign,cRLSign" '
                 '-keyout /tls/ca.key -out /tls/ca.crt && '
                 'openssl req -newkey rsa:2048 -nodes -subj "/CN=$TLS_HOST" '
                 '-keyout /tls/server.key -out /tls/server.csr && '
                 'openssl x509 -req -days 30 -in /tls/server.csr -CA /tls/ca.crt '
                 '-CAkey /tls/ca.key -CAcreateserial -extfile /tls/server.ext -out /tls/server.crt'])
    else:
        raise SelfHostError("请传入域名TLS证书和私钥；隔离本地测试可使用--dev-tls")
    (directory / "ca.crt").chmod(0o644)


def publish_runtime(values):
    directory = Path(values["STATE_DIR"]) / "frontend"
    script = "window.__SHOPRO_RUNTIME__ = " + json.dumps(public_config(values), ensure_ascii=False) + ";\n"
    (directory / "runtime-config.js").write_text(script)
    (directory / "runtime-config.js").chmod(0o644)
    directory.chmod(0o755)

def receipt(directory, name, value):
    path = directory / "receipts" / name
    temporary = path.with_suffix(".new")
    write_private(temporary, json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    os.replace(temporary, path)


def upgrade_environment(env, source, images):
    """Switch code/images while preserving the instance and every capacity setting."""
    values = read_env(env)
    directory = Path(values["STATE_DIR"]) / "receipts"
    directory.mkdir(mode=0o700, exist_ok=True)
    backup = directory / ("runtime-before-upgrade-" + str(time.time_ns()) + ".env")
    write_private(backup, Path(env).read_text())
    latest = directory / "upgrade-runtime.env.new"
    write_private(latest, Path(env).read_text())
    os.replace(latest, directory / "upgrade-runtime.env")
    values["SOURCE_DIR"] = str(source.resolve())
    for image in images:
        if not re.fullmatch(r"[A-Z]+_IMAGE", image["env"]) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image["id"]):
            raise SelfHostError("升级镜像身份无效")
        values[image["env"]] = image["id"]
    temporary = Path(env).with_suffix(".upgrade")
    write_private(temporary, "".join(f"{name}={value}\n" for name, value in values.items()))
    os.replace(temporary, env)
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["configure", "init", "build", "up", "install", "upgrade", "status", "stop", "check"])
    parser.add_argument("--state-dir", default=str(ROOT.parent / ".local/shopro-production/state"))
    parser.add_argument("--origin")
    parser.add_argument("--project", default="shopro-selfhost")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--subnet", default="172.31.247.0/24")
    parser.add_argument("--dev-tls", action="store_true")
    parser.add_argument("--tls-cert")
    parser.add_argument("--tls-key")
    parser.add_argument("--initial-admin", action="store_true", help="明确验证初始管理员登录")
    parser.add_argument("--initial-admin-file", help="源码外普通0600私有初始化文件")
    parser.add_argument("--sync-initial-email", action="store_true", help="显式同步原初始化账号邮箱，不重置密码或权益")
    parser.add_argument("--release", help="离线交付目录；install无需Node或npm联网")
    args = parser.parse_args()
    directory = Path(args.state_dir).resolve()
    if args.action == "configure" or not (directory / "runtime.env").exists():
        if not args.origin:
            raise SelfHostError("新实例需要--origin")
        env = configure(directory, args.origin, project=args.project, bind=args.bind, subnet=args.subnet)
    else:
        env = directory / "runtime.env"
    values = read_env(env)
    if args.initial_admin_file:
        from initial_admin import read_initial_admin, set_bootstrap_owner
        original = Path(args.initial_admin_file).absolute()
        if original.resolve().is_relative_to(ROOT):
            raise SelfHostError("初始化凭据必须保存在源码目录之外")
        identity = read_initial_admin(original)
        target = directory / "initial-admin.json"
        temporary = target.with_suffix(".new")
        write_private(temporary, json.dumps(identity))
        os.replace(temporary, target)
        set_bootstrap_owner(target)
        login_target = directory / "login-identity.json"
        temporary = login_target.with_suffix(".new")
        write_private(temporary, json.dumps({name: identity[name] for name in ("username", "email")}))
        os.replace(temporary, login_target)
    if args.action in ("init", "up", "install", "upgrade") and not (directory / "initial-admin.json").is_file():
        raise SelfHostError("请先提供源码外的私有初始化文件")
    if args.action == "upgrade":
        from self_hosted_release import verify_source, verify
        if not args.release or Path(args.release).resolve() != ROOT:
            raise SelfHostError("升级必须在冻结发布目录执行并传入--release该目录")
        release = verify(ROOT) if (ROOT / "release-manifest.json").exists() else verify_source(ROOT)
        if (ROOT / "release-manifest.json").exists():
            command(["docker", "load", "-i", str(ROOT / "payload/images.tar")], timeout=600)
        images = json.loads((ROOT / "runtime-images.json").read_text()) if (ROOT / "runtime-images.json").exists() else release.get("images", [])
        architecture = command(["docker", "info", "--format", "{{.OSType}}/{{.Architecture}}"]).strip()
        architecture = architecture.replace("/aarch64", "/arm64").replace("/x86_64", "/amd64")
        for image in images:
            actual = json.loads(command(["docker", "image", "inspect", image["id"]]))[0]
            if actual["Os"] + "/" + actual["Architecture"] != architecture:
                raise SelfHostError("升级镜像CPU架构不符")
        # Stage copies before stopping; malformed or missing payloads cannot take down the instance.
        prepared = directory / ("payload-upgrade-" + str(time.time_ns()))
        prepared.mkdir(mode=0o700)
        for name in ("frontend", "edge"):
            shutil.copytree(ROOT / "payload" / name, prepared / name)
        compose(env, ["--profile", "execution", "stop"], timeout=300)
        rollback = directory / "receipts" / ("payload-before-upgrade-" + str(time.time_ns()))
        rollback.mkdir(mode=0o700)
        for name in ("frontend", "edge"):
            os.replace(directory / name, rollback / name)
            os.replace(prepared / name, directory / name)
            for path in (directory / name).rglob("*"):
                path.chmod(0o755 if path.is_dir() else 0o644)
            (directory / name).chmod(0o755)
        values = upgrade_environment(env, ROOT, images)
        publish_runtime(values)
        compose(env, ["up", "-d", "--wait", "db", "auth", "rest", "storage"], timeout=300)
        result = json.loads(compose(env, ["--profile", "setup", "run", "--rm",
            *(["-e", "SELF_HOSTED_SYNC_INITIAL_EMAIL=true"] if args.sync_initial_email else []),
            "bootstrap"], timeout=300))
        receipt(directory, "bootstrap.json", result)
        receipt(directory, "upgrade.json", {"version": release.get("release", release).get("version"),
                "source_sha256": release.get("release", release).get("source_sha256"),
                "rollback_payload": str(rollback), "images": images})
        args.action = "up"
        prepared.rmdir()
    if "DOCKER_IP_RANGE" not in values:
        env = configure(directory, values["PUBLIC_ORIGIN"], project=values["COMPOSE_PROJECT_NAME"],
                        bind=values["BIND_ADDRESS"], subnet=values["DOCKER_SUBNET"])
        values = read_env(env)
    if args.action == "install":
        from self_hosted_release import verify
        if not args.release or Path(args.release).resolve() != ROOT:
            raise SelfHostError("请在已解压交付目录运行本脚本并传入--release该目录")
        release = verify(ROOT)
        architecture = command(["docker", "info", "--format", "{{.OSType}}/{{.Architecture}}"]).strip()
        architecture = architecture.replace("/aarch64", "/arm64").replace("/x86_64", "/amd64")
        if architecture != release["platform"]:
            raise SelfHostError("ECS架构" + architecture + "与交付镜像" + release["platform"] + "不符")
        command(["docker", "load", "-i", str(ROOT / "payload/images.tar")], timeout=600)
        for image in release["images"]:
            actual = json.loads(command(["docker", "image", "inspect", image["image"]]))[0]
            if actual["Id"] != image["id"]:
                raise SelfHostError("加载镜像摘要不符")
            values[image["env"]] = image["id"]
        values["SOURCE_DIR"] = str(ROOT)
        temporary = env.with_suffix(".install")
        write_private(temporary, "".join(f"{name}={value}\n" for name, value in values.items()))
        os.replace(temporary, env)
        for name in ("frontend", "edge"):
            shutil.copytree(ROOT / "payload" / name, directory / name, dirs_exist_ok=True)
            for path in (directory / name).rglob("*"):
                path.chmod(0o755 if path.is_dir() else 0o644)
            (directory / name).chmod(0o755)
        tls(values, args.dev_tls, args.tls_cert, args.tls_key)
        compose(env, ["up", "-d", "--wait", "db", "auth", "rest", "storage"], timeout=300)
        result = json.loads(compose(env, ["--profile", "setup", "run", "--rm", "bootstrap"], timeout=300))
        receipt(directory, "bootstrap.json", result)
        publish_runtime(values)
        args.action = "up"
    if "RENDER_WORKER_SECRET" not in values:
        values["RENDER_WORKER_SECRET"] = secrets.token_hex(32)
        temporary = env.with_suffix(".upgrade")
        write_private(temporary, "".join(f"{name}={value}\n" for name, value in values.items()))
        os.replace(temporary, env)
    if args.action == "configure":
        print(json.dumps({"configured": True, "origin": values["PUBLIC_ORIGIN"]}))
        return
    if args.action in ("status", "stop"):
        print(compose(env, ["ps"] if args.action == "status" else ["stop"]))
        return
    if args.action == "init":
        tls(values, args.dev_tls, args.tls_cert, args.tls_key)
        compose(env, ["up", "-d", "--wait", "db", "auth", "rest"], timeout=300)
        compose(env, ["up", "-d", "--wait", "storage"], timeout=300)
        result = json.loads(compose(env, ["--profile", "setup", "run", "--rm", "bootstrap"], timeout=300))
        receipt(directory, "bootstrap.json", result)
        print(json.dumps(result))
        publish_runtime(values)
        return
    if args.action == "build":
        command(["docker", "run", "--rm", "--network", "none",
                 "-e", "VITE_SUPABASE_URL=" + values["PUBLIC_ORIGIN"], "-e", "VITE_SUPABASE_ANON_KEY=" + values["ANON_KEY"],
                 "-v", f"{ROOT}:/app", "-v", "shoproai-development-dependencies:/app/node_modules",
                 "-v", f"{directory / 'frontend'}:/output", "-w", "/app", "node:22-bookworm-slim",
                 "node", "scripts/build_frontend.mjs", "--outDir", "/output"], timeout=300)
        publish_runtime(values)
        from deploy_volcengine import release_manifest, write_frontend_identity
        write_frontend_identity(directory / "frontend", release_manifest())
        edge = directory / "edge"
        edge.mkdir(exist_ok=True, mode=0o755)
        command(["docker", "run", "--rm", "--network", "none",
                 "-v", f"{ROOT}:/app", "-v", "shoproai-development-dependencies:/app/node_modules",
                 "-v", f"{edge}:/edge", "-w", "/app", "node:22-bookworm-slim",
                 "node", "scripts/build_self_hosted_edge.mjs", "/edge"], timeout=300)
        for path in edge.rglob("*"):
            path.chmod(0o755 if path.is_dir() else 0o644)
        edge.chmod(0o755)
        receipt(directory, "edge-build.json", json.loads((edge / "manifest.json").read_text()))
        return
    if args.action == "up":
        compose(env, ["--profile", "setup", "run", "--rm", "resource-init"])
        compose(env, ["up", "-d", "--wait", "proxy", "functions", "realtime"], timeout=300)
    initial = args.initial_admin or (args.action == "up" and not (directory / "receipts/initial-admin-check.json").exists())
    result = json.loads(compose(env, ["--profile", "setup", "run", "--rm",
        *(["-e", "SELF_HOSTED_INITIAL_CHECK=true"] if initial else []), "acceptance"], timeout=300))
    receipt(directory, "technical-checks.json", result)
    if initial:
        receipt(directory, "initial-admin-check.json", result)
    if args.action == "up":
        compose(env, ["--profile", "execution", "up", "-d", "--wait",
                     "scheduler", "maintenance", "renderer", "mcp"], timeout=300)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (SelfHostError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": str(error) if isinstance(error, SelfHostError) else type(error).__name__,
                          "accepted": False}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
