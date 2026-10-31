"""容器内固定真实FFmpeg负载；网络/租约为本地夹具，不调用外部业务。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import tempfile
import threading
import time


def measure(worker_directory, expect_legacy_progress_failure=False):
    sys.path.insert(0, str(worker_directory))
    import main as worker
    with tempfile.TemporaryDirectory(prefix="media-measurement-") as folder:
        root = Path(folder)
        workspace_root = root / "work"; workspace_root.mkdir()
        source = root / "fixture.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=2",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264",
                        "-threads", "1", "-c:a", "aac", "-shortest", str(source)],
                       check=True, capture_output=True, timeout=30)
        # 固定附加字节仍是ffprobe/FFmpeg可读取的MP4，突出重复下载与输入占盘。
        with source.open("ab") as file:
            file.write(b"0" * (2 * 1024 * 1024))
        (root / "secret").write_text("local-fixture-secret-" * 3)
        os.environ.update(SUPABASE_URL="https://fixture.example", RENDER_WORKER_SECRET_FILE=str(root / "secret"),
                          RENDER_WORKSPACE_DIR=str(workspace_root), RENDER_HEALTH_FILE=str(root / "health.json"))
        spec = {"version": 1, "title": "固定重复素材测量", "duration": 2, "height": 720, "fps": 24, "ratio": "16:9",
                "tracks": [{"id": str(index), "type": "video", "start": index * .25, "duration": .25,
                            "sourceStart": index * .25, "url": f"https://fixture.example/storage/v1/object/sign/materials/owner/video?token={index}"}
                           for index in range(8)]}
        result = {"downloads": 0, "download_bytes": 0, "workspace_peak_bytes": 0, "events": []}

        class Response:
            status_code = 200
            headers = {"Content-Length": str(source.stat().st_size)}
            def __init__(self, body=None):
                self.body = body
            def json(self):
                return self.body
            def __enter__(self):
                return self
            def __exit__(self, *_):
                pass
            def iter_content(self, size):
                with source.open("rb") as file:
                    for chunk in iter(lambda: file.read(size), b""):
                        result["download_bytes"] += len(chunk)
                        yield chunk

        def api(_url, json, **_kwargs):
            if json["action"] == "claim":
                return Response({"job": {"id": "original-job", "kind": "render", "lease_token": "original-lease", "payload": spec},
                                 "outputs": [{"name": name, "url": f"https://fixture.example/{name}", "type": kind}
                                             for name, kind in (("output.mp4", "video/mp4"), ("thumbnail.jpg", "image/jpeg"))]})
            result["events"].append(json)
            if json["action"] in ("completed", "failed", "retry"):
                os.kill(os.getpid(), signal.SIGTERM)
            return Response({"ok": True})

        def get(*_args, **_kwargs):
            result["downloads"] += 1
            return Response()

        def put(url, data, **_kwargs):
            target = root / url.rsplit("/", 1)[-1]
            with target.open("wb") as file:
                for chunk in iter(lambda: data.read(1024 * 1024), b""):
                    file.write(chunk)
            return Response()

        done = threading.Event()
        def sample():
            while not done.wait(.005):
                used = 0
                for path in workspace_root.rglob("*"):
                    try:
                        if path.is_file():
                            used += path.stat().st_size
                    except FileNotFoundError:
                        pass
                result["workspace_peak_bytes"] = max(result["workspace_peak_bytes"], used)
        sampler = threading.Thread(target=sample, daemon=True)
        original_directory = worker.tempfile.TemporaryDirectory
        def task_directory(*args, **kwargs):
            kwargs.setdefault("dir", workspace_root)
            return original_directory(*args, **kwargs)
        worker.tempfile.TemporaryDirectory = task_directory
        worker.safe_url = lambda value: value
        worker.requests.post, worker.requests.get, worker.requests.put = api, get, put
        if hasattr(worker, "EgressClient"):
            worker.EgressClient = lambda *_: worker.requests
        original_render = worker.render
        def rendered(*args, **kwargs):
            try:
                return original_render(*args, **kwargs)
            except Exception as cause:
                result["render_error"] = {"type": type(cause).__name__, "message": str(cause)}
                raise
        worker.render = rendered
        sampler.start()
        started = time.monotonic()
        try:
            worker.main()
        finally:
            done.set(); sampler.join()
        output = root / "output.mp4"
        result.update(source_bytes=source.stat().st_size, elapsed_seconds=round(time.monotonic() - started, 3),
                      python_peak_rss_kib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                      child_peak_rss_kib=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
                      worker_sha256=hashlib.sha256((worker_directory / "main.py").read_bytes()).hexdigest(),
                      output_sha256=hashlib.sha256(output.read_bytes()).hexdigest() if output.exists() else None)
        if expect_legacy_progress_failure:
            if result.get("render_error") != {"type": "ValueError", "message": "invalid literal for int() with base 10: 'N/A'"}:
                raise RuntimeError("历史源码未复现已知N/A故障")
            if len(result["events"]) != 1 or result["events"][0]["action"] != "retry":
                raise RuntimeError("历史源码未保留已知失败回执")
            result["outcome"] = "legacy_progress_error"
            return result
        if len(result["events"]) != 1 or result["events"][0]["action"] != "completed":
            raise RuntimeError("原任务未完成：" + json.dumps(result))
        if not output.exists() or not (root / "thumbnail.jpg").is_file():
            raise RuntimeError("没有真实成片/缩略图")
        result["outcome"] = "completed"
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker-directory", type=Path, default=Path(__file__).resolve().parents[1] / "services/media-worker")
    parser.add_argument("--expect-legacy-progress-failure", action="store_true",
                        help="只用于隔离的旧源码：必须复现确切N/A异常与原retry，不表示旧任务成功")
    arguments = parser.parse_args()
    print(json.dumps(measure(arguments.worker_directory.resolve(), arguments.expect_legacy_progress_failure), ensure_ascii=False))
