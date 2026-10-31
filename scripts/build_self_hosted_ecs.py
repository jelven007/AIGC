"""使用相同不可变摘要镜像在ECS本机架构构建执行器，不依赖ARM交付。"""
import argparse
import json
import subprocess

from self_hosted import ROOT, command

MIRROR = "m.daocloud.io/docker.io/"
PYTHON = MIRROR + "python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1"
ALPINE = MIRROR + "python:3.12-alpine@sha256:1b668429b3511ab407d8e00648891631b0b1a4d7e15e3ca70f38ab5b91ad4ab4"
POSTGRES = MIRROR + "postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d"

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--component", choices=("backup", "scheduler", "renderer", "mcp"), required=True)
parser.add_argument("--image", help="独立候选镜像标签，默认保留原本地构建标签")
args = parser.parse_args()
dockerfile, context, image, python_image = {
    "backup": ("infra/backup/Dockerfile", ROOT, "shoproai-backup:local", PYTHON),
    "scheduler": ("infra/video-scheduler/Dockerfile", ROOT, "shoproai-video-scheduler:local", ALPINE),
    "renderer": ("services/media-worker/Dockerfile", ROOT, "shoproai-render-worker:local", PYTHON),
    "mcp": ("services/mcp/Dockerfile.mcp", ROOT / "services/mcp", "shoproai-mcp:local", PYTHON),
}[args.component]
image = args.image or image
result = subprocess.run(["docker", "build", "--build-arg", "PYTHON_IMAGE=" + python_image,
    "--build-arg", "APT_MIRROR=https://mirrors.aliyun.com",
    "--build-arg", "PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple",
    *(["--build-arg", "POSTGRES_IMAGE=" + POSTGRES] if args.component == "backup" else []),
    "-f", str(ROOT / dockerfile), "-t", image, str(context)])
if result.returncode:
    raise SystemExit(result.returncode)
info = json.loads(command(["docker", "image", "inspect", image]))[0]
print(json.dumps({"component": args.component, "image": image, "id": info["Id"],
                  "platform": info["Os"] + "/" + info["Architecture"]}))
