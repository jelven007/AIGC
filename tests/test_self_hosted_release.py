import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from self_hosted import SelfHostError
from self_hosted_release import digest, verify


class ReleaseIntegrityTest(unittest.TestCase):
    def test_verified_payload_rejects_tamper_and_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = root / "payload"
            payload.write_text("frozen deployment")
            value = {"format": 1, "images": [{"platform": "linux/arm64"}],
                     "files": {"payload": digest(payload)}}
            manifest = root / "release-manifest.json"
            manifest.write_text(json.dumps(value))
            self.assertEqual(verify(root), value)
            payload.write_text("changed")
            with self.assertRaises(SelfHostError):
                verify(root)
            value["files"] = {"../payload": "a" * 64}
            manifest.write_text(json.dumps(value))
            with self.assertRaises(SelfHostError):
                verify(root)

    def test_rejects_payload_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.write_text("frozen deployment")
            (root / "payload").symlink_to(target)
            (root / "release-manifest.json").write_text(json.dumps(
                {"format": 1, "images": [{"platform": "linux/arm64"}], "files": {"payload": digest(target)}}))
            with self.assertRaises(SelfHostError):
                verify(root)


if __name__ == "__main__":
    unittest.main()
