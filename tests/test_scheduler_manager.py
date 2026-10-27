"""管理入口启动匹配的生产/维护进程，预检失败不启动。"""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("scheduler_manager", ROOT / "scripts/manage_video_scheduler.py")
manager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manager)


class SchedulerManagerTest(unittest.TestCase):
    def run_manager(self, action, production, probe_code=0):
        commands = []
        def run(command, **_kwargs):
            commands.append(command)
            data = {"services": {"video-scheduler": {"environment": {"PRODUCTION_WORKER_ENABLED": str(production).lower()}}}}
            return subprocess.CompletedProcess(command, probe_code if "--probe" in command else 0,
                stdout=json.dumps(data), stderr="")
        with patch("sys.argv", ["manager", action]), patch.object(Path, "is_file", return_value=True), \
             patch.object(manager.subprocess, "run", side_effect=run):
            result = manager.main()
        return result, commands

    def test_production_starts_and_stops_execution_and_maintenance_after_probe(self):
        result, commands = self.run_manager("start", True)
        self.assertEqual(result, 0)
        self.assertIn("--probe", commands[-2])
        self.assertEqual(commands[-1][-2:], ["video-scheduler", "maintenance-scheduler"])
        self.assertIn("--profile", commands[-1])
        result, commands = self.run_manager("stop", True)
        self.assertEqual(result, 0)
        self.assertEqual(commands[-1][-3:], ["stop", "video-scheduler", "maintenance-scheduler"])

    def test_legacy_mode_only_starts_video_and_failed_probe_never_starts(self):
        result, commands = self.run_manager("start", False)
        self.assertEqual(result, 0)
        self.assertEqual(commands[-1][-1], "video-scheduler")
        self.assertNotIn("maintenance-scheduler", commands[-1])
        result, commands = self.run_manager("start", True, probe_code=1)
        self.assertEqual(result, 1)
        self.assertFalse(any("up" in command for command in commands))


if __name__ == "__main__":
    unittest.main(verbosity=2)
