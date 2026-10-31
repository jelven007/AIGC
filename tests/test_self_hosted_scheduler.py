"""调度器的第一方CA、数字IP建连及目标绑定。"""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import first_party_http as tls


class SchedulerTLSTest(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {
            "SELF_HOSTED_BACKEND_ORIGIN": "https://shopro.test:8443",
            "SELF_HOSTED_BACKEND_IPS": "172.31.247.10",
        }, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def test_only_bound_backend_origin_can_receive_the_dedicated_tls_policy(self):
        policy = tls.backend_policy("https://shopro.test:8443/functions/v1/production-worker")
        self.assertEqual(policy[:3], ("shopro.test", 8443, frozenset({"172.31.247.10"})))
        with self.assertRaises(ValueError):
            tls.backend_policy("https://shopro.test:9443/functions/v1/production-worker")
        with self.assertRaises(ValueError):
            tls.backend_policy("https://other.test:8443/functions/v1/production-worker")

    def test_connection_pins_the_numeric_address_and_rejects_mixed_dns(self):
        connection = tls.pinned_connection("shopro.test", 8443, frozenset({"172.31.247.10"}))("shopro.test", port=8443)
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("172.31.247.10", 8443))]), \
                patch("socket.create_connection", return_value=object()) as connect:
            connection._create_connection(("shopro.test", 8443), 10)
            self.assertEqual(connect.call_args.args[0], ("172.31.247.10", 8443))
            self.assertEqual(connection.host, "shopro.test")
        with patch("socket.getaddrinfo", return_value=[
            (2, 1, 6, "", ("172.31.247.10", 8443)), (2, 1, 6, "", ("172.31.247.11", 8443))]):
            with self.assertRaises(OSError):
                connection._create_connection(("shopro.test", 8443), 10)


if __name__ == "__main__":
    unittest.main()
