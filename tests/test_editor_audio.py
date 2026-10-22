"""以真实PCM频谱和FFmpeg成片验证均衡器、机器人调制、淡变与回声。"""
import copy
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
from render import render, RenderError


class EditorAudioTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.audio = self.root / "source.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                        "aevalsrc=0.15*sin(2*PI*1000*t)+0.15*sin(2*PI*4000*t):s=48000:d=1",
                        str(self.audio)], check=True, capture_output=True, timeout=20)
        self.spec = {"version": 1, "title": "真实音频参数", "duration": 1, "height": 720, "fps": 24, "ratio": "1:1",
                     "tracks": [{"id": "audio", "type": "audio", "start": 0, "duration": 1, "url": "https://example/audio.wav"}]}

    def output(self, changes, name):
        spec = copy.deepcopy(self.spec)
        spec["tracks"][0].update(changes)
        result = render(spec, {"audio": self.audio}, self.root / name)
        data = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(result["file"]),
            "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], timeout=15)
        return np.frombuffer(data, dtype="<f4")

    def amplitude(self, data, frequency):
        cut = data[12000:36000]
        return abs(np.fft.rfft(cut * np.hanning(len(cut)))[round(frequency * len(cut) / 48000)])

    def test_equalizer_changes_actual_frequency_balance(self):
        base = self.output({}, "base")
        equalized = self.output({"eqBands": {"1000": -12, "4000": 6}}, "eq")
        base_ratio = self.amplitude(base, 1000) / self.amplitude(base, 4000)
        eq_ratio = self.amplitude(equalized, 1000) / self.amplitude(equalized, 4000)
        self.assertLess(eq_ratio, base_ratio * .25)
        self.assertLess(abs(len(base) - 48000), 1200)

    def test_robot_modulates_real_sidebands_and_fades_reduce_edges(self):
        robot = self.output({"voiceEffect": "robot"}, "robot")
        self.assertGreater(self.amplitude(robot, 960), self.amplitude(robot, 1000) * 8)
        self.assertGreater(self.amplitude(robot, 1040), self.amplitude(robot, 1000) * 8)
        faded = self.output({"fadeIn": .3, "fadeOut": .3, "echo": 60}, "fade")
        self.assertLess(np.sqrt(np.mean(faded[:2400] ** 2)), np.sqrt(np.mean(faded[20000:26000] ** 2)) * .3)
        self.assertLess(np.sqrt(np.mean(faded[45600:48000] ** 2)), np.sqrt(np.mean(faded[20000:26000] ** 2)) * .45)

    def test_invalid_equalizer_and_modulation_are_not_silently_ignored(self):
        for changes in ({"eqBands": {"movie=attack": 1}}, {"eqBands": {"1000": 13}},
                        {"voiceEffect": "fake"}, {"echo": 101}):
            with self.assertRaises(RenderError):
                self.output(changes, "invalid")


if __name__ == "__main__":
    unittest.main(verbosity=2)
