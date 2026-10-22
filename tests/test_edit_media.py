"""实际PCM、裁剪变速、FFT节拍、固定人物模型与FFmpeg透明成片回归。"""
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import wave
import urllib.request
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))
from edit_analysis import detect_beats, prepare_edit
from person_mask import PersonModel, MODEL_SHA256, create_person_mask
from render import render, RenderError, probe
import cv2


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", *map(str, args)],
                   check=True, capture_output=True, timeout=60)


class EditMediaTest(unittest.TestCase):
    def test_silence_and_noise_do_not_invent_bpm(self):
        self.assertEqual(detect_beats(np.zeros(16000 * 10))["beats"], [])
        noise = np.random.default_rng(9).normal(0, .00001, 16000 * 5)
        self.assertIsNone(detect_beats(noise)["bpm"])

    def test_actual_pulses_onset_timestamps_crop_speed_and_hash(self):
        rate = 16000
        samples = np.zeros(rate * 12, dtype=np.float32)
        expected = np.arange(.5, 11.6, .5)
        for moment in expected:
            time = np.arange(1600) / rate
            kick = np.sin(2 * np.pi * (80 * time)) * np.exp(-time * 40) * .8
            offset = round(moment * rate)
            samples[offset:offset + len(kick)] += kick
        result = detect_beats(samples)
        self.assertAlmostEqual(result["bpm"], 120, delta=3)
        self.assertEqual(len(result["beats"]), len(expected))
        self.assertLess(max(abs(a - b) for a, b in zip(result["beats"], expected)), .09)
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source.wav"
            with wave.open(str(source), "wb") as file:
                file.setnchannels(1); file.setsampwidth(2); file.setframerate(rate)
                file.writeframes(np.rint(samples * 32767).astype("<i2").tobytes())
            output = prepare_edit(source, {"mode": "beats", "source": {"duration": 4, "sourceStart": 2, "speed": 2}},
                                  Path(folder) / "prepared")
            self.assertEqual(output["source_hash"], hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertAlmostEqual(float(probe(output["audio"])["format"]["duration"]), 4, delta=.03)
            self.assertAlmostEqual(output["bpm"], 240, delta=8)
            self.assertGreater(len(output["beats"]), 10)
            with self.assertRaisesRegex(RenderError, "长度不足"):
                prepare_edit(source, {"mode": "subtitles", "source": {"duration": 8, "sourceStart": 2, "speed": 2}}, folder)

    def test_real_model_alpha_and_video_preserve_audio(self):
        image = ROOT / ".volcengine-build/person-fixture.jpg"
        asset_directory = tempfile.TemporaryDirectory()
        self.addCleanup(asset_directory.cleanup)
        if image.is_file():
            image_bytes = image.read_bytes()
        else:
            with urllib.request.urlopen("https://raw.githubusercontent.com/opencv/opencv/master/samples/data/messi5.jpg", timeout=30) as response:
                image_bytes = response.read(100000)
        self.assertEqual(hashlib.sha256(image_bytes).hexdigest(), "1d570e49654e84c7a943918537bd9e5e1ef82920152e147c834006e235be97c9")
        image = Path(asset_directory.name) / "person.jpg"
        image.write_bytes(image_bytes)
        model = PersonModel()
        settings = {"model": "pphumanseg-2023mar", "threshold": .5, "feather": 1}
        frame = cv2.imread(str(image))
        alpha = model.mask(frame, settings)
        self.assertGreater(int(np.count_nonzero(alpha > 200)), 10000)
        self.assertGreater(int(np.count_nonzero(alpha < 10)), 10000)
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            person = directory / "person.mp4"
            ffmpeg("-loop", "1", "-i", image, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
                   "-t", "1", "-vf", "scale=320:-2", "-r", "24", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                   "-c:a", "aac", person)
            background = directory / "background.png"
            ffmpeg("-f", "lavfi", "-i", "color=blue:s=320x180", "-frames:v", "1", background)
            spec = {"version": 1, "title": "人物蒙版", "duration": 1, "height": 720, "fps": 24, "ratio": "16:9",
                    "tracks": [{"id": "bg", "type": "image", "trackId": "video", "start": 0, "duration": 1, "url": "https://example/bg"},
                               {"id": "person", "type": "video", "trackId": "pip", "start": 0, "duration": 1,
                                "url": "https://example/person", "personMask": settings}]}
            output = render(spec, {"bg": background, "person": person}, directory / "render")
            video = probe(output["file"])
            self.assertTrue(any(stream["codec_type"] == "audio" for stream in video["streams"]))
            self.assertAlmostEqual(output["duration"], 1, delta=.08)
            masked = probe(directory / "render/person-0.mkv")
            self.assertIn(masked["streams"][0]["pix_fmt"], ("bgra", "rgba", "argb"))
            rendered = cv2.imread(str(output["thumbnail"]))
            self.assertGreater(float(rendered[:, :, 0].mean()), float(rendered[:, :, 2].mean()) + 50)
            rms = subprocess.run(["ffmpeg", "-v", "error", "-i", str(output["file"]), "-f", "f32le", "-ac", "1", "pipe:1"],
                                 check=True, capture_output=True, timeout=30)
            self.assertGreater(float(np.sqrt(np.mean(np.frombuffer(rms.stdout, dtype="<f4") ** 2))), .03)
            rotated = directory / "rotated.mp4"
            ffmpeg("-display_rotation:v:0", "90", "-i", person, "-c", "copy", rotated)
            rotated_mask = create_person_mask(rotated, {"type": "video", "duration": .25, "personMask": settings},
                                              24, directory / "rotated-mask.mkv", model)
            raw_stream = probe(person)["streams"][0]
            rotated_stream = probe(rotated_mask)["streams"][0]
            self.assertEqual((rotated_stream["width"], rotated_stream["height"]), (raw_stream["height"], raw_stream["width"]))

    def test_missing_model_and_cancellation_are_explicit(self):
        with tempfile.TemporaryDirectory() as folder:
            wrong = Path(folder) / "model.onnx"
            wrong.write_bytes(b"not a model")
            with self.assertRaisesRegex(RenderError, "摘要不符"):
                PersonModel(wrong)
            audio = Path(folder) / "audio.wav"
            ffmpeg("-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", audio)
            with self.assertRaisesRegex(RenderError, "已停止"):
                prepare_edit(audio, {"mode": "subtitles", "source": {"duration": 1}}, folder, cancelled=lambda: True)
        self.assertEqual(len(MODEL_SHA256), 64)

    def test_adjacent_subtitles_do_not_overlap_at_the_boundary(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            background = directory / "black.png"
            ffmpeg("-f", "lavfi", "-i", "color=black:s=320x180", "-frames:v", "1", background)
            spec = {"version": 1, "title": "字幕边界", "duration": 1, "height": 720, "fps": 24, "ratio": "16:9",
                    "tracks": [{"id": "bg", "type": "image", "start": 0, "duration": 1, "url": "https://example/bg"},
                               {"id": "a", "type": "text", "start": 0, "duration": .5, "text": "X",
                                "fontColor": "#ff0000", "bgColor": "transparent", "fontSize": 150, "y": 50, "x": 20},
                               {"id": "b", "type": "text", "start": .5, "duration": .5, "text": "X",
                                "fontColor": "#00ff00", "bgColor": "transparent", "fontSize": 150, "y": 50, "x": 80}]}
            output = render(spec, {"bg": background}, directory / "render")
            boundary = directory / "boundary.png"
            ffmpeg("-ss", "0.5", "-i", output["file"], "-frames:v", "1", boundary)
            pixels = cv2.imread(str(boundary)).astype(np.int16)
            green = (pixels[:, :, 1] > 120) & (pixels[:, :, 1] > pixels[:, :, 2] + 60)
            red = (pixels[:, :, 2] > 120) & (pixels[:, :, 2] > pixels[:, :, 1] + 60)
            self.assertGreater(int(np.count_nonzero(green)), 1000)
            self.assertLess(int(np.count_nonzero(red)), 20)


if __name__ == "__main__":
    unittest.main(verbosity=2)
