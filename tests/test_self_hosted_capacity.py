"""容量配置正确性：真实Compose展开、私有配置原子回滚及镜像身份。"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import self_hosted
import self_hosted_capacity as capacity


class CapacityTest(unittest.TestCase):
    def test_compose_capacity_and_rollback_preserve_identity_and_secrets(self):
        with tempfile.TemporaryDirectory() as folder:
            env = self_hosted.configure(Path(folder), "https://shopro.test", project="shopro-capacity")
            original = env.read_bytes()
            image = "sha256:" + "a" * 64
            with patch.object(capacity, "command", side_effect=[
                json.dumps({"NCPU": 64, "MemTotal": 128 * 1024**3}), json.dumps([{"Id": image}])]):
                capacity.apply_profile(env, Path(folder) / "previous.env", image)
            expanded = subprocess.run(["docker", "compose", "--env-file", str(env), "-f",
                str(self_hosted.COMPOSE), "--profile", "*", "config", "--format", "json"],
                capture_output=True, check=True, text=True)
            services = json.loads(expanded.stdout)["services"]
            renderer = services["renderer"]
            self.assertEqual(renderer["deploy"]["replicas"], 16)
            self.assertEqual(renderer["image"], image)
            self.assertEqual(renderer["environment"]["OPENBLAS_NUM_THREADS"], "1")
            self.assertEqual(services["rest"]["environment"]["PGRST_DB_POOL"], "48")
            self.assertEqual(services["auth"]["environment"]["GOTRUE_DB_MAX_IDLE_POOL_SIZE"], "20")
            self.assertEqual(services["auth"]["environment"]["GOTRUE_DB_CONN_MAX_LIFETIME"], "30m")
            self.assertIn("max_connections=240", services["db"]["command"])
            # 所有常驻服务CPU配额按副本数合计，主机保留超过20%余量。
            cpus = sum(float(v.get("cpus", 0)) * v.get("deploy", {}).get("replicas", 1)
                       for k, v in services.items() if k not in ("acceptance", "bootstrap", "resource-init"))
            self.assertLessEqual(cpus, 51.2)
            values = self_hosted.read_env(env)
            self.assertEqual(values["JWT_SECRET"], self_hosted.read_env(Path(folder) / "previous.env")["JWT_SECRET"])
            self.assertEqual(env.stat().st_mode & 0o777, 0o600)
            capacity.rollback(env, Path(folder) / "previous.env")
            self.assertEqual(env.read_bytes(), original)

    def test_smaller_host_rejected_before_config_mutation(self):
        with tempfile.TemporaryDirectory() as folder:
            env = self_hosted.configure(Path(folder), "https://shopro.test", project="shopro-capacity")
            original = env.read_bytes()
            with patch.object(capacity, "command", return_value=json.dumps({"NCPU": 16, "MemTotal": 64 * 1024**3})):
                with self.assertRaises(self_hosted.SelfHostError):
                    capacity.apply_profile(env, Path(folder) / "previous.env", "sha256:" + "a" * 64)
            self.assertEqual(env.read_bytes(), original)
            self.assertFalse((Path(folder) / "previous.env").exists())


if __name__ == "__main__":
    unittest.main()
