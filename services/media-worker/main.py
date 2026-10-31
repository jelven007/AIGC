"""ECS FFmpeg Worker，仅持专用租约密钥，不持数据库 service_role。"""
import json
import os
from pathlib import Path
import signal
import socket
import sys
import tempfile
import threading
import time
import urllib.parse
import ipaddress
import requests
from render import render, RenderError
from analyze import prepare_video
from edit_analysis import prepare_edit
from task_workspace import (TaskWorkspace, RetryableError, download as download_media, MIB,
                            exclusive_workspace, exclusive_replica_workspace)
from health import WorkerHealth
from egress import EgressClient


def safe_url(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise RenderError("素材地址必须为公网HTTPS")
    for entry in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM):
        if not ipaddress.ip_address(entry[4][0]).is_global:
            raise RenderError("素材地址不能指向内网")
    return value


def download(url, target, max_bytes=500 * MIB, cancelled=lambda: False):
    return download_media(url, target, max_bytes, cancelled, validate_url=safe_url)


class UploadStream:
    def __init__(self, file, cancelled):
        self.file, self.cancelled, self.started = file, cancelled, time.monotonic()

    def __getattr__(self, name):
        return getattr(self.file, name)

    def read(self, size=-1):
        if self.cancelled() or time.monotonic() - self.started > 180:
            raise RetryableError("上传已停止、租约失效或超过执行时限")
        return self.file.read(size)


def process_job(reply, api, stop, workspace_root=None, health=None, http=None):
    http = http or requests
    validate_media = getattr(http, "validate_media", safe_url)
    validate_upload = getattr(http, "validate_upload", safe_url)
    job = reply["job"]
    lease = {"job_id": job["id"], "lease_token": job["lease_token"]}
    heart_stop, heartbeat_failure = threading.Event(), threading.Event()
    progress = [5]
    cancelled = lambda: stop.is_set() or heartbeat_failure.is_set()

    def heartbeat():
        while not heart_stop.wait(20):
            try:
                api({"action": "heartbeat", **lease, "data": {"progress": progress[0]}})
                if health:
                    health.write("active", job)
            except Exception:
                heartbeat_failure.set()
                return

    heart_thread = threading.Thread(target=heartbeat, daemon=True)
    if health:
        health.write("active", job)
    heart_thread.start()
    uploading = False
    try:
        with tempfile.TemporaryDirectory(prefix="shopro-render-", dir=workspace_root) as workspace:
            directory = Path(workspace)
            preparing, editing = job.get("kind") == "analysis", job.get("kind") == "edit_analysis"
            reserve = 32 * MIB if preparing or editing else 1056 * MIB
            masks = 768 * MIB if any(track.get("personMask") for track in job["payload"].get("tracks", [])) else 0
            budget = TaskWorkspace(directory, validate_media, cancelled, output_reserve=reserve, mask_reserve=masks,
                                   request_get=http.get)
            budget.check(reserve=True)
            files = {}
            if preparing:
                source = budget.fetch(job["payload"]["source_url"], 100 * MIB)
                result = prepare_video(source, directory, cancelled=cancelled, budget=budget)
                files = {f"frame-{index}.jpg": frame["file"] for index, frame in enumerate(result["frames"])}
                if result["audio"]:
                    files["audio.wav"] = result["audio"]
            elif editing:
                source = budget.fetch(job["payload"]["source"]["url"])
                result = prepare_edit(source, job["payload"], directory, cancelled=cancelled, budget=budget)
                files["audio.wav"] = result["audio"]
            else:
                for track in job["payload"]["tracks"]:
                    if track["type"] != "text":
                        files[track["id"]] = budget.fetch(track["url"])
                result = render(job["payload"], files, directory, lambda value: progress.__setitem__(0, value),
                                cancelled=cancelled, budget=budget)
            budget.check()
            for output in reply["outputs"]:
                file = files.get(output["name"]) if preparing or editing else result[
                    "file" if output["name"] == "output.mp4" else "thumbnail"]
                if not file:
                    continue
                budget.check()
                validate_upload(output["url"])
                # 发出上传后，网络/租约/结案失败均保留原任务核对，不能记为明确失败。
                uploading = True
                with file.open("rb") as media:
                    response = http.put(output["url"], data=UploadStream(media, cancelled), headers={"Content-Type": output["type"]},
                                            timeout=(10, 15), allow_redirects=False)
                if response.status_code not in (200, 201):
                    raise RetryableError("成片上传结果待核对")
            fields = ("duration", "source_hash", "has_audio") if preparing else (
                ("duration", "source_hash", "beats", "bpm", "confidence", "algorithm") if editing and job["payload"]["mode"] == "beats"
                else ("duration", "source_hash") if editing else ("size", "duration", "resolution"))
            details = {key: result[key] for key in fields}
            if preparing:
                details["frame_times"] = [frame["time"] for frame in result["frames"]]
            event = "prepared" if preparing or editing and job["payload"]["mode"] == "subtitles" else "completed"
            # 包括无上传的节拍结案；任何结案响应丢失都只能继续核对原租约。
            uploading = True
            for attempt in range(3):
                if cancelled():
                    raise RetryableError("任务已停止或租约失效，结果待核对")
                try:
                    api({"action": event, **lease, "data": details})
                    break
                except Exception as cause:
                    if attempt == 2 or stop.wait(2):
                        raise RetryableError("原任务结案结果待核对") from cause
            print(json.dumps({"job_id": job["id"], "status": event, "downloads": budget.downloads,
                              "input_bytes": budget.input_bytes, "workspace_peak_bytes": budget.peak_bytes}), flush=True)
    except Exception as cause:
        if uploading or cancelled():
            raise RetryableError("任务已停止、租约失效或上传结案待核对") from cause
        raise
    finally:
        heart_stop.set()
        heart_thread.join(timeout=35)


