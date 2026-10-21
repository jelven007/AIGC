"""部署迁移、回执和目标配置回归；不连接火山生产资源。"""
import importlib.util
import base64
import json
from pathlib import Path
import subprocess
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("deploy", ROOT / "scripts/deploy_volcengine.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeployTest(unittest.TestCase):
    def test_bootstrap_has_one_transaction_and_no_demo_resources(self):
        source = deploy.migration_sql(deploy.migration_files())
        self.assertEqual(source.count("\nBEGIN;"), 1)
        self.assertEqual(source.count("\nCOMMIT;"), 1)
        self.assertNotIn("00018_insert_demo", source)
        self.assertNotRegex(source, r"(?i)CREATE\s+POLICY\s+allow_read_demo_products")
        self.assertIn("ArkSeedance", source)
        self.assertIn("pg_advisory_xact_lock", source)

    def test_existing_untracked_database_is_rejected(self):
        with patch.object(deploy, "query", return_value=[{"tracked": False, "initialized": True}]):
            with self.assertRaisesRegex(RuntimeError, "无部署回执"):
                deploy.migrate(SimpleNamespace())

    def test_modified_migration_is_rejected(self):
        file = deploy.migration_files()[0]
        version = file.name.split("_", 1)[0]
        with patch.object(deploy, "query", side_effect=[
            [{"tracked": True, "initialized": True}],
            [{"version": version, "sha256": "modified"}],
        ]):
            with self.assertRaisesRegex(RuntimeError, "校验值变更"):
                deploy.migrate(SimpleNamespace())

    def test_successful_migrations_are_not_replayed(self):
        ledger = [{"version": p.name.split("_", 1)[0], "sha256": deploy.checksum(p)}
                  for p in deploy.migration_files()]
        with patch.object(deploy, "query", side_effect=[
            [{"tracked": True, "initialized": True}], ledger, ledger,
        ]), patch.object(deploy, "cli") as cli:
            deploy.migrate(SimpleNamespace())
            cli.assert_not_called()

    def test_pages_rejects_config_or_archive_drift_before_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "frontend.zip").write_bytes(b"archive")
            (root / "anon").write_text("sb_publishable_local")
            (root / "manifest.json").write_text(json.dumps({"frontend": {"backend_url": "https://other.example"}}))
            args = SimpleNamespace(pages_project_id="page", backend_url="https://target.example",
                                   anon_key_file=root / "anon")
            with patch.object(deploy, "OUTPUT", root), patch.object(deploy, "cli") as cli:
                with self.assertRaisesRegex(RuntimeError, "构建配置"):
                    deploy.pages(args)
                cli.assert_not_called()

    def test_function_jwt_exceptions_are_explicit(self):
        functions = json.loads(deploy.MANIFEST.read_text())["functions"]
        public = {item["name"] for item in functions if not item["verify_jwt"]}
        self.assertEqual(public, {"video-job-worker", "production-worker", "platform-oauth-callback",
                                  "wechat-payment-webhook", "alipay-payment-notify", "text-generation",
                                  "video-jobs", "batch-video-jobs", "production-jobs", "platform-publish",
                                  "platform-accounts", "measurements", "knowledge-base",
                                  "market-intelligence", "product-management", "operations", "measurement-ingest"})

    def test_service_role_cannot_be_packaged_as_anon_key(self):
        with tempfile.TemporaryDirectory() as directory:
            key_file = Path(directory) / "key"
            encoded = base64.urlsafe_b64encode(b'{"role":"service_role"}').decode().rstrip("=")
            key_file.write_text(f"header.{encoded}.signature")
            with self.assertRaisesRegex(ValueError, "service_role"):
                deploy.public_config(SimpleNamespace(backend_url="https://target.example", anon_key_file=key_file))

    def test_cli_rows_formats(self):
        self.assertEqual(deploy.rows({"data": [{"rows": [{"tracked": True}]}]}), [{"tracked": True}])
        self.assertEqual(deploy.rows([]), [])

    def test_bootstrap_executes_as_one_real_database_transaction(self):
        container = f"shoproai-deploy-{uuid.uuid4().hex[:8]}"
        subprocess.run(["docker", "run", "-d", "--name", container,
                        "-e", "POSTGRES_PASSWORD=local_test", "postgres:16"],
                       check=True, capture_output=True, timeout=60)
        self.addCleanup(lambda: subprocess.run(["docker", "rm", "-f", container],
                                              capture_output=True, timeout=30))
        for _ in range(60):
            ready = subprocess.run(["docker", "exec", container, "pg_isready", "-h", "127.0.0.1", "-t", "1"],
                                   capture_output=True, timeout=5)
            if ready.returncode == 0:
                break
            time.sleep(0.25)
        else:
            self.fail("测试 PostgreSQL 未就绪")
        command = ["docker", "exec", "-i", container, "psql", "-U", "postgres",
                   "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]
        bootstrap = (ROOT / "tests/db/bootstrap.sql").read_text()
        source = bootstrap + deploy.migration_sql(deploy.migration_files())
        result = subprocess.run(command, input=source, text=True, capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run(command, input=f"SELECT count(*) FROM {deploy.LEDGER};",
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(int(result.stdout.strip()), len(deploy.migration_files()))
        result = subprocess.run(command, input="SELECT count(*) FROM profiles;",
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.stdout.strip(), "0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
