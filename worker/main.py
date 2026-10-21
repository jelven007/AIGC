"""ECS FFmpeg Worker，仅持专用租约密钥，不持数据库 service_role。"""
import json
import os
from pathlib import Path
import signal
import socket
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import ipaddress
import requests
from render import render, RenderError


def safe_url(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise RenderError("素材地址必须为公网HTTPS")
    for entry in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM):
        if not ipaddress.ip_address(entry[4][0]).is_global:
            raise RenderError("素材地址不能指向内网")
    return value


def download(url, target):
    safe_url(url)
    with requests.get(url, stream=True, timeout=(10, 120), allow_redirects=False) as response:
        if response.status_code != 200:
            raise RenderError("素材下载失败")
        total = 0
        with target.open("wb") as output:
            for chunk in response.iter_content(1024 * 1024):
                total += len(chunk)
                if total > 500 * 1024 * 1024:
                    raise RenderError("单素材超过500MB")
                output.write(chunk)
    return total


def main():
    base = os.environ["SUPABASE_URL"].rstrip("/")
    endpoint = base + "/functions/v1/production-worker"
    safe_url(endpoint)
    secret = Path(os.environ["RENDER_WORKER_SECRET_FILE"]).read_text().strip()
    if len(secret) < 32:
        raise ValueError("Worker密钥长度不足")
    stop = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: stop.set())

    def api(body):
        response = requests.post(endpoint, json=body, headers={"Authorization": f"Bearer {secret}"},
                                 timeout=(10, 30), allow_redirects=False)
        if response.status_code != 200:
            raise RenderError("Worker租约接口失败")
        return response.json()

    while not stop.is_set():
        job = None
        try:
            reply = api({"action": "claim"})
            job = reply.get("job")
            if not job:
                stop.wait(10)
                continue
            lease = {"job_id": job["id"], "lease_token": job["lease_token"]}
            heart_stop = threading.Event()
            heartbeat_failure = threading.Event()
            progress = [5]

            def heartbeat():
                while not heart_stop.wait(30):
                    try:
                        api({"action": "heartbeat", **lease, "data": {"progress": progress[0]}})
                    except Exception:
                        heartbeat_failure.set()
                        return

            heart_thread = threading.Thread(target=heartbeat, daemon=True)
            heart_thread.start()
            try:
                with tempfile.TemporaryDirectory(prefix="shopro-render-") as workspace:
                    directory = Path(workspace)
                    files = {}
                    total_bytes = 0
                    for index, track in enumerate(job["payload"]["tracks"]):
                        if track["type"] == "text":
                            continue
                        path = directory / f"input-{index}"
                        total_bytes += download(track["url"], path)
                        if total_bytes > 2 * 1024 * 1024 * 1024:
                            raise RenderError("工程素材总量超过2GB")
                        files[track["id"]] = path
                    result = render(job["payload"], files, directory, lambda value: progress.__setitem__(0, value),
                                    cancelled=lambda: stop.is_set() or heartbeat_failure.is_set())
                    if heartbeat_failure.is_set():
                        raise RenderError("任务租约连接失效")
                    for output, name in zip(reply["outputs"], ("file", "thumbnail")):
                        safe_url(output["url"])
                        with result[name].open("rb") as media:
                            response = requests.put(output["url"], data=media, headers={"Content-Type": output["type"]},
                                                    timeout=(10, 120), allow_redirects=False)
                        if response.status_code not in (200, 201):
                            raise RenderError("成片上传失败")
                    # 网络丢失时重用同一租约结案，避免已上传成片被误标失败。
                    for attempt in range(3):
                        try:
                            api({"action": "completed", **lease, "data": {key: result[key] for key in ("size", "duration", "resolution")}})
                            break
                        except RenderError:
                            if attempt == 2:
                                raise
                            stop.wait(2)
                    print(json.dumps({"job_id": job["id"], "status": "completed"}), flush=True)
            finally:
                heart_stop.set()
                heart_thread.join(timeout=2)
        except Exception as cause:
            print(json.dumps({"status": "error", "type": type(cause).__name__}), flush=True)
            if job:
                try:
                    api({"action": "failed" if isinstance(cause, RenderError) and "租约接口" not in str(cause) else "retry",
                         "job_id": job["id"], "lease_token": job["lease_token"],
                         "data": {"error": str(cause) if isinstance(cause, RenderError) else "渲染执行失败"}})
                except Exception:
                    pass
            stop.wait(10)


if __name__ == "__main__":
    main()
