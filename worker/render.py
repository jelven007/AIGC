"""真实 FFmpeg 时间轴合成：本地输入文件、白名单参数、H.264/AAC 输出。"""
import json
import math
from pathlib import Path
import subprocess
import selectors
import shutil
import time
from render_effects import TRANSITIONS, BLENDS, composite, transition_filters


class RenderError(Exception):
    pass


def probe(path):
    result = subprocess.run(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format",
                             "-of", "json", str(path)], capture_output=True, timeout=30, check=True)
    return json.loads(result.stdout)


def numeric(value, default, low, high):
    value = default if value is None else value
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise RenderError("工程数值参数超出范围")
    return value


def color(value, default="FFFFFF"):
    value = str(value or default).lstrip("#")
    if len(value) not in (6, 8) or any(char not in "0123456789abcdefABCDEF" for char in value):
        raise RenderError("颜色参数格式不正确")
    return value


def background(value):
    if value == "transparent":
        return "00000000"
    if isinstance(value, str) and value.startswith("rgba("):
        parts = value.removeprefix("rgba(").removesuffix(")").split(",")
        if len(parts) != 4:
            raise RenderError("字幕背景颜色不正确")
        rgb = [numeric(float(part), 0, 0, 255) for part in parts[:3]]
        alpha = numeric(float(parts[3]), 1, 0, 1)
        return "".join(f"{round(part):02x}" for part in [*rgb, alpha * 255])
    return color(value, "000000BF")


def expression(track, prop, default, low, high, time="t"):
    base = numeric(track.get(prop), default, low, high)
    frames = sorted([frame for frame in track.get("keyframes", []) if frame["property"] == prop], key=lambda frame: frame["time"])
    points = [(0, base)]
    for frame in frames:
        moment = numeric(frame["time"], 0, 0, track["duration"])
        value = numeric(frame["value"], base, low, high)
        if moment == points[-1][0]:
            points[-1] = (moment, value)
        else:
            points.append((moment, value))
    result = str(points[-1][1])
    for (a, va), (b, vb) in reversed(list(zip(points, points[1:]))):
        result = f"if(lt({time},{b}),{va}+({vb-va})*({time}-{a})/{b-a},{result})"
    return result


def preset_filters(preset, intensity):
    """按浏览器 CSS 滤镜的 RGB 定义应用强度，0% 保持原画。"""
    if preset in ("none", "无", ""):
        return []
    pct = intensity / 100
    def matrix(values):
        keys = ("rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb")
        return "colorchannelmixer=" + ":".join(f"{key}={value:.8f}" for key, value in zip(keys, values))
    def saturation(value):
        weights = (.213, .715, .072)
        return matrix([weights[col] * (1-value) + (value if row == col else 0) for row in range(3) for col in range(3)])
    def contrast(value):
        offset = 255 * .5 * (1-value)
        return "lutrgb=" + ":".join(f"{channel}='clip(val*{value}+{offset},0,255)'" for channel in "rgb")
    def brightness(value):
        return "lutrgb=" + ":".join(f"{channel}='clip(val*{value},0,255)'" for channel in "rgb")
    def sepia(value):
        full = (.393, .769, .189, .349, .686, .168, .272, .534, .131)
        return matrix([(1-value if index in (0, 4, 8) else 0) + value * part for index, part in enumerate(full)])
    if preset == "f1":
        return [contrast(1+.2*pct), saturation(1-.2*pct), brightness(1-.05*pct), sepia(.2*pct)]
    if preset == "f2":
        return [sepia(.35*pct), saturation(1+.3*pct), brightness(1+.05*pct)]
    if preset == "f3":
        c, s = math.cos(math.pi*pct), math.sin(math.pi*pct)
        return [matrix((.213+.787*c-.213*s, .715-.715*c-.715*s, .072-.072*c+.928*s,
                        .213-.213*c+.143*s, .715+.285*c+.140*s, .072-.072*c-.283*s,
                        .213-.213*c-.787*s, .715-.715*c+.715*s, .072+.928*c+.072*s)),
                saturation(1-.1*pct)]
    if preset == "f4":
        return [sepia(.4*pct), contrast(1+.15*pct), brightness(1-.1*pct)]
    if preset == "f5":
        return [saturation(1-pct), contrast(1+.2*pct)]
    if preset == "f6":
        return ["lutrgb=" + ":".join(f"{channel}='val*{1-2*pct}+{255*pct}'" for channel in "rgb")]
    if preset == "f7":
        return [saturation(1+1.2*pct), contrast(1+.1*pct)]
    if preset == "f8":
        return [saturation(1-.8*pct), brightness(1+.05*pct)]
    raise RenderError("滤镜未接入服务端")


