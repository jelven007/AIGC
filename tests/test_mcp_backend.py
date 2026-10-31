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
import http_server


class MCPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        mcp.settings.transport_security.allowed_hosts.append("testserver")
        cls.client = TestClient(app)
        cls.client.__enter__()
        cls.addClassCleanup(lambda: cls.client.__exit__(None, None, None))

    def test_http_requires_user_jwt(self):
        self.assertEqual(self.client.post("/mcp", json={}).status_code, 401)

    def test_proxy_host_initialization_and_untrusted_host_rejection(self):
        hosts = http_server.parse_allowed_hosts("mcp.example.org,mcp.example.org:443,127.0.0.1:8080")
        security = mcp.settings.transport_security
        with patch.object(security, "allowed_hosts", hosts):
            payload = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                                  "clientInfo": {"name": "proxy-host-test", "version": "1"}}}
            for host in ("mcp.example.org", "mcp.example.org:443"):
                headers = {"Host": host, "Authorization": "Bearer isolated-user",
                           "Accept": "application/json, text/event-stream"}
                response = self.client.post("/mcp", headers=headers, json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertIn("protocolVersion", response.text)
            headers["Host"] = "untrusted.example.org"
            self.assertEqual(self.client.post("/mcp", headers=headers, json=payload).status_code, 421)
            self.assertEqual(self.client.get("/healthz", headers={"Host": "127.0.0.1:8080"}).status_code, 200)

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

    def test_edit_sdk_preserves_original_clip_price_owner_and_project(self):
        captured = []

        async def backend(function, body):
            captured.append((function, body, request_token.get()))
            return {"costs": {"beats": 0, "subtitles": 3}, "job": {"id": self.key, "status": "pending"}}

        source = {"id": "original-clip", "type": "audio", "url": "https://db.example/private.wav",
                  "start": 2, "duration": 5.5, "sourceStart": 3, "speed": 1.5}
        args = {"mode": "subtitles", "title": "原片段字幕", "source": source,
                "request_key": self.key, "confirmed_credit_cost": 3, "project_id": self.other_key}
        with patch.object(server, "call_backend", backend):
            self.assertFalse(self.call("get_edit_prices", {}, "user-b").get("isError", False))
            self.assertEqual(captured[-1], ("production-jobs", {"action": "edit-prices"}, "user-b"))
            self.assertFalse(self.call("submit_edit_analysis", args, "user-a").get("isError", False))
            function, body, token = captured[-1]
            self.assertEqual(function, "production-jobs")
            self.assertEqual(body["kind"], "edit_analysis")
            self.assertEqual(body["request_key"], self.key)
            self.assertEqual(body["project_id"], self.other_key)
            self.assertEqual(body["input"]["source"], source)
            self.assertEqual(body["input"]["confirmed_credit_cost"], 3)
            self.assertEqual(token, "user-a")
            before = len(captured)
            for change in ({"mode": "legacy"}, {"confirmed_credit_cost": True}, {"confirmed_credit_cost": -1},
                           {"source": {**source, "start": 599}}, {"source": {**source, "speed": 0}},
                           {"source": {**source, "duration": True}}, {"source": {**source, "url": "file:///tmp/audio"}},
                           {"request_key": "not-uuid"}, {"title": ""}):
                self.assertTrue(self.call("submit_edit_analysis", {**args, **change})["isError"])
            self.assertEqual(len(captured), before)
        self.assertIsNone(request_token.get())

    def test_sdk_voice_revoke_and_knowledge_delete_preserve_identity_and_identifiers(self):
        captured = []

        async def backend(function, body):
            captured.append((function, body, request_token.get()))
            return {"accepted": True}

        with patch.object(server, "call_backend", backend):
            self.assertFalse(self.call("revoke_voice_clone", {
                "voice_clone_id": self.key, "request_key": self.other_key}, token="user-b").get("isError", False))
            self.assertFalse(self.call("delete_knowledge_entry", {"entry_id": self.key}, token="user-a").get("isError", False))
        self.assertEqual(captured, [
            ("production-jobs", {"action": "revoke-voice", "voice_clone_id": self.key, "request_key": self.other_key}, "user-b"),
            ("knowledge-base", {"action": "delete", "entry_id": self.key}, "user-a"),
        ])

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
            ("submit_batch_pipeline", {"name": "配音批次", "product_ids": [self.other_key], "provider": "Kling",
                                       "shots": ["特写", "使用"], "narrations": {self.other_key: "用户已确认的台词"}, "voice": "alloy",
                                       "style": "展示", "language": "zh", "expected_unit_cost": 25, "budget": 25}, "batch-video-jobs", "create"),
            ("submit_platform_publish", {"project_id": self.other_key, "connection_id": self.other_key,
                                          "title": "标题", "description": "", "tags": [], "options": options}, "platform-publish", "create"),
            ("submit_publish_group", {"project_id": self.other_key, "source_url": "https://db.example/confirmed.mp4",
                                       "duration": 2, "title": "标题", "description": "", "tags": [],
                                       "targets": [{"connection_id": self.other_key, "options": options}],
                                       "batch_item_id": self.other_key}, "platform-publish", "create_group"),
            ("submit_knowledge_index", {"entry_id": self.other_key, "content_hash": "a" * 64, "confirmed_credit_cost": 2}, "knowledge-base", "create"),
            ("search_knowledge", {"query": "脚本结构", "confirmed_credit_cost": 1}, "knowledge-base", "create"),
            ("save_intelligence_target", {"name": "竞品", "kind": "intelligence_competitor",
                                           "source_slot": "intelligence.youtube", "params": {"account_id": "@channel"}}, "market-intelligence", "save_target"),
            ("collect_market_intelligence", {"target_id": self.other_key, "confirmed_credit_cost": 1}, "market-intelligence", "collect"),
            ("schedule_market_intelligence", {"target_id": self.other_key, "runs": 2, "budget": 2, "confirmed_credit_cost": 1}, "market-intelligence", "schedule"),
            ("extract_product_source", {"mode": "text", "content": "商品名称：真实杯子"}, "product-management", "extract"),
            ("translate_product", {"product_id": self.other_key, "expected_updated_at": "2026-10-22T00:00:00Z",
                                     "target_language": "ja", "include_image": True, "confirmed_credit_cost": 2}, "product-management", "translate"),
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
            ("list_product_translations", {}, "product-management", "translations"),
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

    def test_translation_and_competitor_contracts_reject_unconfirmed_calls(self):
        calls = []

        async def backend(function, body):
            calls.append((function, body))
            return {"job": {}}

        with patch.object(server, "call_backend", backend):
            translation = {"product_id": self.other_key, "expected_updated_at": "2026-10-22T00:00:00Z",
                           "target_language": "ja", "include_image": True, "confirmed_credit_cost": 2,
                           "request_key": self.key}
            for change in [{"target_language": "xx"}, {"include_image": "true"}, {"confirmed_credit_cost": -1}]:
                self.assertTrue(self.call("translate_product", {**translation, **change})["isError"])
            self.assertEqual(calls, [])
            self.assertFalse(self.call("translate_product", translation).get("isError", False))
            self.assertEqual(calls[-1][1]["input"]["expected_updated_at"], translation["expected_updated_at"])
            reference = {"sample_id": self.other_key, "item_id": "real-item", "rights_confirmed": True}
            analysis = {"source_url": "https://db.example/private.mp4", "title": "参考", "mode": "style",
                        "request_key": self.key, "confirmed_credit_cost": 2, "competitor_reference": reference}
            self.assertFalse(self.call("submit_video_analysis", analysis).get("isError", False))
            self.assertEqual(calls[-1][1]["input"]["competitor_reference"], reference)
            before = len(calls)
            for change in [{"mode": "live"}, {"competitor_reference": {**reference, "rights_confirmed": False}}]:
                self.assertTrue(self.call("submit_video_analysis", {**analysis, **change})["isError"])
            self.assertEqual(len(calls), before)

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

    def test_oversized_tool_request_is_rejected_before_business_call(self):
        with patch.object(server, "call_backend") as backend:
            response = self.client.post("/mcp", headers={"Authorization": "Bearer user-a"},
                                        content=b"x" * (256 * 1024 + 1))
            self.assertEqual(response.status_code, 413, response.text)
            backend.assert_not_called()
        self.assertIsNone(request_token.get())

    def test_health_is_process_only_and_requires_no_business_credential(self):
        with patch.object(server, "call_backend") as backend:
            response = self.client.get("/healthz")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"ok": True, "scope": "process"})
            backend.assert_not_called()


