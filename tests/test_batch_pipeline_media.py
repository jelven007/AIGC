"""真实PCM和FFmpeg验证测量完整台词、超长拒绝及多镜头声画合成。"""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))
from edit_analysis import prepare_edit
from render import RenderError, probe, render


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", *map(str, args)],
                   check=True, capture_output=True, timeout=60)


class BatchPipelineMediaTest(unittest.TestCase):
    def test_actual_audio_duration_and_no_truncation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "voice.wav"
            ffmpeg("-f", "lavfi", "-i", "sine=frequency=500:duration=2.75", "-ac", "1", "-ar", "16000", source)
            payload = {"mode": "subtitles", "pipeline_audio": True,
                       "source": {"duration": 6, "sourceStart": 0, "speed": 1}}
            result = prepare_edit(source, payload, root / "prepared")
            self.assertAlmostEqual(result["duration"], 2.75, delta=.03)
            self.assertAlmostEqual(float(probe(result["audio"])["format"]["duration"]), 2.75, delta=.03)
            with self.assertRaisesRegex(RenderError, "超过批次"):
                prepare_edit(source, {**payload, "source": {**payload["source"], "duration": 2}}, root / "too-long")

    def test_multiple_shots_full_audio_and_actual_subtitle_ranges(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            files = {name: root / f"{name}.mp4" for name in ("shot1", "shot2")}
            for name, color in (("shot1", "red"), ("shot2", "blue")):
                ffmpeg("-f", "lavfi", "-i", f"color={color}:s=128x128:r=24:d=2", "-c:v", "libx264", files[name])
            files["voice"] = root / "voice.wav"
            ffmpeg("-f", "lavfi", "-i", "sine=frequency=600:duration=2.75", "-ac", "1", files["voice"])
            specification = {"version": 1, "title": "多镜头", "duration": 4, "ratio": "1:1",
                             "height": 720, "fps": 24, "transition": "none",
                             "tracks": [{"id": name, "type": "video", "trackId": "video", "start": position * 2,
                                         "duration": 2, "speed": 1, "sourceStart": 0, "volume": 0}
                                        for position, name in enumerate(("shot1", "shot2"))] +
                             [{"id": "voice", "type": "audio", "start": 0, "duration": 2.75, "volume": 100},
                              {"id": "line", "type": "text", "start": .5, "duration": 1, "text": "真实台词", "fontSize": 36}]}
            result = render(specification, files, root / "result")
            metadata = probe(result["file"])
            self.assertAlmostEqual(float(metadata["format"]["duration"]), 4, delta=.1)
            self.assertTrue(any(stream["codec_type"] == "audio" for stream in metadata["streams"]))
            for moment, expected_channel in ((.2, 0), (3, 2)):
                sample = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(moment), "-i", str(result["file"]),
                                         "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                                        capture_output=True, check=True, timeout=30).stdout
                self.assertGreater(sample[expected_channel], 150)


if __name__ == "__main__":
    unittest.main(verbosity=2)
