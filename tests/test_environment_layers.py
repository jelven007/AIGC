"""Auth在线不能把缺失业务和未核验Worker报告为全栈就绪。"""
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import dev_environment as dev


class Reply(io.BytesIO):
    status = 200


class EnvironmentLayersTest(unittest.TestCase):
    def test_private_project_public_flag_reaches_development_container(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env.local").write_text(
                "VITE_SUPABASE_URL=http://127.0.0.1:54329\n"
                "VITE_SUPABASE_ANON_KEY=public-fixture\nVITE_USERNAME_LOGIN=true\n")
            with patch.object(dev, "ROOT", root):
                _, _, env = dev.public_environment()
            self.assertEqual(env.get("SHOPRO_DEV_USERNAME_LOGIN"), "true")

    def test_missing_flag_does_not_inherit_stale_host_setting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env.local").write_text(
                "VITE_SUPABASE_URL=https://backend.example.com\n"
                "VITE_SUPABASE_ANON_KEY=public-fixture\n")
            with patch.object(dev, "ROOT", root), patch.dict(
                    dev.os.environ, {"SHOPRO_DEV_USERNAME_LOGIN": "true"}):
                _, _, env = dev.public_environment()
            self.assertEqual(env.get("SHOPRO_DEV_USERNAME_LOGIN"), "false")

    def test_invalid_username_capability_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env.local").write_text(
                "VITE_SUPABASE_URL=https://backend.example.com\n"
                "VITE_SUPABASE_ANON_KEY=public-fixture\nVITE_USERNAME_LOGIN=yes\n")
            with patch.object(dev, "ROOT", root), self.assertRaises(RuntimeError):
                dev.public_environment()

    def test_auth_online_missing_business_does_not_claim_full_stack(self):
        def open_request(request, timeout):
            if "/auth/" in request.full_url:
                return Reply(b'{"name":"GoTrue"}')
            raise HTTPError(request.full_url, 404, "missing", {}, None)
        with patch.object(dev.OPENER, "open", side_effect=open_request):
            report = dev.backend_report("https://test.example", "public")
        self.assertEqual(report["auth"]["state"], "ready")
        self.assertEqual(report["business"]["state"], "missing")
        self.assertEqual(report["worker"]["state"], "unverified")
        self.assertFalse(report["full_stack_ready"])

    def test_public_endpoints_do_not_claim_authenticated_business_acceptance(self):
        with patch.object(dev.OPENER, "open", side_effect=lambda request, timeout:
                          Reply(b'{"name":"GoTrue"}' if "/auth/" in request.full_url else b'[]')):
            report = dev.backend_report("https://test.example", "public")
        self.assertEqual(report["business"]["state"], "reachable")
        self.assertFalse(report["full_stack_ready"])

    def test_network_error_is_reported_without_credential_or_raw_response(self):
        with patch.object(dev.OPENER, "open", side_effect=OSError("secret-raw-error")):
            report = dev.backend_report("https://test.example", "private-fixture-key")
        self.assertEqual(report["auth"]["state"], "unavailable")
        self.assertNotIn("private-fixture-key", json.dumps(report))
        self.assertNotIn("secret-raw-error", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
