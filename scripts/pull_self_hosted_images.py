"""按不可变摘要下载基础组件；Docker在当前宿主机选择原生CPU架构。"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--manifest", default=str(Path(__file__).resolve().parents[1] / "infra/self-hosted/images.json"))
args = parser.parse_args()
images = json.loads(Path(args.manifest).read_text())


def pull(item):
    name, value = item
    result = subprocess.run(["docker", "pull", value["image"]], capture_output=True, text=True)
    print(json.dumps({"component": name, "pulled": result.returncode == 0}), flush=True)
    if result.returncode:
        print(result.stderr[-2000:], flush=True)
    return result.returncode == 0


with ThreadPoolExecutor(max_workers=3) as executor:
    results = list(executor.map(pull, images.items()))
raise SystemExit(0 if all(results) else 1)
