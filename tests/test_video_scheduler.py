"""独立调度器回归：HTTP 替身和周期执行，不访问线上模型。"""
import importlib.util
import io
import json
import os
from pathlib import Path
import threading
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("video_scheduler", ROOT / "scripts/run_video_worker.py")
scheduler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scheduler)


class Response:
    def __init__(self, data):
        self.payload = json.dumps(data).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def read(self, size):
        return self.payload[:size]


class SchedulerTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.secret = "secret_for_scheduler_testing_123456789"
        self.config = scheduler.Config("https://project.example/functions/v1/video-job-worker",
            self.secret, 4, 10, 150, Path(self.directory.name) / "state.json")

    def test_secret_file_and_configuration_validation(self):
        path = Path(self.directory.name) / "secret"
        path.write_text(self.secret)
        environment = {"SUPABASE_URL": "https://project.example/",
            "VIDEO_WORKER_SECRET_FILE": str(path)}
        with patch.dict(os.environ, environment, clear=True):
            config = scheduler.load_config()
            self.assertEqual(config.endpoint, self.config.endpoint)
            self.assertEqual(config.secret, self.secret)
            self.assertNotIn(self.secret, repr(config))
        for value in ["http://project.example", "https://user:password@project.example",
                      "https://project.example?key=value", "https://project.example#secret"]:
            with patch.dict(os.environ, {**environment, "SUPABASE_URL": value}, clear=True):
                with self.assertRaises(ValueError):
                    scheduler.load_config()
        with patch.dict(os.environ, {**environment, "VIDEO_WORKER_CONCURRENCY": "not-a-number"}, clear=True):
            with self.assertRaisesRegex(ValueError, "必须为整数"):
                scheduler.load_config()

    def test_probe_is_read_only_and_validates_worker_version(self):
        class Opener:
            def open(inner, request, timeout):
                self.assertEqual(json.loads(request.data), {"action": "probe"})
                self.assertEqual(request.headers["Authorization"], "Bearer " + self.secret)
                self.assertEqual(timeout, 150)
                return Response({"ready": True, "version": 1})
        with patch.object(scheduler.urllib.request, "build_opener", return_value=Opener()):
            self.assertEqual(scheduler.call_worker(self.config, "probe"), 0)
        with patch.object(scheduler.urllib.request, "build_opener") as mock:
            mock.return_value.open.return_value = Response({"processed": 0})
            with self.assertRaises(scheduler.WorkerError):
                scheduler.call_worker(self.config, "probe")

    def test_redirect_and_http_failure_do_not_leak_remote_response(self):
        self.assertIsNone(scheduler.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.example"))
        with patch.object(scheduler.urllib.request, "build_opener") as mock:
            mock.return_value.open.side_effect = urllib.error.HTTPError(
                self.config.endpoint, 401, self.secret, {}, io.BytesIO(self.secret.encode()))
            with self.assertRaises(scheduler.WorkerError) as error:
                scheduler.call_worker(self.config)
            self.assertEqual(str(error.exception), "http_401")
            self.assertNotIn(self.secret, str(error.exception))

    def test_production_probe_requires_current_schema_and_protocol(self):
        config = scheduler.Config("https://project.example/functions/v1/production-worker",
            self.secret, 4, 10, 150, self.config.state_path)
        good = {"ready": True, "version": 16, "required_migration": "00055", "render_version": 4, "edit_version": 2}
        with patch.object(scheduler.urllib.request, "build_opener") as mock:
            mock.return_value.open.return_value = Response(good)
            self.assertEqual(scheduler.call_worker(config, "probe"), 0)
            for override in ({"version": 1}, {"version": 15}, {"required_migration": "00054"}, {"render_version": 2}, {"edit_version": 1}, {"ready": False}):
                mock.return_value.open.return_value = Response({**good, **override})
                with self.assertRaises(scheduler.WorkerError):
                    scheduler.call_worker(config, "probe")

    def test_malformed_response_and_fake_processed_are_rejected(self):
        for data in [{"processed": True}, {"processed": 3}, {"unexpected": "value"}, []]:
            with patch.object(scheduler.urllib.request, "build_opener") as mock:
                mock.return_value.open.return_value = Response(data)
                with self.assertRaises(scheduler.WorkerError):
                    scheduler.call_worker(self.config)

    def test_bounded_cycle_counts_successes_and_errors(self):
        lock = threading.Lock()
        active = 0
        maximum = 0
        calls = 0
        barrier = threading.Barrier(4)
        def call(config, action="run"):
            nonlocal active, maximum, calls
            with lock:
                index = calls
                calls += 1
                active += 1
                maximum = max(maximum, active)
            barrier.wait(timeout=5)
            with lock:
                active -= 1
            if index == 0:
                raise scheduler.WorkerError("http_503")
            return 1
        with patch.object(scheduler, "call_worker", side_effect=call):
            result = scheduler.run_cycle(self.config)
        self.assertEqual(result, {"processed": 3, "errors": 1, "error_codes": ["http_503"]})
        self.assertEqual(calls, 4)
        self.assertLessEqual(maximum, self.config.concurrency)

    def test_daemon_recovers_after_outage_without_browser_and_reports_health(self):
        class Stop:
            def __init__(self):
                self.waits = []
            def is_set(self):
                return len(self.waits) >= 3
            def wait(self, seconds):
                self.waits.append(seconds)
        stop = Stop()
        cycles = [
            {"processed": 0, "errors": 4, "error_codes": ["http_503"]},
            {"processed": 1, "errors": 0, "error_codes": []},
            {"processed": 0, "errors": 0, "error_codes": []},
        ]
        with patch.object(scheduler, "call_worker", return_value=0) as probe, \
             patch.object(scheduler, "run_cycle", side_effect=cycles), \
             patch.object(scheduler, "log"):
            self.assertEqual(scheduler.serve(self.config, stop), 0)
        probe.assert_called_once_with(self.config, "probe")
        self.assertGreater(stop.waits[0], stop.waits[1])
        self.assertTrue(scheduler.healthy(self.config))
        state = self.config.state_path.read_text()
        self.assertNotIn(self.secret, state)
        parsed = json.loads(state)
        parsed["last_ok"] = 0
        scheduler.write_state(self.config, parsed)
        self.assertFalse(scheduler.healthy(self.config))

    def test_failed_probe_never_dispatches_tasks(self):
        class Stop:
            stopped = False
            def is_set(self):
                return self.stopped
            def wait(self, seconds):
                self.stopped = True
        with patch.object(scheduler, "call_worker", side_effect=scheduler.WorkerError("http_404")), \
             patch.object(scheduler, "run_cycle") as cycle, patch.object(scheduler, "log"):
            scheduler.serve(self.config, Stop())
        cycle.assert_not_called()
        self.assertFalse(scheduler.healthy(self.config))

    def test_production_mode_dispatches_queue_and_metrics_without_browser(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "https://project.example",
            "VIDEO_WORKER_SECRET": self.secret, "PRODUCTION_WORKER_ENABLED": "true"}, clear=True):
            config = scheduler.load_config()
        self.assertTrue(config.endpoint.endswith("/production-worker"))
        config.state_path = self.config.state_path
        class Stop:
            stopped = False
            def is_set(self):
                return self.stopped
            def wait(self, _):
                self.stopped = True
        class Opener:
            def open(inner, request, timeout):
                self.assertEqual(json.loads(request.data), {"action": "metrics"})
                self.assertEqual(request.headers["Authorization"], "Bearer " + self.secret)
                return Response({"collected": 1})
        with patch.object(scheduler, "call_worker", return_value=0), \
             patch.object(scheduler, "run_cycle", return_value={"processed": 1, "errors": 0, "error_codes": []}), \
             patch.object(scheduler.urllib.request, "build_opener", return_value=Opener()), \
             patch.object(scheduler, "log"):
            scheduler.serve(config, Stop())
        state = json.loads(config.state_path.read_text())
        self.assertGreater(state["last_metrics"], 0)
        self.assertTrue(scheduler.healthy(config))


if __name__ == "__main__":
    unittest.main(verbosity=2)
