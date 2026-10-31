"""真实FFmpeg验证抽帧、音轨、指纹和按真实时间裁剪后的MP4。"""
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services/media-worker"))
from analyze import prepare_video
from render import render, probe, RenderError


class AnalysisMediaTest(unittest.TestCase):
    def test_frames_audio_and_real_clip(self):
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            source = root / "video.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=3",
                            "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-c:a", "aac",
                            "-shortest", str(source)], capture_output=True, check=True, timeout=30)
            result = prepare_video(source, root / "analysis")
            self.assertTrue(result["has_audio"])
            self.assertEqual(result["source_hash"], hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertAlmostEqual(result["duration"], 3, delta=.1)
            self.assertEqual(len(result["frames"]), 8)
            self.assertLess(result["frames"][0]["time"], result["frames"][-1]["time"])
            self.assertTrue(all(frame["file"].read_bytes().startswith(b"\xff\xd8") for frame in result["frames"]))
            audio = probe(result["audio"])["streams"][0]
            self.assertEqual((audio["sample_rate"], audio["channels"]), ("16000", 1))
            clip = render({"version": 1, "title": "真实高光", "duration": 1.2, "height": 720, "ratio": "9:16", "fps": 30,
                           "tracks": [{"id": "source", "type": "video", "start": 0, "sourceStart": 1.1, "duration": 1.2}]},
                          {"source": source}, root / "clip")
            self.assertEqual(probe(clip["file"])["streams"][0]["codec_name"], "h264")
            self.assertAlmostEqual(clip["duration"], 1.2, delta=.1)

    def test_silent_video_and_invalid_source(self):
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            source = root / "silent.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=blue:s=160x90:d=0.5",
                            "-c:v", "libx264", str(source)], capture_output=True, check=True, timeout=30)
            result = prepare_video(source, root / "silent")
            self.assertFalse(result["has_audio"]); self.assertIsNone(result["audio"])
            with self.assertRaisesRegex(RenderError, "停止"):
                prepare_video(source, root / "cancelled", cancelled=lambda: True)
            with self.assertRaises(RenderError):
                prepare_video(root / "missing", root / "bad")


if __name__ == "__main__":
    unittest.main(verbosity=2)
