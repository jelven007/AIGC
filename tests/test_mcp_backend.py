"""MCP 实际 SDK 握手及业务身份回归，在 Python 3.12 容器中执行。"""
import asyncio
import base64
import concurrent.futures
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mcp"))
from starlette.testclient import TestClient
import httpx
import backend_client
from backend_client import request_token, BackendError
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

    def call(self, name, arguments, token="user-a"):
        response = self.client.post("/mcp", headers={
            "Authorization": f"Bearer {token}", "Accept": "application/json, text/event-stream",
        }, json={"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                 "params": {"name": name, "arguments": arguments}})
        self.assertEqual(response.status_code, 200, response.text)
        lines = [line[6:] for line in response.text.splitlines() if line.startswith("data: ")]
        return json.loads(lines[-1])["result"] if lines else response.json()["result"]

    def test_sdk_catalog_and_required_fields_reject_legacy_tts(self):
        tools = asyncio.run(server.mcp.list_tools())
        exported = json.loads((Path(__file__).resolve().parents[1] / "mcp/tools.json").read_text())
        self.assertEqual(exported["tools"], [tool.model_dump(mode="json", exclude_none=True) for tool in tools])
        by_name = {tool.name: tool for tool in tools}
        self.assertGreaterEqual(len(tools), 40)
        self.assertIn("confirmed_credit_cost", by_name["synthesize_voice_tts"].inputSchema["required"])
        with patch.object(server, "call_backend") as backend:
            result = self.call("synthesize_voice_tts", {"text": "旧调用"})
            self.assertTrue(result["isError"])
            backend.assert_not_called()
        with patch.object(server, "call_backend") as backend:
            result = self.call("synthesize_voice_tts", {"text": "台词", "request_key": self.key,
                                                       "confirmed_credit_cost": -1})
            self.assertTrue(result["isError"])
            backend.assert_not_called()

    key = "11111111-1111-4111-8111-111111111111"
    other_key = "22222222-2222-4222-8222-222222222222"

    def test_real_sdk_all_production_modalities_use_business_queue(self):
        captured = []

        async def backend(function, body):
            captured.append((function, body))
            return {"job": {"id": self.key, "kind": body.get("kind"), "status": "pending"}}

        tools = [
            ("synthesize_voice_tts", {"text": "台词", "voice_id": "", "speed": 1.2}, "tts"),
            ("submit_audio_transcription", {"audio_url": "https://db.example/private.wav", "filename": "audio.wav"}, "asr"),
            ("submit_voice_clone", {"audio_url": "https://db.example/private.wav", "filename": "audio.wav",
                                     "name": "自有声纹", "consent": True}, "voice_clone"),
            ("submit_avatar_video", {"image_url": "https://db.example/photo.png", "audio_url": "https://db.example/private.wav",
                                      "title": "口播", "consent": True}, "avatar"),
            ("submit_lipsync", {"video_url": "https://db.example/video.mp4", "audio_url": "https://db.example/private.wav",
                                 "title": "口型", "consent": True}, "lipsync"),
            ("submit_video_analysis", {"source_url": "https://db.example/video.mp4", "title": "高光", "mode": "live"}, "analysis"),
        ]
        with patch.object(server, "call_backend", backend):
            for name, args, kind in tools:
                with self.subTest(name=name):
                    result = self.call(name, {**args, "request_key": self.key, "confirmed_credit_cost": 3})
                    self.assertFalse(result.get("isError", False), result)
                    self.assertEqual(captured[-1][0], "production-jobs")
                    self.assertEqual(captured[-1][1]["kind"], kind)
                    self.assertEqual(captured[-1][1]["input"]["confirmed_credit_cost"], 3)
            for name, args in [(name, args) for name, args, kind in tools if kind in ("voice_clone", "avatar", "lipsync")]:
                before = len(captured)
                result = self.call(name, {**args, "consent": False, "request_key": self.key, "confirmed_credit_cost": 3})
                self.assertTrue(result["isError"])
                self.assertEqual(len(captured), before)
        self.assertFalse(any(function == "siliconflow-audio" for function, _ in captured))

    def test_render_export_batch_publish_and_knowledge_protocols(self):
        captured = []

        async def backend(function, body):
            captured.append((function, body))
            if function == "text-generation":
                return {"choices": [{"message": {"content": "依据真实资料的脚本"}}]}
            value = {"id": self.key, "status": "pending"}
            return {"job": value, "export": value, "batch": value, "task": value, "group": value}

        options = {"consent": True, "privacy_level": "SELF_ONLY",
                   **{name: False for name in ("disable_comment", "disable_duet", "disable_stitch",
                                               "brand_content_toggle", "brand_organic_toggle", "is_aigc")}}
        cases = [
            ("submit_image_generation", {"prompt": "主图"}, "production-jobs", "create"),
            ("submit_render", {"render_spec": {"version": 1, "tracks": []}, "project_id": self.other_key}, "production-jobs", "create"),
            ("submit_render_export", {"source_project_id": self.other_key, "formats": [{"ratio": "9:16", "height": 1080}]}, "production-jobs", "export"),
            ("submit_batch_videos", {"name": "批次", "product_ids": [self.other_key], "provider": "Kling",
                                      "style": "展示", "language": "zh", "expected_unit_cost": 10, "budget": 10}, "batch-video-jobs", "create"),
            ("submit_platform_publish", {"project_id": self.other_key, "connection_id": self.other_key,
                                          "title": "标题", "description": "", "tags": [], "options": options}, "platform-publish", "create"),
            ("submit_publish_group", {"project_id": self.other_key, "source_url": "https://db.example/confirmed.mp4",
                                       "duration": 2, "title": "标题", "description": "", "tags": [],
                                       "targets": [{"connection_id": self.other_key, "options": options}]}, "platform-publish", "create_group"),
            ("submit_knowledge_index", {"entry_id": self.other_key, "content_hash": "a" * 64, "confirmed_credit_cost": 2}, "knowledge-base", "create"),
            ("search_knowledge", {"query": "脚本结构", "confirmed_credit_cost": 1}, "knowledge-base", "create"),
            ("save_intelligence_target", {"name": "竞品", "kind": "intelligence_competitor",
                                           "source_slot": "intelligence.youtube", "params": {"account_id": "@channel"}}, "market-intelligence", "save_target"),
            ("collect_market_intelligence", {"target_id": self.other_key, "confirmed_credit_cost": 1}, "market-intelligence", "collect"),
            ("schedule_market_intelligence", {"target_id": self.other_key, "runs": 2, "budget": 2, "confirmed_credit_cost": 1}, "market-intelligence", "schedule"),
            ("extract_product_source", {"mode": "text", "content": "商品名称：真实杯子"}, "product-management", "extract"),
            ("save_products", {"items": [{"draft": {"name": "杯子", "category": "其他", "status": "draft"}}]}, "product-management", "save"),
            ("delete_products", {"items": [{"id": self.other_key, "expected_updated_at": "2026-10-22T00:00:00Z"}]}, "product-management", "delete"),
        ]
        with patch.object(server, "call_backend", backend):
            for name, args, endpoint, action in cases:
                with self.subTest(name=name):
                    result = self.call(name, {**args, "request_key": self.key})
                    self.assertFalse(result.get("isError", False), result)
                    self.assertEqual(captured[-1][0], endpoint)
                    self.assertEqual(captured[-1][1]["action"], action)
                    self.assertEqual(captured[-1][1]["request_key"], self.key)
            script = self.call("generate_marketing_script", {"product_highlights": "真实卖点", "target_audience": "商家",
                                                              "knowledge_job_id": self.other_key})
            self.assertFalse(script.get("isError", False), script)
            self.assertEqual(captured[-1][0], "text-generation")
            self.assertEqual(captured[-1][1]["knowledge_job_id"], self.other_key)

    def test_sdk_read_and_control_tools_preserve_endpoint_and_owner_context(self):
        calls = []

        async def backend(function, body):
            calls.append((function, body, request_token.get()))
            return {"job": {}, "batch": {}, "export": {}}

        cases = [
            ("list_video_jobs", {}, "video-jobs", "list"),
            ("get_media_prices", {}, "production-jobs", "media-prices"),
            ("list_voice_clones", {}, "production-jobs", "voices"),
            ("query_render_export", {"request_key": self.key}, "production-jobs", "query-export"),
            ("query_production_status", {"job_id": self.key}, "production-jobs", "query"),
            ("list_production_jobs", {}, "production-jobs", "list"),
            ("get_analysis_price", {}, "production-jobs", "analysis-price"),
            ("get_batch_video_quote", {}, "batch-video-jobs", "quote"),
            ("query_video_batch", {"request_key": self.key}, "batch-video-jobs", "query"),
            ("list_video_batches", {}, "batch-video-jobs", "list"),
            ("control_video_batch", {"batch_id": self.key, "action": "pause"}, "batch-video-jobs", "pause"),
            ("list_publish_accounts", {}, "platform-accounts", "list"),
            ("get_publish_options", {"connection_id": self.key}, "platform-accounts", "creator"),
            ("query_platform_publish", {"request_key": self.key}, "platform-publish", "query"),
            ("query_publish_group", {"request_key": self.key}, "platform-publish", "query_group"),
            ("list_platform_publish_tasks", {}, "platform-publish", "list"),
            ("cancel_platform_publish", {"task_id": self.key}, "platform-publish", "cancel"),
            ("get_platform_metrics", {}, "platform-publish", "metrics"),
            ("sync_platform_metrics", {}, "platform-publish", "sync"),
            ("list_knowledge", {}, "knowledge-base", "catalog"),
            ("get_knowledge_context", {"job_id": self.key}, "knowledge-base", "context"),
            ("list_market_intelligence", {"kind": "intelligence_competitor"}, "market-intelligence", "catalog"),
            ("import_intelligence_product", {"sample_id": self.key, "item_id": "item"}, "market-intelligence", "import_product"),
            ("delete_intelligence_target", {"target_id": self.key}, "market-intelligence", "delete"),
            ("list_products", {"offset": 0, "limit": 50}, "product-management", "list"),
            ("list_product_imports", {}, "product-management", "imports"),
        ]
        with patch.object(server, "call_backend", backend):
            for name, args, endpoint, action in cases:
                with self.subTest(name=name):
                    result = self.call(name, args, f"ak_live_{'a' * 64}")
                    self.assertFalse(result.get("isError", False), result)
                    self.assertEqual(calls[-1][0], endpoint)
                    self.assertEqual(calls[-1][1]["action"], action)
                    self.assertEqual(calls[-1][2], f"ak_live_{'a' * 64}")
            for name in ("query_production_status", "query_video_status", "query_video_batch", "query_render_export"):
                result = self.call(name, {})
                self.assertTrue(result["isError"])
        self.assertIsNone(request_token.get())

    def test_publish_group_rejects_duplicate_and_unconfirmed_accounts_before_backend(self):
        options = {"consent": True, "privacy_level": "SELF_ONLY", "disable_comment": True,
                   "disable_duet": True, "disable_stitch": True, "brand_content_toggle": False,
                   "brand_organic_toggle": False, "is_aigc": True}
        args = {"project_id": self.other_key, "source_url": "https://db.example/confirmed.mp4",
                "duration": 2, "title": "成片", "description": "", "tags": [], "request_key": self.key}
        for targets in ([], [{"connection_id": self.other_key, "options": options}] * 2,
                        [{"connection_id": self.other_key, "options": {**options, "consent": False}}]):
            with patch.object(server, "call_backend") as backend:
                self.assertTrue(self.call("submit_publish_group", {**args, "targets": targets})["isError"])
                backend.assert_not_called()

    def test_concurrent_identity_isolation_and_unknown_retry_preserves_request(self):
        jobs, attempts = {}, []

        async def backend(function, body):
            user = request_token.get()
            await asyncio.sleep(.03)
            self.assertEqual(request_token.get(), user)
            if body["action"] == "query":
                if (user, body.get("request_key")) not in jobs:
                    raise BackendError(404, body.get("request_key"))
                return {"job": jobs[user, body["request_key"]]}
            attempts.append((user, body["request_key"]))
            job = jobs.setdefault((user, body["request_key"]),
                                  {"id": self.other_key, "owner": user, "request_key": body["request_key"], "status": "pending"})
            if len([entry for entry in attempts if entry == (user, self.key)]) == 1:
                raise BackendError(503, body["request_key"])
            return {"job": job}

        args = {"text": "台词", "request_key": self.key, "confirmed_credit_cost": 3}
        with patch.object(server, "call_backend", backend):
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda token: self.call("synthesize_voice_tts", args, token), ("user-a", "user-b")))
            self.assertTrue(all(result["isError"] for result in results))
            for token in ("user-a", "user-b"):
                queried = self.call("query_production_status", {"request_key": self.key}, token)
                self.assertIn(token, json.dumps(queried))
                retried = self.call("synthesize_voice_tts", args, token)
                self.assertFalse(retried.get("isError", False), retried)
            self.assertEqual(len(jobs), 2)
            self.assertTrue(self.call("query_production_status", {"request_key": self.key}, "user-c")["isError"])
        self.assertIsNone(request_token.get())

    def test_http_rejects_privileged_jwt_and_resets_after_errors(self):
        for role in ("anon", "service_role", "supabase_admin"):
            payload = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
            response = self.client.post("/mcp", headers={"Authorization": f"Bearer header.{payload}.sig"}, json={})
            self.assertEqual(response.status_code, 401)
        self.assertIsNone(request_token.get())


