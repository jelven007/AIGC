"""自托管第一方 TLS 连接；不放宽供应商或其他内网地址。"""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from egress import EgressClient, PublicConnection
from render import RenderError


class SelfHostedEgressTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.ca = Path(self.directory.name) / "ca.crt"
        self.ca.write_text("test CA fixture")
        self.environment = patch.dict(os.environ, {
            "SELF_HOSTED_BACKEND_ORIGIN": "https://shopro.test:8443",
            "SELF_HOSTED_BACKEND_IPS": "172.31.247.10",
            "SELF_HOSTED_CA_FILE": str(self.ca),
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_explicit_backend_can_use_its_own_tls_origin_and_port(self):
        client = EgressClient("https://shopro.test:8443")
        self.addCleanup(client.close)
        self.assertEqual(client.validate_upload(
            "https://shopro.test:8443/storage/v1/object/upload/sign/materials/user/file"),
            "https://shopro.test:8443/storage/v1/object/upload/sign/materials/user/file")

    def test_backend_port_is_part_of_the_trusted_origin(self):
        client = EgressClient("https://shopro.test:8443")
        self.addCleanup(client.close)
        with self.assertRaises(RenderError):
            client.validate_upload("https://shopro.test:9443/storage/v1/object/materials/user/file")

    def test_other_private_destination_does_not_gain_backend_trust(self):
        with self.assertRaises(RenderError):
            EgressClient("https://unrelated.internal:8443")
        connection = PublicConnection("unrelated.internal", port=443)
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("172.31.247.10", 443))]):
            with self.assertRaises(RenderError):
                connection._new_conn()

    def test_backend_ca_is_applied_only_to_the_first_party_request(self):
        client = EgressClient("https://shopro.test:8443", "media.vendor.example")
        self.addCleanup(client.close)
        with patch.object(client.session, "request", return_value=object()) as request:
            client.post("https://shopro.test:8443/functions/v1/production-worker", json={"action": "alive"})
            self.assertEqual(request.call_args.kwargs["verify"], str(self.ca))
            client.get("https://media.vendor.example/result.mp4")
            self.assertIs(request.call_args.kwargs["verify"], True)

    def test_self_hosting_never_allows_disabling_certificate_validation(self):
        client = EgressClient("https://shopro.test:8443")
        self.addCleanup(client.close)
        with self.assertRaises(RenderError):
            client.post("https://shopro.test:8443/functions/v1/production-worker", verify=False)

    def test_backend_dns_change_to_an_unlisted_private_address_is_rejected(self):
        client = EgressClient("https://shopro.test:8443")
        self.addCleanup(client.close)
        adapter = client.session.get_adapter("https://shopro.test:8443")
        pool = adapter.poolmanager.connection_from_url("https://shopro.test:8443")
        connection = pool.ConnectionCls("shopro.test", port=8443)
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("172.31.247.11", 8443))]):
            with self.assertRaises(RenderError):
                connection._new_conn()

    def test_pinned_backend_connects_to_numeric_address_without_second_dns_lookup(self):
        client = EgressClient("https://shopro.test:8443")
        self.addCleanup(client.close)
        pool = client.session.get_adapter("https://shopro.test:8443").poolmanager.connection_from_url(
            "https://shopro.test:8443")
        connection = pool.ConnectionCls("shopro.test", port=8443)
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("172.31.247.10", 8443))]), \
                patch("socket.create_connection", return_value=object()) as connect:
            connection._new_conn()
            self.assertEqual(connect.call_args.args[0], ("172.31.247.10", 8443))
            self.assertEqual(connection.host, "shopro.test")


if __name__ == "__main__":
    unittest.main()
