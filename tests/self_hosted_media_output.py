"""下载真实任务成片，检查编码、时长、红蓝剪辑及中文字幕像素。"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

import numpy as np
import requests

assert os.environ.get("SELF_HOSTED_ISOLATED_ACCEPTANCE") == "true"
base, anon = os.environ["PUBLIC_ORIGIN"], os.environ["ANON_KEY"]
client = requests.Session()
client.trust_env = False
client.verify = "/run/tls/ca.crt"
client.headers.update({"apikey": anon})


import sys as _initial_sys
_initial_sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from initial_admin import read_initial_admin
INITIAL_IDENTITY = read_initial_admin()

def api(path, body=None):
    response = client.request("POST" if body is not None else "GET", base + path, json=body, timeout=30)
    response.raise_for_status()
    return response.json()


session = api("/auth/v1/token?grant_type=password", {"email": INITIAL_IDENTITY["email"], "password": INITIAL_IDENTITY["password"]})
client.headers["Authorization"] = "Bearer " + session["access_token"]
receipt = json.loads(Path("/receipts/business-checks.json").read_text())
job_id = receipt["self_hosted_business_checks"]["real_ffmpeg_queue"]["job_id"]
job = api("/functions/v1/production-jobs", {"action": "query", "job_id": job_id})["job"]
url = job["result"].get("video_url") or job["result"].get("url")
assert url and url.startswith(base + "/storage/v1/"), "成片必须属于本实例Storage"
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / "result.mp4"
    response = client.get(url, timeout=30)
    response.raise_for_status()
    path.write_bytes(response.content)
    metadata = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams",
        "-show_format", "-of", "json", str(path)]))
    video = next(stream for stream in metadata["streams"] if stream["codec_type"] == "video")
    audio = [stream for stream in metadata["streams"] if stream["codec_type"] == "audio"]
    assert video["codec_name"] == "h264" and video["width"] == 1280 and video["height"] == 720
    assert abs(float(metadata["format"]["duration"]) - 2) < 0.1
    assert not audio or all(stream["codec_name"] == "aac" for stream in audio)
    white_counts = []
    for timestamp, color in ((0.5, 0), (1.5, 2)):
        raw = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", str(timestamp), "-i", str(path),
            "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"])
        frame = np.frombuffer(raw, dtype=np.uint8).reshape(720, 1280, 3)
        corner = frame[:100, :100].mean(axis=(0, 1))
        assert corner[color] > 200 and all(corner[i] < 40 for i in range(3) if i != color), "红蓝剪辑顺序错误"
        white = int((frame.min(axis=2) > 180).sum())
        assert white > 100, "中文字幕未烧录到视频像素"
        white_counts.append(white)
    print(json.dumps({"passed": True, "job_id": job_id, "codec": video["codec_name"],
        "audio_codecs": [stream["codec_name"] for stream in audio], "duration": metadata["format"]["duration"],
        "resolution": "1280x720", "bytes": path.stat().st_size,
        "red_then_blue": True, "burned_subtitle_white_pixels": white_counts}))
