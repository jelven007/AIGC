"""真实配置生成的边界与重复初始化；不访问任何外部服务。"""
import base64
import hashlib
import hmac
import ipaddress
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import self_hosted


class ConfigurationTest(unittest.TestCase):
    def test_generated_jwt_is_signed_and_has_only_requested_role(self):
        key = "a" * 64
        for role in ("anon", "service_role"):
            token = self_hosted.jwt_key(key, role)
            header, payload, signature = token.split(".")
            decoded = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            self.assertEqual(decoded["role"], role)
            self.assertNotIn("password", decoded)
            expected = base64.urlsafe_b64encode(hmac.new(key.encode(), (header + "." + payload).encode(),
                                                       hashlib.sha256).digest()).decode().rstrip("=")
            self.assertEqual(signature, expected)

    def test_repeat_configure_preserves_secrets_and_rejects_another_origin(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self_hosted.configure(root, "https://shopro.test:8443", project="shopro-test")
            original = path.read_bytes()
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self_hosted.configure(root, "https://shopro.test:8443", project="shopro-test")
            self.assertEqual(path.read_bytes(), original)
            with self.assertRaises(self_hosted.SelfHostError):
                self_hosted.configure(root, "https://other.test:8443", project="shopro-test")
            self.assertEqual(path.read_bytes(), original)

    def test_configure_rejects_plaintext_credentials_and_non_root_addresses(self):
        for value in ("http://shopro.test", "https://user:password@shopro.test",
                      "https://shopro.test/backend", "https://shopro.test?q=x",
                      "https://shopro.test#fragment"):
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(self_hosted.SelfHostError):
                    self_hosted.configure(Path(directory), value, project="shopro-test")

    def test_public_runtime_contains_only_login_capability_without_account_details(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self_hosted.configure(Path(directory), "https://shopro.test:8443", project="shopro-test")
            private = self_hosted.read_env(path)
            public = self_hosted.public_config(private)
            self.assertTrue(public["usernameLogin"])
            self.assertNotIn("adminLogin", public)
            self.assertEqual(public["backendAnonKey"], private["ANON_KEY"])
            output = json.dumps(public)
            for name in ("SERVICE_ROLE_KEY", "JWT_SECRET", "POSTGRES_PASSWORD", "VIDEO_WORKER_SECRET"):
                self.assertNotIn(private[name], output)
            self.assertNotIn("password", output)
            self.assertNotIn("email", output)

    def test_ip_origin_uses_its_literal_address_and_domain_uses_docker_dns(self):
        for origin, expected in (("https://192.0.2.10", "192.0.2.10"),
                                 ("https://shopro.test:8443", "172.31.247.10")):
            with tempfile.TemporaryDirectory() as directory:
                path = self_hosted.configure(Path(directory), origin, project="shopro-test")
                values = self_hosted.read_env(path)
                self.assertEqual(values["BACKEND_ALLOWED_IPS"], expected)
                self.assertEqual(values["BACKEND_IP"], "172.31.247.10")
                self.assertNotIn(ipaddress.ip_address(values["BACKEND_IP"]),
                                 ipaddress.ip_network(values["DOCKER_IP_RANGE"]))


if __name__ == "__main__":
    unittest.main()
