"""容器中真实FFmpeg验证轨道合成结果，不连接任何云端。"""
import sys
import tempfile
from pathlib import Path
import subprocess
import unittest
import array
import math
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services/media-worker"))
from render import render, probe, RenderError


class RenderTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="render-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for name, color in (("red", "red"), ("blue", "blue")):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color={color}:s=320x180:r=30:d=3",
                            "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                            "-c:a", "aac", "-shortest", str(self.root / f"{name}.mp4")],
                           capture_output=True, check=True, timeout=30)
        self.spec = {"version": 1, "duration": 2, "height": 720, "fps": 30, "ratio": "16:9", "title": "真实合成",
                     "tracks": [
                         {"id": "one", "type": "video", "start": 0, "duration": 1, "sourceStart": .5, "url": "https://example/red.mp4"},
                         {"id": "two", "type": "video", "start": 1, "duration": 1, "speed": 2, "url": "https://example/blue.mp4"},
                     ]}

    def pixels(self, path, moment):
        data = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", str(moment), "-i", str(path),
                                        "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], timeout=15)
        return list(data[:3])

    def pixel_at(self, path, moment, x, y):
        data = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", str(moment), "-i", str(path),
            "-frames:v", "1", "-vf", f"crop=2:2:{x}:{y},scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], timeout=15)
        return list(data[:3])

    def test_trim_concatenate_and_audio_encoding(self):
        result = render(self.spec, {"one": self.root / "red.mp4", "two": self.root / "blue.mp4"}, self.root / "out")
        streams = probe(result["file"])["streams"]
        self.assertEqual(streams[0]["codec_name"], "h264")
        self.assertEqual(streams[0]["width"], 1280)
        self.assertEqual(streams[0]["height"], 720)
        self.assertTrue(any(stream["codec_name"] == "aac" for stream in streams))
        red = self.pixels(result["file"], .5)
        blue = self.pixels(result["file"], 1.5)
        self.assertGreater(red[0], red[2] + 100)
        self.assertGreater(blue[2], blue[0] + 100)
        self.assertAlmostEqual(result["duration"], 2, delta=.1)
        self.assertTrue(result["thumbnail"].is_file())

    def test_pip_and_chinese_subtitles(self):
        self.spec["tracks"][1].update(trackId="pip", start=0, duration=2, speed=1, scale=50, x=50, y=50)
        self.spec["tracks"].append({"id": "text", "type": "text", "start": 0, "duration": 2,
                                    "text": "商品字幕：100% ' 安全", "fontSize": 48, "fontColor": "#ffffff"})
        result = render(self.spec, {"one": self.root / "red.mp4", "two": self.root / "blue.mp4"}, self.root / "pip")
        self.assertGreater(result["size"], 0)

    def test_source_too_short_and_invalid_spec_rejected(self):
        self.spec["tracks"][0]["sourceStart"] = 9
        with self.assertRaises(RenderError):
            render(self.spec, {"one": self.root / "red.mp4", "two": self.root / "blue.mp4"}, self.root / "bad")
        self.spec["duration"] = 36000
        with self.assertRaises(RenderError):
            render(self.spec, {}, self.root / "bad2")

    def test_dissolve_preserves_duration_and_blends_boundary(self):
        self.spec["transition"] = "t2"
        result = render(self.spec, {"one": self.root / "red.mp4", "two": self.root / "blue.mp4"}, self.root / "dissolve")
        mixed = self.pixels(result["file"], 1.25)
        self.assertGreater(mixed[0], 60)
        self.assertGreater(mixed[2], 60)
        self.assertAlmostEqual(result["duration"], 2, delta=.1)

    def test_opacity_keyframes_and_audio_pan_change_real_output(self):
        self.spec["tracks"][0].update(duration=2, sourceStart=0, pan=100)
        self.spec["tracks"][1].update(start=0, duration=2, speed=1, mute=True,
            opacity=0, keyframes=[{"time": 1, "property": "opacity", "value": 100}])
        result = render(self.spec, {"one": self.root / "red.mp4", "two": self.root / "blue.mp4"}, self.root / "keyframes")
        early, late = self.pixels(result["file"], .2), self.pixels(result["file"], 1.5)
        self.assertGreater(early[0], early[2] + 80)
        self.assertGreater(late[2], late[0] + 100)
        samples = array.array("f")
        samples.frombytes(subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(result["file"]),
            "-vn", "-t", "0.5", "-f", "f32le", "-ac", "2", "-"], timeout=15))
        rms = lambda channel: math.sqrt(sum(value * value for value in samples[channel::2]) / (len(samples) / 2))
        self.assertLess(rms(0), .001)
        self.assertGreater(rms(1), .02)

    def test_text_local_animation_and_render_watchdog(self):
        self.spec["tracks"].append({"id": "text", "type": "text", "start": .5, "duration": 1,
            "text": "中文真实成片", "entrance": "ta2", "exit": "ta6", "bgColor": "rgba(239,68,68,.85)",
            "keyframes": [{"property": "x", "time": 1, "value": 60}]})
        files = {"one": self.root / "red.mp4", "two": self.root / "blue.mp4"}
        result = render(self.spec, files, self.root / "text")
        self.assertTrue(result["file"].is_file())
        with self.assertRaisesRegex(RenderError, "停止"):
            render(self.spec, files, self.root / "cancel", cancelled=lambda: True)
        with self.assertRaisesRegex(RenderError, "最大执行"):
            render(self.spec, files, self.root / "timeout", timeout=0)

    def test_real_worker_progress_ignores_unknown_timestamp_until_media_is_encoded(self):
        self.spec["tracks"] = [{"id": str(index), "type": "video", "start": index * .25,
                                "duration": .25, "sourceStart": index * .25} for index in range(8)]
        progress = []
        result = render(self.spec, {str(index): self.root / "red.mp4" for index in range(8)},
                        self.root / "progress", progress=progress.append)
        self.assertAlmostEqual(result["duration"], 2, delta=.1)
        self.assertTrue(result["thumbnail"].is_file())
        self.assertTrue(all(isinstance(value, int) and 0 <= value <= 95 for value in progress))

    def test_four_five_real_encoding_preserves_short_edge(self):
        self.spec["ratio"] = "4:5"
        self.spec["duration"] = 1
        self.spec["tracks"] = [{**self.spec["tracks"][0], "duration": 1}]
        result = render(self.spec, {"one": self.root / "red.mp4"}, self.root / "four-five")
        stream = probe(result["file"])["streams"][0]
        self.assertEqual((stream["width"], stream["height"]), (720, 900))
        self.assertEqual(result["resolution"], "720x900")
        self.assertAlmostEqual(result["duration"], 1, delta=.1)

    def test_filter_intensity_changes_pixels_and_zero_preserves_source(self):
        self.spec["duration"] = .5
        self.spec["tracks"] = [{**self.spec["tracks"][0], "duration": .5, "filter": "f6"}]
        pixels = []
        for intensity in (0, 50, 100):
            self.spec["tracks"][0]["filterIntensity"] = intensity
            result = render(self.spec, {"one": self.root / "red.mp4"}, self.root / f"intensity-{intensity}")
            pixels.append(self.pixels(result["file"], .2))
        self.assertGreater(pixels[0][0], pixels[0][2] + 100)
        self.assertLess(max(pixels[1]) - min(pixels[1]), 10)
        self.assertGreater(pixels[2][2], pixels[2][0] + 100)

    def test_all_special_transitions_change_real_frames_without_changing_duration(self):
        self.spec["duration"] = 1
        self.spec["tracks"][0].update(start=0, duration=.5, sourceStart=0)
        self.spec["tracks"][1].update(start=.5, duration=.5, speed=1)
        self.spec["transitionDuration"] = .25
        files = {"one": self.root / "red.mp4", "two": self.root / "blue.mp4"}
        # 刻意打乱输入顺序；主轨交接必须由时间决定。
        self.spec["tracks"].reverse()
        for transition in (f"t{i}" for i in range(3, 13)):
            with self.subTest(transition=transition):
                self.spec["transition"] = transition
                result = render(self.spec, files, self.root / transition)
                during = self.pixels(result["file"], .6)
                after = self.pixels(result["file"], .9)
                self.assertGreater(sum(abs(a-b) for a, b in zip(during, after)), 15, transition)
                self.assertGreater(after[2], after[0] + 100)
                self.assertAlmostEqual(result["duration"], 1, delta=.05)

    def test_chroma_key_keeps_foreground_and_reveals_background(self):
        green = self.root / "green.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
            "color=0x00ff00:s=320x180:r=30:d=0.5,drawbox=x=120:y=50:w=80:h=80:color=red:t=fill",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(green)], check=True, capture_output=True, timeout=30)
        self.spec["duration"] = .5
        self.spec["tracks"] = [
            {"id": "base", "trackId": "video", "type": "video", "start": 0, "duration": .5},
            {"id": "foreground", "trackId": "pip", "type": "video", "start": 0, "duration": .5,
             "chromaKey": {"color": "#00ff00", "similarity": .3, "smoothness": .05}, "opacity": 50},
        ]
        result = render(self.spec, {"base": self.root / "blue.mp4", "foreground": green}, self.root / "chroma")
        outside, center = self.pixel_at(result["file"], .2, 40, 40), self.pixel_at(result["file"], .2, 640, 360)
        self.assertGreater(outside[2], outside[1] + 150)
        self.assertGreater(center[0], 80)
        self.assertGreater(center[2], 80)

    def test_all_blends_preserve_geometry_alpha_and_real_rgb(self):
        for name, rgb in (("base", "0xb3664d"), ("layer", "0x8099b3")):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                f"color={rgb}:s=320x180:r=30:d=0.3", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(self.root / f"{name}.mp4")],
                check=True, capture_output=True, timeout=30)
        base = self.pixels(self.root / "base.mp4", .1)
        layer = self.pixels(self.root / "layer.mp4", .1)
        def hsl(mode):
            b, s = [[v/255 for v in rgb] for rgb in (base, layer)]
            c, target = (s, b) if mode == "hue" else (b, s)
            lo, hi = min(c), max(c)
            c = [(v-lo)*(max(target)-min(target))/(hi-lo) if hi > lo else 0 for v in c]
            lum = lambda values: sum(a*w for a, w in zip(values, (.3, .59, .11)))
            wanted = lum(b)
            c = [v + wanted-lum(c) for v in c]
            lo, hi = min(c), max(c)
            if lo < 0:
                c = [wanted+(v-wanted)*wanted/(wanted-lo) for v in c]
            if hi > 1:
                c = [wanted+(v-wanted)*(1-wanted)/(hi-wanted) for v in c]
            return [v*255 for v in c]
        expectations = {
            "multiply": [a*b/255 for a, b in zip(base, layer)],
            "screen": [255-(255-a)*(255-b)/255 for a, b in zip(base, layer)],
            "overlay": [2*a*b/255 if a < 128 else 255-2*(255-a)*(255-b)/255 for a, b in zip(base, layer)],
            "difference": [abs(a-b) for a, b in zip(base, layer)],
            "hue": hsl("hue"), "saturation": hsl("saturation"),
        }
        self.spec["duration"] = .3
        self.spec["tracks"] = [
            {"id": "base", "type": "video", "start": 0, "duration": .3},
            {"id": "layer", "trackId": "pip", "type": "video", "start": .1, "duration": .2, "scale": 50},
        ]
        for mode in ("multiply", "screen", "overlay", "softlight", "difference", "hue", "saturation"):
            with self.subTest(mode=mode):
                self.spec["tracks"][1]["blendMode"] = mode
                result = render(self.spec, {name: self.root / f"{name}.mp4" for name in ("base", "layer")}, self.root / mode)
                center, outside, before = self.pixel_at(result["file"], .2, 640, 360), self.pixel_at(result["file"], .2, 40, 40), self.pixels(result["file"], 0)
                self.assertLess(max(abs(a-b) for a, b in zip(outside, base)), 8)
                self.assertLess(max(abs(a-b) for a, b in zip(before, base)), 8)
                self.assertGreater(sum(abs(a-b) for a, b in zip(center, layer)), 10)
                if mode in expectations:
                    self.assertLess(max(abs(a-b) for a, b in zip(center, expectations[mode])), 10, (mode, center, expectations[mode]))

    def test_effect_validation_rejects_ambiguous_and_unsafe_parameters(self):
        from render import validate
        for changes in ({"transition": "drawtext=x"}, {"transitionDuration": float("nan")}):
            with self.assertRaises(RenderError):
                validate({**self.spec, **changes})
        for changes in ({"blendMode": "unknown"}, {"chromaKey": {"color": "red;movie", "similarity": .2, "smoothness": .1}},
                        {"chromaKey": {"color": "#00ff00", "similarity": True, "smoothness": .1}}):
            with self.assertRaises(RenderError):
                validate({**self.spec, "tracks": [{**self.spec["tracks"][0], **changes}]})
        self.spec["transition"] = "t3"
        self.spec["tracks"][1]["start"] = .5
        with self.assertRaisesRegex(RenderError, "不可重叠"):
            validate(self.spec)


if __name__ == "__main__":
    unittest.main(verbosity=2)
