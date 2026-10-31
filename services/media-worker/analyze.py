"""只读取本地媒体：真实元数据、有限抽帧、单声道识别音轨。"""
import hashlib
import math
from pathlib import Path
from render import probe, RenderError
from media_process import run_media


def prepare_video(source, directory, cancelled=lambda: False, budget=None):
    source, directory = Path(source), Path(directory)
    if not source.is_file() or not 0 < source.stat().st_size <= 100 * 1024 * 1024:
        raise RenderError("分析视频应为1字节–100MB")
    metadata = probe(source)
    duration = float(metadata.get("format", {}).get("duration", 0))
    if not math.isfinite(duration) or not .1 <= duration <= 600:
        raise RenderError("分析视频时长应为0.1秒–10分钟，请分段上传")
    if not any(stream.get("codec_type") == "video" for stream in metadata["streams"]):
        raise RenderError("分析素材缺少视频画面")
    digest = hashlib.sha256()
    with source.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            if cancelled():
                raise RenderError("分析任务已停止或租约失效")
            digest.update(chunk)
    directory.mkdir(parents=True, exist_ok=True)

    def ffmpeg(options):
        run_media(["ffmpeg", "-v", "error", "-nostdin", "-y", "-protocol_whitelist", "file,pipe",
                   *options], cancelled, timeout=90, budget=budget)

    frames = []
    for index in range(8):
        # 保留开场，覆盖完整素材；不把均匀抽帧解释为镜头边界。
        moment = round(index * max(0, duration - .1) / 7, 3)
        frame = directory / f"frame-{index}.jpg"
        ffmpeg(["-ss", str(moment), "-i", str(source), "-frames:v", "1",
                "-vf", "scale=640:640:force_original_aspect_ratio=decrease", "-q:v", "4", str(frame)])
        if not frame.is_file() or not 0 < frame.stat().st_size <= 1024 * 1024:
            raise RenderError("抽帧失败或单帧超过1MB")
        frames.append({"time": moment, "file": frame})
    has_audio = any(stream.get("codec_type") == "audio" for stream in metadata["streams"])
    audio = directory / "audio.wav"
    if has_audio:
        ffmpeg(["-i", str(source), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                "-fs", str(20 * 1024 * 1024), str(audio)])
        if audio.stat().st_size >= 20 * 1024 * 1024:
            raise RenderError("识别音轨超过20MB，请分段上传")
    return {"duration": duration, "source_hash": digest.hexdigest(), "has_audio": has_audio,
            "frames": frames, "audio": audio if has_audio else None}
