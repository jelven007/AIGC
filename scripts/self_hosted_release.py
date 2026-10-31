"""导出已实测镜像、前端及Edge离线交付，安装时核对全部摘要和CPU架构。"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

from self_hosted import ROOT, SelfHostError, read_env, command


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def verify(directory):
    directory = Path(directory).resolve()
    value = json.loads((directory / "release-manifest.json").read_text())
    if value.get("format") != 1 or not value.get("images") or not value.get("files"):
        raise SelfHostError("交付清单格式错误")
    for name, expected in value["files"].items():
        path = directory / name
        if (Path(name).is_absolute() or ".." in Path(name).parts or path.is_symlink()
                or not path.resolve().is_relative_to(directory) or not path.is_file() or digest(path) != expected):
            raise SelfHostError("交付文件摘要不符：" + name)
    verify_inventory(directory, value["files"], "release-manifest.json")
    return value


def verify_inventory(directory, files, manifest):
    for path in directory.rglob("*"):
        relative = path.relative_to(directory)
        if "__pycache__" in relative.parts:
            continue
        if path.is_symlink():
            raise SelfHostError("交付包含链接：" + str(relative))
        if path.is_file() and str(relative) not in {*files, manifest}:
            raise SelfHostError("交付包含未登记文件：" + str(relative))


def verify_source(directory):
    directory = Path(directory).resolve()
    value = json.loads((directory / "source-manifest.json").read_text())
    if value.get("format") != 1 or not value.get("release") or not value.get("files"):
        raise SelfHostError("源码交付清单格式错误")
    for name, expected in value["files"].items():
        path = directory / name
        if (Path(name).is_absolute() or ".." in Path(name).parts or path.is_symlink()
                or not path.resolve().is_relative_to(directory) or not path.is_file() or digest(path) != expected):
            raise SelfHostError("源码交付摘要不符：" + name)
    verify_inventory(directory, value["files"], "source-manifest.json")
    return value


def prepare(state, output):
    if output.exists():
        raise SelfHostError("交付目录已存在")
    output.mkdir(mode=0o700)
    # 明确白名单；不导出实例配置、密钥、数据库或测试素材。
    for name in ("scripts", "deploy", "supabase", "worker", "mcp", "src", "public", "tests", "docs", ".rules", ".github"):
        def ignore(directory, names):
            return [name for name in names if name in ("__pycache__", "node_modules", ".temp", "secrets")
                    or name.endswith((".pyc", ".local", ".key", ".env"))
                    or name in ("runtime.env", "config.json", "acceptance.json", "video_worker_secret",
                                "render_worker_secret", "relay_secret", "alert-delivery.json")]
        shutil.copytree(ROOT / name, output / name, ignore=ignore)
    for pattern in ("*.json", "*.mjs", "*.ts", "*.yml", "*.md", "*.html", "pnpm-lock.yaml", ".npmrc",
                    ".node-version", ".dockerignore", ".gitattributes", ".gitignore", ".env.example", "LICENSE"):
        for source in ROOT.glob(pattern):
            if source.is_file():
                shutil.copyfile(source, output / source.name)
    payload = output / "payload"
    payload.mkdir()
    shutil.copytree(state / "frontend", payload / "frontend")
    (payload / "frontend/runtime-config.js").unlink(missing_ok=True)
    shutil.copytree(state / "edge", payload / "edge")
    # 白名单交付只含源码和公开构建产物；容器的非root身份需要读取挂载根目录。
    output.chmod(0o755)
    return output


def create(state, output):
    values = read_env(state / "runtime.env")
    prepare(state, output)
    payload = output / "payload"
    images = []
    for key in sorted(name for name in values if name.endswith("_IMAGE")):
        info = json.loads(command(["docker", "image", "inspect", values[key]]))[0]
        sources = {}
        folder = {"RENDERER_IMAGE": "worker", "MCP_IMAGE": "mcp"}.get(key)
        if folder:
            sources = {path.name: digest(path) for path in (ROOT / folder).glob("*.py")}
        elif key == "SCHEDULER_IMAGE":
            sources = {name: digest(ROOT / "scripts" / name) for name in
                ("run_video_worker.py", "first_party_http.py", "alert_delivery.py", "runtime-contract.json")}
            sources["backend_tls.py"] = digest(ROOT / "mcp/backend_tls.py")
        if sources:
            actual = json.loads(command(["docker", "run", "--rm", "--network", "none", "--entrypoint", "python",
                info["Id"], "-c", "import hashlib,json,sys; from pathlib import Path; "
                "print(json.dumps({n:hashlib.sha256((Path('/app')/n).read_bytes()).hexdigest() "
                "for n in json.loads(sys.argv[1])}))", json.dumps(list(sources))]))
            if actual != sources:
                raise SelfHostError("执行镜像源码与交付不符：" + key)
        tag = "shopro-offline/" + key.removesuffix("_IMAGE").lower() + ":" + info["Id"].split(":")[1][:16]
        command(["docker", "tag", info["Id"], tag])
        images.append({"env": key, "image": tag, "id": info["Id"],
                       "platform": info["Os"] + "/" + info["Architecture"], "source_sha256": sources})
    platforms = {item["platform"] for item in images}
    if len(platforms) != 1:
        raise SelfHostError("交付镜像CPU架构不一致")
    command(["docker", "save", "-o", str(payload / "images.tar"), *[item["image"] for item in images]], timeout=600)
    files = {str(path.relative_to(output)): digest(path) for path in sorted(output.rglob("*")) if path.is_file()}
    value = {"format": 1, "platform": platforms.pop(), "images": images, "files": files,
             "default_admin": {"username": "admin", "password": "<REDACTED_CREDENTIAL>"},
             "migrations": 66, "edge_functions": 43, "mcp_tools": 59}
    from deploy_volcengine import release_manifest
    value["release"] = release_manifest()
    (output / "release-manifest.json").write_text(json.dumps(value, ensure_ascii=False, indent=2))
    verify(output)
    archive = output.with_suffix(".tar.gz")
    if archive.exists():
        raise SelfHostError("交付归档已存在")
    with tarfile.open(archive, "w:gz", compresslevel=1) as stream:
        stream.add(output, arcname=output.name, recursive=True)
    (archive.with_suffix(archive.suffix + ".sha256")).write_text(digest(archive) + "  " + archive.name + "\n")
    return {"release": str(output), "archive": str(archive), "platform": value["platform"],
            "images": len(images), "files_verified": len(files), "archive_sha256": digest(archive)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("create", "source", "verify"))
    parser.add_argument("--state-dir")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        if args.action == "source":
            output = prepare(Path(args.state_dir).resolve(), Path(args.output).resolve())
            files = {str(path.relative_to(output)): digest(path) for path in output.rglob("*") if path.is_file()}
            from deploy_volcengine import release_manifest
            (output / "source-manifest.json").write_text(json.dumps(
                {"format": 1, "release": release_manifest(), "files": files}, indent=2))
            verify_source(output)
            archive = output.with_suffix(".tar.gz")
            with tarfile.open(archive, "w:gz", compresslevel=1) as stream:
                stream.add(output, arcname=output.name)
            result = {"source_archive": str(archive), "sha256": digest(archive), "files": len(files)}
        else:
            result = (create(Path(args.state_dir).resolve(), Path(args.output).resolve()) if args.action == "create"
                      else {"verified": True, "platform": verify(Path(args.output))["platform"]})
        print(json.dumps(result, ensure_ascii=False))
    except (SelfHostError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(json.dumps({"error": str(error) if isinstance(error, SelfHostError) else type(error).__name__}))
        raise SystemExit(1)
