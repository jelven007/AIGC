"""单机100人容量配置：保留原密钥与数据，只原子替换有界资源参数。"""
import argparse
import json
import os
from pathlib import Path

from self_hosted import ROOT, SelfHostError, command, read_env, write_private

PROFILE = ROOT / "infra/self-hosted/capacity-100.json"


def apply_profile(env, backup, image, mcp_image=None):
    values = read_env(env)
    profile = json.loads(PROFILE.read_text())
    host = json.loads(command(["docker", "info", "--format", "{{json .}}"]))
    if host["NCPU"] < 64 or host["MemTotal"] < 128 * 1024**3:
        raise SelfHostError("100人配置要求至少64逻辑CPU、128GiB内存；小规格需重新压测")
    info = json.loads(command(["docker", "image", "inspect", image]))[0]
    if not image.startswith("sha256:") or info["Id"] != image:
        raise SelfHostError("渲染镜像必须使用本地不可变sha256身份")
    values.update(profile)
    values["RENDERER_IMAGE"] = image
    if mcp_image:
        info = json.loads(command(["docker", "image", "inspect", mcp_image]))[0]
        if not mcp_image.startswith("sha256:") or info["Id"] != mcp_image:
            raise SelfHostError("MCP镜像必须使用本地不可变sha256身份")
        values["MCP_IMAGE"] = mcp_image
    write_private(backup, Path(env).read_text())
    temporary = Path(env).with_suffix(".capacity")
    write_private(temporary, "".join(f"{k}={v}\n" for k, v in values.items()))
    os.replace(temporary, env)
    return {"configured": True, "profile": "capacity-100", "replicas": 16,
            "renderer_image": image, "budget_cpus": 51, "backup": str(backup)}


def rollback(env, backup):
    prior = read_env(backup)
    current = read_env(env)
    if any(prior.get(k) != current.get(k) for k in ("COMPOSE_PROJECT_NAME", "STATE_DIR", "PUBLIC_ORIGIN", "JWT_SECRET")):
        raise SelfHostError("回滚配置不是当前实例的原配置")
    temporary = Path(env).with_suffix(".capacity-rollback")
    write_private(temporary, Path(backup).read_text())
    os.replace(temporary, env)
    return {"configuration_restored": True, "replicas": int(prior.get("RENDERER_REPLICAS", "1"))}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("apply", "rollback"))
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--backup-file", required=True)
    parser.add_argument("--renderer-image")
    parser.add_argument("--mcp-image")
    args = parser.parse_args()
    env, backup = Path(args.state_dir) / "runtime.env", Path(args.backup_file)
    result = (apply_profile(env, backup, args.renderer_image, args.mcp_image)
              if args.action == "apply" else rollback(env, backup))
    print(json.dumps(result))
