"""从实际裁剪音轨提取节拍或分段识别输入；没有音轨时不生成伪结果。"""
import hashlib
import math
from pathlib import Path
import subprocess
import time
import numpy as np
from render import probe, RenderError, numeric


def run_media(args, cancelled, timeout=180):
    with subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
        started = time.monotonic()
        while process.poll() is None:
            if cancelled() or time.monotonic() - started > timeout:
                process.kill()
                process.wait()
                raise RenderError("音轨预处理已停止、租约失效或超过执行时限")
            time.sleep(.1)
        if process.returncode:
            raise RenderError("音轨预处理失败，请检查素材格式")


def detect_beats(samples, rate=16000):
    """10ms步长正向频谱通量。BPM仅对至少8个稳定间隔的峰返回。"""
    if samples.size < 2048 or not np.isfinite(samples).all():
        return {"beats": [], "bpm": None, "confidence": 0.0, "algorithm": "spectral-flux-v1"}
    window, hop = 2048, 160
    frame_count = 1 + (samples.size - window) // hop
    taper = np.hanning(window)
    bands = np.fft.rfftfreq(window, 1 / rate)
    low = (bands >= 40) & (bands <= 250)
    flux = np.zeros(frame_count)
    previous = None
    # 分块以免10分钟素材一次性创建大型FFT矩阵。
    for offset in range(0, frame_count, 256):
        indices = np.arange(offset, min(offset + 256, frame_count))[:, None] * hop + np.arange(window)
        spectrum = np.abs(np.fft.rfft(samples[indices] * taper, axis=1))
        prior = np.vstack([spectrum[0] if previous is None else previous, spectrum[:-1]])
        delta = np.maximum(0, spectrum - prior)
        flux[offset:offset + len(spectrum)] = .7 * delta[:, low].mean(axis=1) + .3 * delta.mean(axis=1)
        previous = spectrum[-1]
    if flux.max(initial=0) < 1e-4:
        return {"beats": [], "bpm": None, "confidence": 0.0, "algorithm": "spectral-flux-v1"}
    # 局部自适应阈值、峰间隔与绝对能量下限抑制静音/低幅噪声。
    strength = []
    for index in range(1, frame_count - 1):
        local = flux[max(0, index - 50):min(frame_count, index + 51)]
        threshold = max(float(np.median(local) * 3 + np.std(local) * .3), float(flux.max() * .08), .001)
        if flux[index] > threshold and flux[index] >= flux[index - 1] and flux[index] > flux[index + 1]:
            if strength and (index - strength[-1]) * hop / rate < .18:
                if flux[index] > flux[strength[-1]]:
                    strength[-1] = index
            else:
                strength.append(index)
    # 窗口中心是峰所在实际音轨位置，不把FFT窗口起点当作节拍。
    beats = [round((index * hop + window / 2) / rate, 3) for index in strength]
    intervals = np.diff(beats)
    bpm, confidence = None, 0.0
    if len(beats) >= 8:
        median = float(np.median(intervals))
        jitter = float(np.median(np.abs(intervals - median)) / median) if median else 1
        confidence = round(max(0, min(1, 1 - 4 * jitter)), 3)
        # 同时要求大部分间隔接近中位数，避免不规则语音被强行估BPM。
        regular = float(np.mean(np.abs(intervals - median) < median * .15)) if median else 0
        if .25 <= median <= 1.5 and confidence >= .7 and regular >= .8:
            bpm = round(60 / median, 2)
    return {"beats": beats[:3000], "bpm": bpm, "confidence": confidence, "algorithm": "spectral-flux-v1"}


def prepare_edit(source, payload, directory, cancelled=lambda: False):
    source, directory = Path(source), Path(directory)
    if not source.is_file() or not 0 < source.stat().st_size <= 500 * 1024 * 1024:
        raise RenderError("剪辑分析素材应为1字节–500MB")
    track = payload.get("source", {})
    duration = numeric(track.get("duration"), None, .1, 600)
    start = numeric(track.get("sourceStart"), 0, 0, 36000)
    speed = numeric(track.get("speed"), 1, .25, 4)
    metadata = probe(source)
    if not any(stream.get("codec_type") == "audio" for stream in metadata["streams"]):
        raise RenderError("所选素材没有音轨，请选择音乐或带声音的视频")
    source_duration = float(metadata.get("format", {}).get("duration", 0))
    if payload.get("pipeline_audio") is True:
        if start != 0 or speed != 1 or not math.isfinite(source_duration) or not .1 <= source_duration <= duration:
            raise RenderError("实际配音长度超过批次镜头总时长，请缩短正文或增加镜头")
        duration = source_duration
    if not math.isfinite(source_duration) or start + duration * speed > source_duration + .05:
        raise RenderError("源音轨长度不足，请调整裁剪与速度")
    digest = hashlib.sha256()
    with source.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            if cancelled():
                raise RenderError("音轨分析已停止或租约失效")
            digest.update(chunk)
    filters = [f"atrim=start={start}:duration={duration*speed}", "asetpts=PTS-STARTPTS"]
    tempo = speed
    while tempo > 2:
        filters.append("atempo=2")
        tempo /= 2
    while tempo < .5:
        filters.append("atempo=.5")
        tempo /= .5
    filters += [f"atempo={tempo}", f"apad=whole_dur={duration}", f"atrim=duration={duration}"]
    directory.mkdir(parents=True, exist_ok=True)
    audio = directory / "audio.wav"
    run_media(["ffmpeg", "-v", "error", "-nostdin", "-y", "-protocol_whitelist", "file,pipe",
               "-i", str(source), "-vn", "-af", ",".join(filters), "-ac", "1", "-ar", "16000",
               "-c:a", "pcm_s16le", str(audio)], cancelled)
    details = {"duration": duration, "source_hash": digest.hexdigest(), "audio": audio}
    if payload.get("mode") == "beats":
        import wave
        with wave.open(str(audio), "rb") as file:
            samples = np.frombuffer(file.readframes(file.getnframes()), dtype="<i2").astype(np.float32) / 32768
        details.update(detect_beats(samples))
    elif payload.get("mode") != "subtitles":
        raise RenderError("剪辑分析类型不支持")
    return details
