"""MCP 实际 SDK 握手及业务身份回归，在 Python 3.12 容器中执行。"""
import asyncio
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mcp"))
from starlette.testclient import TestClient
from backend_client import request_token
import mcp_shopro_server as server
from http_server import app, mcp


class MCPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        mcp.settings.transport_security.allowed_hosts.append("testserver")
        cls.client = TestClient(app)
        cls.client.__enter__()
        cls.addClassCleanup(lambda: cls.client.__exit__(None, None, None))

    def test_http_requires_user_jwt(self):
        self.assertEqual(self.client.post("/mcp", json={}).status_code, 401)

    def test_real_sdk_initialization_and_tool_call_preserve_user_token(self):
        async def fake_backend(function, body, **kwargs):
            return {"job": {"id": "job", "user": request_token.get(), "request_key": body["request_key"]}}

        headers = {"Authorization": "Bearer user-a", "Accept": "application/json, text/event-stream"}
        with patch.object(server, "call_backend", fake_backend):
            client = self.client
            init = client.post("/mcp", headers=headers, json={
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                           "clientInfo": {"name": "local-test", "version": "1"}},
            })
            self.assertEqual(init.status_code, 200, init.text)
            self.assertIn("protocolVersion", init.text)
            for token in ("user-a", "user-b"):
                response = client.post("/mcp", headers={**headers, "Authorization": f"Bearer {token}"}, json={
                    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": {"name": "submit_video_generation",
                               "arguments": {"prompt": "商品", "request_key": "11111111-1111-4111-8111-111111111111"}},
                })
                self.assertEqual(response.status_code, 200, response.text)
                self.assertIn(token, response.text)
            self.assertIsNone(request_token.get())

    def test_video_payload_matches_business_queue(self):
        captured = []

        async def backend(function, body):
            captured.append((function, body))
            return {"job": {"id": "job", "billing_state": "reserved"}}

        with patch.object(server, "call_backend", backend):
            result = asyncio.run(server.submit_video_generation(
                "商品", "11111111-1111-4111-8111-111111111111"))
        self.assertEqual(result["billing_state"], "reserved")
        self.assertEqual(captured[0][0], "video-jobs")
        self.assertEqual(captured[0][1]["provider"], "ArkSeedance")
        self.assertEqual(captured[0][1]["action"], "create")


if __name__ == "__main__":
    unittest.main(verbosity=2)