def report_job_error(api, job, cause):
    api({"action": "failed" if isinstance(cause, RenderError) and not isinstance(cause, RetryableError) else "retry",
         "job_id": job["id"], "lease_token": job["lease_token"],
         "data": {"error": str(cause) if isinstance(cause, RenderError) else "媒体执行条件异常，请恢复原任务"}})


def main():
    health = WorkerHealth(os.environ.get("RENDER_HEALTH_FILE", "/tmp/worker-health.json"))
    if "--healthcheck" in sys.argv:
        return 0 if health.healthy() else 1
    health.write("starting")
    base = os.environ["SUPABASE_URL"].rstrip("/")
    endpoint = base + "/functions/v1/production-worker"
    http = EgressClient(base, os.environ.get("RENDER_MEDIA_HOSTS", ""))
    http.validate_upload(endpoint)
    secret = Path(os.environ["RENDER_WORKER_SECRET_FILE"]).read_text().strip()
    if len(secret) < 32:
        raise ValueError("Worker密钥长度不足")
    stop = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: stop.set())

    def api(body):
        response = http.post(endpoint, json=body, headers={"Authorization": f"Bearer {secret}"},
                                 timeout=(10, 30), allow_redirects=False)
        if response.status_code != 200:
            raise RetryableError("Worker租约接口暂时不可用")
        return response.json()

    try:
        with exclusive_replica_workspace(os.environ.get("RENDER_WORKSPACE_DIR")) as workspace_root:
            run_loop(api, stop, health, workspace_root, http)
    finally:
        if hasattr(http, "close"):
            http.close()
    health.write("stopped")
    return 0


def run_loop(api, stop, health, workspace_root, http=None):
    turn = 0
    while not stop.is_set():
        job = None
        try:
            # 三种本地任务轮转，音轨预处理不依赖编辑器页面存活。
            kinds = (None, "analysis_prepare", "edit_prepare")
            for offset in range(len(kinds)):
                if stop.is_set():
                    return
                kind = kinds[(turn + offset) % len(kinds)]
                reply = api({"action": "claim", "render_version": 4, "edit_version": 2,
                             **({"kind": kind} if kind else {})})
                job = reply.get("job")
                if job:
                    break
            turn = (turn + 1) % len(kinds)
            if not job:
                health.write("idle")
                stop.wait(10)
                continue
            process_job(reply, api, stop, workspace_root, health, http)
        except Exception as cause:
            health.write("error")
            print(json.dumps({"status": "error", "type": type(cause).__name__}), flush=True)
            if job:
                try:
                    report_job_error(api, job, cause)
                except Exception:
                    pass
            stop.wait(10)


if __name__ == "__main__":
    sys.exit(main())
