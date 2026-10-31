"""生产Host必须精确配置，且仍允许容器本地探针。"""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import production_runtime as runtime


class McpHostTest(unittest.TestCase):
    def test_formal_host_and_local_probe_are_validated(self):
        self.assertEqual(runtime.check_mcp_hosts({
            "MCP_ALLOWED_HOSTS": "mcp.example.org,mcp.example.org:443,127.0.0.1:8080"
        }), ["mcp.example.org", "mcp.example.org:443", "127.0.0.1:8080"])

    def test_unsafe_or_incomplete_hosts_cannot_start(self):
        for hosts in ("", "*", "*.example.org,127.0.0.1:8080",
                      "https://mcp.example.org,127.0.0.1:8080", "mcp.example.org:*",
                      "mcp.example.org", "127.0.0.1:8080", "mcp.example.org,,127.0.0.1:8080",
                      "mcp.example.org:65536,127.0.0.1:8080"):
            with self.subTest(hosts=hosts), self.assertRaises(runtime.DeployError):
                runtime.check_mcp_hosts({"MCP_ALLOWED_HOSTS": hosts})


if __name__ == "__main__":
    unittest.main()