def validate(spec):
    if spec.get("version") != 1 or not isinstance(spec.get("tracks"), list) or not 1 <= len(spec["tracks"]) <= 80:
        raise RenderError("工程协议或轨道数不正确")
    duration = numeric(spec.get("duration"), 30, .1, 600)
    height = spec.get("height")
    if height not in (720, 1080, 2160) or spec.get("fps") not in (24, 25, 30, 60) or spec.get("ratio") not in ("16:9", "9:16", "1:1", "4:3", "3:4", "4:5"):
        raise RenderError("输出规格不支持")
    seen = set()
    if spec.get("transition", "none") not in TRANSITIONS:
        raise RenderError("该转场未接入渲染")
    numeric(spec.get("transitionDuration"), .5, .02, 2)
    for item in spec["tracks"]:
        if not isinstance(item, dict) or item.get("type") not in ("video", "image", "audio", "text") or not isinstance(item.get("id"), str) or not item["id"] or item["id"] in seen:
            raise RenderError("轨道类型或标识不正确")
        seen.add(item.get("id"))
        start = numeric(item.get("start"), 0, 0, duration)
        length = numeric(item.get("duration"), 0, .02, duration)
        if start + length > duration + .05:
            raise RenderError("轨道超出工程时长")
        numeric(item.get("layer"), 0, 0, 1000)
        for field in ("fadeIn", "fadeOut"):
            numeric(item.get(field), 0, 0, length)
        if item.get("keyframes") is not None and (not isinstance(item["keyframes"], list) or len(item["keyframes"]) > 100):
            raise RenderError("关键帧数量过多")
        for frame in item.get("keyframes", []):
            if not isinstance(frame, dict) or frame.get("property") not in ("x", "y", "scale", "rotation", "opacity", "volume"):
                raise RenderError("关键帧属性不支持")
            ranges = {"x": (-100, 200), "y": (-100, 200), "scale": (1, 400), "rotation": (-360, 360), "opacity": (0, 100), "volume": (0, 200)}
            numeric(frame.get("time"), None, 0, length)
            numeric(frame.get("value"), None, *ranges[frame["property"]])
            if (item["type"] == "text" and frame["property"] not in ("x", "y", "opacity")
                or item["type"] == "audio" and frame["property"] != "volume"
                or item["type"] == "image" and frame["property"] == "volume"):
                raise RenderError("此轨道不支持所选关键帧属性")
        if item.get("entrance") not in (None, "", "ta1", "ta2") or item.get("exit") not in (None, "", "ta5", "ta6"):
            raise RenderError("字幕动画未接入渲染")
        if item.get("blendMode", "normal") not in BLENDS or (item.get("blendMode", "normal") != "normal" and item["type"] not in ("video", "image")):
            raise RenderError("混合模式不支持")
        if item.get("chromaKey") is not None:
            key = item["chromaKey"]
            if item["type"] not in ("video", "image") or not isinstance(key, dict) or not isinstance(key.get("color"), str) or not key["color"] or len(color(key["color"])) != 6:
                raise RenderError("色键参数不正确")
            numeric(key.get("similarity"), None, .01, 1)
            numeric(key.get("smoothness"), None, 0, 1)
        if item.get("personMask") is not None:
            from person_mask import validate_mask
            if item["type"] not in ("video", "image") or item.get("chromaKey") is not None:
                raise RenderError("人物分割轨道不支持或与色键冲突")
            validate_mask(item["personMask"])
    main = sorted([item for item in spec["tracks"] if item["type"] in ("video", "image") and item.get("trackId", "video") == "video"], key=lambda item: item["start"])
    if spec.get("transition", "none") != "none" and any(a["start"] + a["duration"] > b["start"] + .001 for a, b in zip(main, main[1:])):
        raise RenderError("转场主轨不可重叠，请将叠加素材放入画中画轨")
    return duration


