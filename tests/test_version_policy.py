"""Repository versions increment the last decimal digit and carry at nine."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]


class VersionPolicyTest(unittest.TestCase):
    def test_next_version_and_carry(self):
        spec = importlib.util.spec_from_file_location("version_policy", ROOT / "scripts/version_policy.py")
        policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(policy)
        for current, expected in [("1.2.0", "1.2.1"), ("1.2.8", "1.2.9"),
                                  ("1.2.9", "1.3.0"), ("1.9.9", "2.0.0"),
                                  ("9.9.9", "10.0.0"), ("10.0.9", "10.1.0")]:
            with self.subTest(current=current):
                self.assertEqual(policy.next_version(current), expected)

    def test_rejects_non_decimal_or_noncanonical_versions(self):
        spec = importlib.util.spec_from_file_location("version_policy", ROOT / "scripts/version_policy.py")
        policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(policy)
        for version in ("1.2.10", "1.10.0", "01.2.0", "1.2", "v1.2.0",
                        "1.2.0-beta", "1.2.0+build", "-1.2.0", "1.2.0\n"):
            with self.subTest(version=version):
                with self.assertRaises(ValueError):
                    policy.next_version(version)

    def test_sequence_check_rejects_skips_and_rollbacks(self):
        command = [sys.executable, str(ROOT / "scripts/version_policy.py"), "check",
                   "--previous", "1.2.9", "--current"]
        accepted = subprocess.run(command + ["1.3.0"], text=True, capture_output=True)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        for candidate in ("1.4.0", "1.2.8", "1.3.1"):
            rejected = subprocess.run(command + [candidate], text=True, capture_output=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("1.3.0", rejected.stderr)

    def test_next_command_reads_repository_package(self):
        result = subprocess.run([sys.executable, str(ROOT / "scripts/version_policy.py"), "next"],
                                cwd=ROOT, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        current = json.loads((ROOT / "package.json").read_text())["version"]
        major, minor, patch = map(int, current.split("."))
        value = major * 100 + minor * 10 + patch + 1
        self.assertEqual(result.stdout.strip(), f"{value // 100}.{value // 10 % 10}.{value % 10}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