class BackendTransportTest(unittest.IsolatedAsyncioTestCase):
    async def test_product_route_is_allowed_and_preserves_identity_and_receipt(self):
        real_client = httpx.AsyncClient
        calls = []
        async def handler(request):
            calls.append(request)
            return httpx.Response(200, json={"outcome": "accepted"})
        with patch.dict("os.environ", {"SUPABASE_URL": "https://db.example", "SUPABASE_ANON_KEY": "public-anon"}):
            credential = request_token.set("user-products")
            try:
                with patch.object(backend_client.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs)):
                    for action in ("list", "imports", "extract", "save", "delete"):
                        await backend_client.call_backend("product-management", {"action": action, "request_key": MCPTest.key})
                self.assertEqual(len(calls), 5)
                for request in calls:
                    self.assertEqual(request.url.path, "/functions/v1/product-management")
                    self.assertEqual(request.headers["Authorization"], "Bearer user-products")
                    self.assertEqual(json.loads(request.content)["request_key"], MCPTest.key)
            finally:
                request_token.reset(credential)

    async def test_errors_are_redacted_and_mutations_are_never_retried(self):
        real_client = httpx.AsyncClient
        calls = []
        key = MCPTest.key

        async def handler(request):
            calls.append(request)
            raise httpx.ReadTimeout("upstream-secret-key", request=request)

        with patch.dict("os.environ", {"SUPABASE_URL": "https://db.example", "SUPABASE_ANON_KEY": "public-anon"}):
            credential = request_token.set("user-a")
            try:
                with patch.object(backend_client.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs)):
                    with self.assertRaises(BackendError) as error:
                        await backend_client.call_backend("production-jobs", {"action": "create", "request_key": key})
                self.assertEqual(len(calls), 1)
                self.assertEqual(error.exception.request_key, key)
                self.assertNotIn("secret", str(error.exception))
                self.assertEqual(calls[0].headers["Authorization"], "Bearer user-a")
                for status in (401, 403, 409, 429, 503):
                    async def denied(request):
                        return httpx.Response(status, json={"error": "provider-secret"})
                    with patch.object(backend_client.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(denied), **kwargs)):
                        with self.assertRaises(BackendError) as rejection:
                            await backend_client.call_backend("production-jobs", {"action": "create", "request_key": key})
                    self.assertEqual(rejection.exception.status, status)
                    self.assertNotIn("provider-secret", str(rejection.exception))
            finally:
                request_token.reset(credential)

    async def test_legacy_endpoints_redirects_and_unbounded_results_rejected(self):
        real_client = httpx.AsyncClient
        with patch.dict("os.environ", {"SUPABASE_URL": "https://db.example", "SUPABASE_ANON_KEY": "public-anon"}):
            credential = request_token.set("user-a")
            try:
                for endpoint in ("siliconflow-audio", "../payments", "api-keys", "alipay-trade-ops"):
                    with self.assertRaises(ValueError):
                        await backend_client.call_backend(endpoint, {})
                for response in (httpx.Response(302, headers={"Location": "https://other.example"}),
                                 httpx.Response(200, json=["unexpected"]),
                                 httpx.Response(200, text="x" * (backend_client.MAX_RESPONSE_BYTES + 1))):
                    def handler(request):
                        return response
                    with patch.object(backend_client.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs)):
                        with self.assertRaises(BackendError):
                            await backend_client.call_backend("production-jobs", {"action": "query"})
            finally:
                request_token.reset(credential)


if __name__ == "__main__":
    unittest.main(verbosity=2)
