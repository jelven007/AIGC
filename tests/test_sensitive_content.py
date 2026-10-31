import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from check_sensitive_content import readable_files, redact_report, violations


class SensitiveContentTest(unittest.TestCase):
    def test_username_redaction_preserves_command_and_path_identifiers(self):
        identity = {"username": "operator-fixture", "email": "operator@example.com",
                    "password": "fixture-private-password"}
        command = "--initial-operator-fixture-file /srv/private/initial-operator-fixture.json"
        safe = redact_report("账号 `operator-fixture`；" + command, identity)
        self.assertNotIn("`operator-fixture`", safe)
        self.assertIn(command, safe)

    def test_reports_are_redacted_without_corrupting_json(self):
        identity = {"username": "operator-fixture", "email": "operator@example.com",
                    "password": "fixture-private-password"}
        raw = json.dumps({"login": identity["username"], "email": identity["email"],
                          "password": identity["password"]})
        safe = redact_report(raw, identity)
        self.assertIsInstance(json.loads(safe), dict)
        for value in identity.values():
            self.assertNotIn(value, safe)

    def test_source_files_are_scanned_but_private_runtime_and_dependencies_are_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "source.ts").write_text('const password = "fixture-private-password";')
            (root / ".local").mkdir()
            (root / ".local/runtime.json").write_text("{}")
            (root / "node_modules").mkdir()
            (root / "node_modules/dependency.js").write_text("dependency")
            files = list(readable_files(root))
            self.assertEqual([x.name for x in files], ["source.ts"])
            self.assertTrue(violations(files[0].read_text(), ["fixture-private-password"]))
            self.assertFalse(violations("safe public content", ["fixture-private-password"]))


if __name__ == "__main__":
    unittest.main()
