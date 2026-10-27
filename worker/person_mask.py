"""固定PPHumanSeg模型逐帧分割；输入仅本地文件，输出FFV1透明视频。"""
import hashlib
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import time
import cv2
import numpy as np
from render import RenderError, numeric, probe

MODEL_ID = "pphumanseg-2023mar"
MODEL_SHA256 = "552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24"
MODEL_FILE = Path("/opt/shopro-models/person.onnx")


def validate_mask(settings):
    if not isinstance(settings, dict) or settings.get("model") != MODEL_ID:
        raise RenderError("人物分割模型版本不支持")
    numeric(settings.get("threshold"), None, .1, .9)
    numeric(settings.get("feather"), None, 0, 5)


class PersonModel:
    def __init__(self, path=MODEL_FILE):
        path = Path(path)
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != MODEL_SHA256:
            raise RenderError("人物分割模型缺失或摘要不符，请重建Worker镜像")
        self.network = cv2.dnn.readNet(str(path))
        self.network.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self.network.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)

    def mask(self, frame, settings):
        validate_mask(settings)
        image = cv2.cvtColor(cv2.resize(frame, (192, 192)), cv2.COLOR_BGR2RGB)
        blob = cv2.dnn.blobFromImage(image.astype(np.float32) / 127.5 - 1)
        self.network.setInput(blob)
        output = self.network.forward()
        if output.shape != (1, 2, 192, 192) or not np.isfinite(output).all():
            raise RenderError("人物分割模型返回不正确")
        probability = cv2.resize(output[0, 1], (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_LINEAR)
        alpha = np.clip((probability - settings["threshold"]) / .15 + .5, 0, 1)
        if settings["feather"]:
            alpha = cv2.GaussianBlur(alpha, (0, 0), settings["feather"])
        return np.rint(alpha * 255).astype(np.uint8)


def write_frame(fd, data, cancelled, check_space, timeout):
    started = time.monotonic()
    os.set_blocking(fd, False)
    with selectors.DefaultSelector() as selector:
        selector.register(fd, selectors.EVENT_WRITE)
        remaining = memoryview(data)
        while remaining:
            if cancelled() or time.monotonic() - started > timeout:
                raise RenderError("人物分割已停止、租约失效或超过执行时限")
            check_space()
            if selector.select(timeout=.2):
                try:
                    count = os.write(fd, remaining)
                    remaining = remaining[count:]
                except BlockingIOError:
                    continue


def create_person_mask(source, track, fps, target, model, cancelled=lambda: False, timeout=1800, budget=None):
    validate_mask(track["personMask"])
    source, target = Path(source), Path(target)
    metadata = probe(source)
    stream = next((item for item in metadata["streams"] if item["codec_type"] == "video"), None)
    if not stream:
        raise RenderError("人物分割素材缺少画面")
    width = numeric(stream.get("width"), None, 1, 16384)
    height = numeric(stream.get("height"), None, 1, 16384)
    if width * height > 33554432:
        raise RenderError("人物分割源画面超过3200万像素，请先缩小")
    rotation = next((item.get("rotation", 0) for item in stream.get("side_data_list", []) if "rotation" in item),
                    stream.get("tags", {}).get("rotate", 0))
    try:
        if abs(float(rotation)) % 180 == 90:
            width, height = height, width
    except (ValueError, TypeError) as cause:
        raise RenderError("源视频旋转元数据不正确") from cause
    ratio = min(1, 1920 / max(width, height))
    width, height = max(2, round(width * ratio / 2) * 2), max(2, round(height * ratio / 2) * 2)
    duration = numeric(track.get("duration"), None, .02, 600)
    start = numeric(track.get("sourceStart"), 0, 0, 36000)
    speed = numeric(track.get("speed"), 1, .25, 4)
    image = track["type"] == "image"
    if not image and start + duration * speed > float(metadata["format"].get("duration", 0)) + .05:
        raise RenderError("人物分割源视频时长不足")
    filters = f"trim=start={0 if image else start}:duration={duration*speed},setpts=(PTS-STARTPTS)/{speed},fps={fps},scale={width}:{height}"
    decode_args = ["ffmpeg", "-v", "error", "-nostdin", "-threads", "1"]
    if image:
        decode_args += ["-loop", "1", "-framerate", str(fps)]
    decode_args += ["-protocol_whitelist", "file,pipe", "-i", str(source), "-an", "-vf", filters,
                    "-t", str(duration), "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1"]
    encode_args = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "rawvideo", "-pix_fmt", "bgra",
                   "-s", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0", "-an",
                   "-c:v", "ffv1", "-level", "3", "-pix_fmt", "bgra", "-threads", "1", str(target)]
    decoder = subprocess.Popen(decode_args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    encoder = subprocess.Popen(encode_args, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        started, count = time.monotonic(), 0
        buffer = bytearray()
        frame_bytes = width * height * 3

        def check_space():
            if budget:
                budget.check()
            if (target.exists() and target.stat().st_size > 512 * 1024 * 1024
                or shutil.disk_usage(target.parent).free < 128 * 1024 * 1024):
                raise RenderError("人物蒙版超过512MB或临时空间不足，请缩短片段")

        with selectors.DefaultSelector() as selector:
            selector.register(decoder.stdout, selectors.EVENT_READ)
            while True:
                if cancelled() or time.monotonic() - started > timeout:
                    raise RenderError("人物分割已停止、租约失效或超过执行时限")
                check_space()
                if not selector.select(timeout=.2):
                    continue
                # read1不等待整个帧，允许逐200ms检查租约和取消。
                chunk = decoder.stdout.read1(min(frame_bytes - len(buffer), 1024 * 1024))
                if not chunk:
                    break
                buffer.extend(chunk)
                if len(buffer) == frame_bytes:
                    frame = np.frombuffer(buffer, dtype=np.uint8).reshape(height, width, 3)
                    alpha = model.mask(frame, track["personMask"])
                    write_frame(encoder.stdin.fileno(), np.dstack((frame, alpha)).tobytes(),
                                cancelled, check_space, timeout - (time.monotonic() - started))
                    buffer = bytearray()
                    count += 1
                    if count > round(duration * fps) + 2:
                        raise RenderError("人物分割帧数超过工程范围")
        encoder.stdin.close()
        if decoder.wait(timeout=30) or encoder.wait(timeout=30) or buffer or count < 1:
            raise RenderError("人物分割视频编码失败")
        check_space()
        return target
    except (BrokenPipeError, subprocess.TimeoutExpired) as cause:
        raise RenderError("人物分割视频处理失败") from cause
    finally:
        for process in (decoder, encoder):
            if process.poll() is None:
                process.kill()
            process.wait()
        decoder.stdout.close()
        if not encoder.stdin.closed:
            encoder.stdin.close()
