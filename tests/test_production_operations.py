"""正式运行的告警投递复用原spool卷，不启动第二套派发。"""
import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ProductionOperationsTest(unittest.TestCase):
    def test_delivery_uses_same_persistent_spool_and_separate_secrets(self):
        values = dict(os.environ, RELEASE_DIR="/tmp/fixture-release", SCHEDULER_IMAGE="fixture:scheduler",
                      RENDERER_IMAGE="fixture:renderer", MCP_IMAGE="fixture:mcp",
                      SUPABASE_URL="https://ui-fixture.example", SUPABASE_ANON_KEY="fixture",
                      RUNTIME_SECRETS_DIR="/tmp/fixture-secrets", RENDER_WORKSPACE_PATH="/tmp/fixture-media",
                      MCP_ALLOWED_HOSTS="mcp.example.org,127.0.0.1:8080")
        result = subprocess.run(["docker", "compose", "-f", str(ROOT / "deploy/production/compose.yaml"),
                                 "--profile", "execution", "--profile", "operations", "config", "--format", "json"],
                                env=values, check=True, capture_output=True, text=True)
        services = json.loads(result.stdout)["services"]
        self.assertIn("alert-delivery", services, "正式Compose必须能启动独立投递进程")
        alert = services["alert-delivery"]
        self.assertIn("alert_delivery.py", " ".join(alert["command"]))
        for name in ("scheduler", "maintenance", "alert-delivery"):
            spool = next(volume for volume in services[name]["volumes"] if volume["target"] == "/var/lib/shopro")
            self.assertEqual(spool["source"], "scheduler-alerts")
        self.assertEqual({item["source"] for item in alert["secrets"]},
                         {"video_worker_secret", "relay_secret", "alert_delivery_config"})


if __name__ == "__main__":
    unittest.main()
