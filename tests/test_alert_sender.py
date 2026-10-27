"""告警relay真实本地HTTP、未知回执和离线持久重试。"""
import http.server
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
try:
    import alert_delivery as delivery
except ModuleNotFoundError:
    delivery = None
spec = importlib.util.spec_from_file_location("scheduler_sender_fixture", ROOT / "scripts/run_video_worker.py")
scheduler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scheduler)


class AlertSenderTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "alerts.json"
        self.requests = []
        self.remote_item = None
        self.reply = "accepted"
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append((self.path, dict(self.headers), payload))
                if self.path == "/relay":
                    if outer.reply == "redirect":
                        self.send_response(302)
                        self.send_header("Location", "/stolen")
                        self.end_headers()
                        return
                    answer = {"accepted": True, "event_id": payload["event_id"] if outer.reply == "accepted" else str(uuid.uuid4()),
                              "secret": "must_not_persist"}
                elif payload["action"] == "alert_claim":
                    answer = outer.remote_item
                    outer.remote_item = None
                else:
                    answer = {"saved": True}
                data = json.dumps(answer).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.base = f"http://127.0.0.1:{server.server_port}"
        self.config = {"isolated": True, "worker_url": self.base + "/worker", "worker_secret": "worker-test",
                       "relay_url": self.base + "/relay", "relay_secret": "relay-test", "channel": "operations",
                       "spool_paths": [str(self.path)]}
        self.scheduler_config = scheduler.Config(self.config["worker_url"], "worker-test", 1, 10, 30, self.path.with_name("state.json"), self.path)
        with patch.object(scheduler, "log"):
            scheduler.persist_local_alerts(self.scheduler_config, {"failures": 3, "monitor_failures": 0})

    def test_offline_original_uuid_exact_ack_and_no_remote_response_persistence(self):
        self.assertIsNotNone(delivery, "durable sender implementation missing")
        original = json.loads(self.path.read_text())["events"][0]["event_id"]
        result = delivery.run_once(self.config)
        self.assertEqual(result["delivered"], 1)
        headers = self.requests[0][1]
        self.assertEqual(headers["Idempotency-Key"], original)
        self.assertEqual(headers["Authorization"], "Bearer relay-test")
        saved = json.loads(self.path.read_text())["events"][0]
        self.assertEqual(saved["receipt"], {"accepted": True, "event_id": original})
        self.assertNotIn("must_not_persist", self.path.read_text())
        delivery.run_once(self.config)
        self.assertEqual(len([r for r in self.requests if r[0] == "/relay"]), 1)

    def test_unknown_and_redirect_retry_same_event_after_restart(self):
        self.assertIsNotNone(delivery, "durable sender implementation missing")
        self.reply = "wrong"
        delivery.run_once(self.config)
        saved = json.loads(self.path.read_text())["events"][0]
        original = saved["event_id"]
        self.assertGreater(saved["next_run_at"], delivery.time.time())
        self.assertNotIn("delivered_at", saved)
        delivery.run_once(self.config)
        self.assertEqual(len([r for r in self.requests if r[0] == "/relay"]), 1)
        with delivery.spool(self.path) as value:
            value["events"][0]["next_run_at"] = 0
        self.reply = "redirect"
        delivery.run_once(self.config)
        self.assertFalse(any(r[0] == "/stolen" for r in self.requests))
        with delivery.spool(self.path) as value:
            value["events"][0]["next_run_at"] = 0
        self.reply = "accepted"
        delivery.run_once(self.config)
        self.assertEqual({r[1]["Idempotency-Key"] for r in self.requests if r[0] == "/relay"}, {original})
        self.assertEqual(json.loads(self.path.read_text())["events"][0]["attempts"], 3)

    def test_scheduler_keeps_more_than_100_undelivered_events(self):
        with patch.object(scheduler, "log"):
            for i in range(110):
                scheduler.persist_local_alerts(self.scheduler_config, {"failures": 0 if i % 2 == 0 else 3})
        events = json.loads(self.path.read_text())["events"]
        self.assertEqual(len(events), 111)
        self.assertEqual(len({e["event_id"] for e in events}), len(events))

    def test_confirmed_history_is_bounded_without_resetting_event_version(self):
        self.assertIsNotNone(delivery, "durable sender implementation missing")
        with patch.object(scheduler, "log"):
            for i in range(130):
                scheduler.persist_local_alerts(self.scheduler_config, {"failures": 0 if i % 2 == 0 else 3})
        with delivery.spool(self.path) as value:
            previous = max(e["version"] for e in value["events"])
            for event in value["events"]:
                event["delivered_at"] = delivery.time.time()
        with patch.object(scheduler, "log"):
            scheduler.persist_local_alerts(self.scheduler_config, {"failures": 0})
        events = json.loads(self.path.read_text())["events"]
        self.assertEqual(sum(bool(e.get("delivered_at")) for e in events), 100)
        self.assertEqual(len(events), 101)
        self.assertEqual(events[-1]["version"], previous + 1)

    def test_real_config_rejects_http_and_requires_private_credentials(self):
        self.assertIsNotNone(delivery, "durable sender implementation missing")
        with self.assertRaises(delivery.DeliveryError):
            delivery.validate_url(self.base + "/relay", isolated=False)
        with self.assertRaises(delivery.DeliveryError):
            delivery.validate_url("https://user:pass@relay.example", isolated=False)
        config_path = self.path.with_name("delivery-config.json")
        config = {**self.config}
        for name in ("worker", "relay"):
            secret = self.path.with_name(name + "-secret")
            secret.write_text(name + "-test-" + "a" * 32)
            secret.chmod(0o600)
            config[name + "_secret_file"] = str(secret)
        config_path.write_text(json.dumps(config)); config_path.chmod(0o600)
        self.assertTrue(delivery.load_config(config_path)["relay_secret"].startswith("relay-test-"))
        Path(config["relay_secret_file"]).chmod(0o644)
        with self.assertRaises(delivery.DeliveryError):
            delivery.load_config(config_path)

    def test_remote_original_event_and_lease_are_returned_in_receipt(self):
        self.assertIsNotNone(delivery, "durable sender implementation missing")
        event_id, lease = str(uuid.uuid4()), str(uuid.uuid4())
        self.remote_item = {"event_id": event_id, "lease_token": lease,
                            "payload": {"event_id": event_id, "event": "opened", "rule": "queue_stalled"}}
        result = delivery.run_once({**self.config, "spool_paths": []})
        self.assertEqual(result, {"delivered": 1, "errors": 0})
        finish = next(r[2] for r in self.requests if r[2].get("action") == "alert_finish")
        self.assertEqual(finish, {"action": "alert_finish", "channel": "operations", "event_id": event_id,
                                 "lease_token": lease, "receipt": {"event_id": event_id, "accepted": True}})


if __name__ == "__main__":
    unittest.main(verbosity=2)