class HTTPResourceTest(unittest.IsolatedAsyncioTestCase):
    async def test_inflight_requests_reject_excess_and_release_identity_after_failure(self):
        if not hasattr(http_server, "ResourceLimitsMiddleware"):
            self.fail("MCP缺少有界并发及读取预算")
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def handler(scope, receive, send):
            calls.append(request_token.get())
            entered.set()
            await release.wait()
            raise RuntimeError("private-secret")

        limits = http_server.ResourceLimitsMiddleware(handler, max_concurrent=1, max_per_user=1)
        wrapped = http_server.UserTokenMiddleware(limits)
        scope = {"type": "http", "headers": [(b"authorization", b"Bearer user-a")], "method": "POST"}

        async def receive():
            return {"type": "http.request", "body": b"{}", "more_body": False}

        async def invoke():
            sent = []
            async def send(message):
                sent.append(message)
            try:
                await wrapped(scope, receive, send)
            except RuntimeError:
                pass
            self.assertIsNone(request_token.get())
            return sent

        first = asyncio.create_task(invoke())
        await asyncio.wait_for(entered.wait(), 2)
        denied = await invoke()
        self.assertEqual(denied[0]["status"], 429)
        release.set()
        await first
        await invoke()
        self.assertEqual(calls, ["user-a", "user-a"])
        self.assertEqual(limits.active, {})

    async def test_chunked_oversize_and_slow_body_never_reach_tool(self):
        if not hasattr(http_server, "ResourceLimitsMiddleware"):
            self.fail("MCP没有分块正文/慢请求门禁")
        calls = []
        async def handler(*_):
            calls.append("business")
        for slow in (False, True):
            limits = http_server.ResourceLimitsMiddleware(handler, max_body=5, body_timeout=.02)
            wrapped = http_server.UserTokenMiddleware(limits)
            sent = []
            scope = {"type": "http", "headers": [(b"authorization", b"Bearer user-a")]}
            async def receive():
                if slow:
                    await asyncio.sleep(1)
                return {"type": "http.request", "body": b"xxx", "more_body": True}
            async def send(message):
                sent.append(message)
            await wrapped(scope, receive, send)
            self.assertEqual(sent[0]["status"], 408 if slow else 413)
            self.assertEqual(limits.active, {})
        self.assertEqual(calls, [])
        self.assertIsNone(request_token.get())

    async def test_tool_timeout_releases_budget_without_resending_original_request(self):
        calls, sent = [], []
        async def handler(scope, receive, send):
            calls.append(request_token.get())
            await asyncio.sleep(1)
        limits = http_server.ResourceLimitsMiddleware(handler, request_timeout=.02)
        wrapped = http_server.UserTokenMiddleware(limits)
        async def receive():
            return {"type": "http.request", "body": b"{}", "more_body": False}
        async def send(message):
            sent.append(message)
        await wrapped({"type": "http", "headers": [(b"authorization", b"Bearer user-a")]}, receive, send)
        self.assertEqual(sent[0]["status"], 503)
        self.assertEqual(calls, ["user-a"])
        self.assertEqual(limits.active, {})
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