def build_command(spec, media_files, directory):
    duration = validate(spec)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    ratio = [int(part) for part in spec["ratio"].split(":")]
    # height 表示分辨率的短边，横/竖屏保持一致像素密度。
    width = round(spec["height"] * ratio[0] / min(ratio) / 2) * 2
    height = round(spec["height"] * ratio[1] / min(ratio) / 2) * 2
    fps = spec["fps"]
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}:r={fps}:d={duration}",
            "-f", "lavfi", "-i", f"anullsrc=r=48000:cl=stereo:d={duration}"]
    inputs = {}
    visual_inputs = {}
    input_count = 2
    for item in spec["tracks"]:
        if item["type"] == "text":
            continue
        path = Path(media_files[item["id"]]).resolve()
        if not path.is_file():
            raise RenderError("轨道素材不存在")
        index = input_count
        input_count += 1
        inputs[item["id"]] = (index, probe(path))
        if item["type"] == "image":
            args += ["-loop", "1", "-framerate", str(fps), "-t", str(item["duration"]), "-protocol_whitelist", "file,pipe", "-i", str(path)]
        else:
            args += ["-protocol_whitelist", "file,pipe", "-i", str(path)]
        if item.get("personMask"):
            mask_file = Path(media_files[f"{item['id']}:person-mask"])
            if not mask_file.is_file():
                raise RenderError("人物分割蒙版缺失")
            visual_inputs[item["id"]] = input_count
            input_count += 1
            args += ["-protocol_whitelist", "file,pipe", "-i", str(mask_file)]
    filters = ["[0:v]format=rgba[canvas]"]
    current = "canvas"
    audio = ["1:a"]
    def is_main(item):
        return item["type"] in ("video", "image") and item.get("trackId", "video") == "video"
    ordered = sorted(enumerate(spec["tracks"]), key=lambda pair:
                     (0, pair[1]["start"], pair[0]) if is_main(pair[1]) else (1, pair[1].get("layer", pair[0]), pair[0]))
    main = [item for _, item in ordered if is_main(item)]
    boundaries = {}
    for previous, incoming in zip(main, main[1:]):
        if abs(previous["start"] + previous["duration"] - incoming["start"]) <= .001:
            seconds = min(numeric(spec.get("transitionDuration"), .5, .02, 2), incoming["duration"] / 2, previous["duration"] / 2)
            if spec.get("transition") == "t9":
                seconds = min(seconds, .15)
            boundaries[incoming["id"]] = seconds
            boundaries[f"tail:{previous['id']}"] = seconds
    for order, item in ordered:
        kind = item["type"]
        start = item["start"]
        length = item["duration"]
        source_start = numeric(item.get("sourceStart"), 0, 0, 36000)
        speed = numeric(item.get("speed"), 1, .25, 4) if kind != "image" else 1
        if kind in ("video", "image"):
            index, metadata = inputs[item["id"]]
            if not any(stream["codec_type"] == "video" for stream in metadata["streams"]):
                raise RenderError("视频轨道缺少画面")
            if kind == "video" and source_start + length * speed > float(metadata["format"].get("duration", 0)) + .1:
                raise RenderError("源视频长度不足，请调整裁剪或轨道时长")
            scale = expression(item, "scale", 100, 1, 400)
            rotation = expression(item, "rotation", 0, -360, 360)
            track = f"v{order}"
            transition = spec.get("transition", "none") if is_main(item) else "none"
            seconds = boundaries.get(item["id"], 0)
            tail = boundaries.get(f"tail:{item['id']}", 0) if transition not in ("none", "t1") else 0
            masked = item.get("personMask") is not None
            visual_index = visual_inputs.get(item["id"], index)
            visual = [f"trim=start={0 if masked else source_start}:duration={length if masked else length*speed}",
                      f"setpts=(PTS-STARTPTS)/{1 if masked else speed}", f"fps={fps}",
                      "format=rgba"]
            if item.get("chromaKey"):
                key = item["chromaKey"]
                visual.append(f"colorkey=color=0x{color(key['color'])}:similarity={key['similarity']}:blend={key['smoothness']}")
            visual += [
                      f"scale=w='{width}*({scale})/100':h='{height}*({scale})/100':force_original_aspect_ratio=decrease:eval=frame",
                      "setsar=1", "format=rgba"]
            if tail > 0:
                visual.append(f"tpad=stop_mode=clone:stop_duration={tail}")
            if item.get("flipH"):
                visual.append("hflip")
            if item.get("flipV"):
                visual.append("vflip")
            if item.get("rotation") or any(frame["property"] == "rotation" for frame in item.get("keyframes", [])):
                visual.append(f"rotate=angle='({rotation})*PI/180':ow=hypot(iw,ih):oh=hypot(iw,ih):c=none")
            brightness = numeric(item.get("brightness"), 100, 0, 200) / 100
            contrast = numeric(item.get("contrast"), 100, 0, 200) / 100
            saturation = numeric(item.get("saturation"), 100, 0, 200) / 100
            # RGB 滤镜保留抠像/旋转的 alpha，eq 转 YUV 会丢失蒙版。
            if brightness != 1 or contrast != 1:
                visual.append("lutrgb=" + ":".join(f"{c}='clip((val*{brightness}-127.5)*{contrast}+127.5,0,255)'" for c in "rgb"))
            if saturation != 1:
                weights = (.213, .715, .072)
                keys = ("rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb")
                values = [weights[col] * (1-saturation) + (saturation if row == col else 0) for row in range(3) for col in range(3)]
                visual.append("colorchannelmixer=" + ":".join(f"{key}={value}" for key, value in zip(keys, values)))
            preset = item.get("filter", "none")
            visual += preset_filters(preset, numeric(item.get("filterIntensity"), 100, 0, 100))
            opacity = numeric(item.get("opacity"), 100, 0, 100) / 100
            if any(frame["property"] == "opacity" for frame in item.get("keyframes", [])):
                alpha = expression(item, "opacity", 100, 0, 100, "T")
                visual.append(f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({alpha})/100'")
            else:
                visual.append(f"colorchannelmixer=aa={opacity}")
            fade_in = numeric(item.get("fadeIn"), 0, 0, length)
            fade_out = numeric(item.get("fadeOut"), 0, 0, length)
            if transition == "t1" and start > 0:
                fade_in = max(fade_in, min(numeric(spec.get("transitionDuration"), .5, .02, 2), length / 2))
            if transition == "t1" and start + length < duration:
                fade_out = max(fade_out, min(numeric(spec.get("transitionDuration"), .5, .02, 2), length / 2))
            if fade_in:
                visual.append(f"fade=t=in:st=0:d={fade_in}:alpha=1")
            if fade_out:
                visual.append(f"fade=t=out:st={length-fade_out}:d={fade_out}:alpha=1")
            if seconds:
                visual += transition_filters(transition, seconds)
            visual.append(f"setpts=PTS+{start}/TB")
            filters.append(f"[{visual_index}:v]{','.join(visual)}[{track}]")
            x = expression(item, "x", 50, -100, 200, f"(t-{start})")
            y = expression(item, "y", 50, -100, 200, f"(t-{start})")
            target = f"composite{order}"
            position_x = f"W*({x})/100-w/2"
            if seconds and transition in ("t3", "t4"):
                direction = -1 if transition == "t3" else 1
                position_x += f"+{direction}*W*max(0,1-(t-{start})/{seconds})"
            composite(filters, current, track, target, width, height, fps, duration,
                      position_x, f"H*({y})/100-h/2", f"gte(t,{start})*lt(t,{start+length+tail})",
                      item.get("blendMode", "normal"))
            current = target
        if kind in ("audio", "video") and not item.get("mute"):
            index, metadata = inputs[item["id"]]
            if any(stream["codec_type"] == "audio" for stream in metadata["streams"]):
                audio_filter = [f"atrim=start={source_start}:duration={length*speed}", "asetpts=PTS-STARTPTS"]
                pitch = numeric(item.get("pitch"), 0, -12, 12)
                factor = 2 ** (pitch / 12)
                if pitch:
                    audio_filter += ["aresample=48000", f"asetrate={48000*factor}"]
                tempo = speed / factor
                while tempo > 2:
                    audio_filter.append("atempo=2"); tempo /= 2
                while tempo < .5:
                    audio_filter.append("atempo=.5"); tempo /= .5
                audio_filter.append(f"atempo={tempo}")
                volume = expression(item, "volume", 100, 0, 200)
                audio_filter.append(f"volume='({volume})/100':eval=frame")
                if item.get("fadeIn"):
                    audio_filter.append(f"afade=t=in:st=0:d={numeric(item['fadeIn'],0,0,length)}")
                if item.get("fadeOut"):
                    fade = numeric(item["fadeOut"], 0, 0, length)
                    audio_filter.append(f"afade=t=out:st={length-fade}:d={fade}")
                denoise = item.get("denoise", "无降噪")
                if denoise in ("轻度去噪", "深度纯音"):
                    audio_filter += ["highpass=f=80", f"afftdn=nf={-25 if denoise=='轻度去噪' else -20}"]
                elif denoise not in ("无降噪", ""):
                    raise RenderError("降噪档位不支持")
                equalizer = item.get("eqBands", {})
                if not isinstance(equalizer, dict) or set(equalizer) - {"32", "64", "125", "250", "500", "1000", "2000", "4000", "8000", "16000"}:
                    raise RenderError("均衡器频段不支持")
                for frequency, gain in equalizer.items():
                    gain = numeric(gain, 0, -12, 12)
                    if gain:
                        audio_filter.append(f"equalizer=f={int(frequency)}:t=q:w=1:g={gain}")
                voice = item.get("voiceEffect", "none")
                if voice not in ("none", "robot"):
                    raise RenderError("音频调制不支持")
                if voice == "robot":
                    audio_filter += ["aformat=channel_layouts=stereo",
                                     "aeval=exprs='val(0)*sin(2*PI*40*t)|val(1)*sin(2*PI*40*t)'"]
                echo = numeric(item.get("echo"), 0, 0, 100)
                if echo:
                    audio_filter.append(f"aecho=1:1:180:{echo/200}")
                reverb = item.get("reverb", "")
                if reverb and reverb != "原声纯净":
                    echoes = {"录音棚": "aecho=.8:.9:60:.16", "KTV沉浸": "aecho=.8:.9:180:.3",
                              "大厅空间": "aecho=.8:.9:350:.42", "广播电台": "aecho=.8:.9:35:.12", "温暖剧场": "aecho=.8:.9:240:.36"}
                    if reverb not in echoes:
                        raise RenderError("混响档位不支持")
                    audio_filter.append(echoes[reverb])
                audio_filter += [f"atrim=duration={length}", "aresample=48000",
                                 "aformat=sample_fmts=fltp:channel_layouts=stereo"]
                pan = numeric(item.get("pan"), 0, -100, 100) / 100
                if pan:
                    audio_filter.append(f"pan=stereo|c0={min(1,1-pan)}*c0|c1={min(1,1+pan)}*c1")
                audio_filter.append(f"adelay={round(start*1000)}|{round(start*1000)}")
                label = f"audio{order}"
                filters.append(f"[{index}:a]{','.join(audio_filter)}[{label}]")
                audio.append(label)
        if kind == "text":
            text = item.get("text") or item.get("name")
            if not isinstance(text, str) or not text or len(text) > 2000:
                raise RenderError("字幕内容不正确")
            # textfile 禁止把字幕内容插入 filter 字符串。
            text_file = directory / f"text{order}.txt"
            text_file.write_text(text, encoding="utf-8")
            font_size = numeric(item.get("fontSize"), 48, 8, 300)
            align = item.get("textAlign", "center")
            if align not in ("left", "center", "right"):
                raise RenderError("字幕对齐方式不正确")
            x = expression(item, "x", 50, -100, 200, f"(t-{start})")
            y = expression(item, "y", 85, -100, 200, f"(t-{start})")
            target = f"textout{order}"
            font_name = "Noto Sans CJK SC"
            font = str(item.get("fontFamily") or "")
            if "宋" in font or "Serif" in font:
                font_name = "Noto Serif CJK SC"
            font_name += "\\:style=" + ("Bold Italic" if item.get("isBold") and item.get("isItalic")
                                     else "Bold" if item.get("isBold") else "Italic" if item.get("isItalic") else "Regular")
            alpha = expression(item, "opacity", 100, 0, 100, f"(t-{start})")
            animation_length = min(.5, length / 2)
            if item.get("entrance") in ("ta1", "ta2"):
                alpha = f"({alpha})*min(1,max(0,(t-{start})/{animation_length}))"
            if item.get("exit") in ("ta5", "ta6"):
                alpha = f"({alpha})*min(1,max(0,({start+length}-t)/{animation_length}))"
            if item.get("entrance") == "ta2":
                y = f"({y})+10*max(0,1-(t-{start})/{animation_length})"
            if item.get("exit") == "ta6":
                y = f"({y})-10*max(0,1-({start+length}-t)/{animation_length})"
            filters.append(f"[{current}]drawtext=font='{font_name}':textfile='{text_file}':expansion=none:"
                           f"fontsize={font_size}:fontcolor=0x{color(item.get('fontColor'))}:"
                           f"borderw={numeric(item.get('strokeWidth'),0,0,20)}:bordercolor=0x{color(item.get('strokeColor'),'000000')}:"
                           f"box=1:boxborderw=10:boxcolor=0x{background(item.get('bgColor'))}:"
                           f"x='w*({x})/100-{'0' if align=='left' else 'text_w' if align=='right' else 'text_w/2'}':"
                           f"y='h*({y})/100-text_h/2':alpha='({alpha})/100':"
                           f"enable='gte(t,{start})*lt(t,{start+length})'[{target}]")
            current = target
    filters.append(f"[{current}]format=yuv420p[outv]")
    filters.append("".join(f"[{name}]" for name in audio) + f"amix=inputs={len(audio)}:normalize=0,alimiter=limit=.95[outa]")
    graph = directory / "filter.txt"
    graph.write_text(";\n".join(filters), encoding="utf-8")
    args += ["-filter_complex_threads", "1", "-filter_complex_script", str(graph), "-map", "[outv]", "-map", "[outa]",
             "-t", str(duration), "-r", str(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "20",
             "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
             "-progress", "pipe:1", "-fs", str(1024 * 1024 * 1024), str(directory / "output.mp4")]
    return args, (width, height)


def render(spec, media_files, directory, progress=None, cancelled=None, timeout=3600):
    validate(spec)
    started = time.monotonic()
    masked_tracks = [item for item in spec["tracks"] if item.get("personMask")]
    if masked_tracks:
        from person_mask import PersonModel, create_person_mask
        model = PersonModel()
        media_files = dict(media_files)
        mask_bytes = 0
        Path(directory).mkdir(parents=True, exist_ok=True)
        for index, item in enumerate(masked_tracks):
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise RenderError("人物分割超过工程执行时限")
            media_files[f"{item['id']}:person-mask"] = create_person_mask(
                media_files[item["id"]], item, spec["fps"], Path(directory) / f"person-{index}.mkv",
                model, cancelled or (lambda: False), remaining)
            mask_bytes += Path(media_files[f"{item['id']}:person-mask"]).stat().st_size
            if mask_bytes > 768 * 1024 * 1024:
                raise RenderError("工程人物蒙版总量超过768MB，请减少人物片段")
            if progress:
                progress(round(25 * (index + 1) / len(masked_tracks)))
    args, dimensions = build_command(spec, media_files, directory)
    stderr = Path(directory) / "ffmpeg.log"
    with stderr.open("wb") as log:
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=log, text=True)
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while process.poll() is None:
                    if cancelled and cancelled():
                        raise RenderError("任务已停止或租约失效")
                    if time.monotonic() - started > timeout:
                        raise RenderError("渲染超过最大执行时长")
                    if shutil.disk_usage(directory).free < 128 * 1024 * 1024:
                        raise RenderError("渲染临时空间不足，请缩短工程")
                    for key, _ in selector.select(timeout=.5):
                        line = key.fileobj.readline()
                        if line.startswith("out_time_us=") and progress:
                            progress(min(95, round(int(line.strip().split("=")[1]) / (spec["duration"] * 1000000) * 90)))
            if process.wait(timeout=30) != 0:
                raise RenderError("FFmpeg合成失败，请检查轨道参数和媒体格式")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stdout.close()
    output = Path(directory) / "output.mp4"
    metadata = probe(output)
    actual_duration = float(metadata["format"].get("duration", 0))
    if output.stat().st_size >= 1024 * 1024 * 1024 or not math.isfinite(actual_duration) or abs(actual_duration - spec["duration"]) > .1 + 1 / spec["fps"]:
        raise RenderError("成片超过1GB或时长与工程不符，请缩短工程")
    thumbnail = Path(directory) / "thumbnail.jpg"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(output), "-frames:v", "1", str(thumbnail)],
                   check=True, capture_output=True, timeout=30)
    return {"file": output, "thumbnail": thumbnail, "size": output.stat().st_size,
            "duration": actual_duration, "resolution": f"{dimensions[0]}x{dimensions[1]}"}
