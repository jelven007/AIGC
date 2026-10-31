"""官方发布拒绝错目标/原账漂移；真实PG验证并发账变更会回滚整批迁移。"""
from datetime import datetime, timedelta, timezone
import json
import hashlib
import io
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy_supabase as deploy
import production_runtime as runtime


def snapshot(files):
    return {"shape": {"tracked": True, "initialized": True},
            "ledger": [{"version": p.name.split("_")[0], "name": p.name, "sha256": deploy.checksum(p)} for p in files]}


class OfficialDeploymentTest(unittest.TestCase):
    def test_target_cannot_switch_to_another_provider_or_ref(self):
        ref = "a" * 20
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "target.local"
            config.write_text(f"SUPABASE_PROJECT_REF={ref}\nSUPABASE_URL=https://different.supabase.co\n")
            config.chmod(0o600)
            with self.assertRaisesRegex(deploy.DeployError, "同一个官方"):
                deploy.target_config(config)
            config.write_text(f"SUPABASE_PROJECT_REF={ref}\nSUPABASE_URL=https://{ref}.supabase.co\n")
            config.chmod(0o644)
            with self.assertRaisesRegex(deploy.DeployError, "chmod 600"):
                deploy.target_config(config)

    def test_old_untracked_official_database_is_never_replayed(self):
        old = {"shape": {"tracked": False, "initialized": True},
               "ledger": [], "official_history": [{"version": "00031"}]}
        with self.assertRaisesRegex(deploy.DeployError, "禁止从00001"):
            deploy.pending_migrations(old)

    def test_drift_unknown_and_gaps_are_rejected(self):
        files = deploy.migration_files()
        for mutate in ("digest", "unknown", "gap"):
            state = snapshot(files[:3])
            if mutate == "digest":
                state["ledger"][0]["sha256"] = "0" * 64
            elif mutate == "unknown":
                state["ledger"][0]["version"] = "99999"
            else:
                state["ledger"].pop(1)
            with self.subTest(mutate=mutate), self.assertRaises(deploy.DeployError):
                deploy.pending_migrations(state)
        self.assertEqual(deploy.pending_migrations(snapshot(files)), [])

    def test_runtime_refuses_fixture_stale_incomplete_and_other_target_receipts(self):
        ref = "a" * 20
        now = datetime.now(timezone.utc)
        receipt = {"captured_at": now.timestamp(), "technical_ready": True, "isolated": False,
                   "environment": f"official-supabase-{ref}", "source_sha256": "b" * 64,
                   "checks": {name: True for name in ("release_manifest", "database", "worker",
                              "auth_settings", "private_storage", "frontend")}}
        values = {"SUPABASE_URL": f"https://{ref}.supabase.co"}
        manifest = {"release": {"source_sha256": "b" * 64}}
        runtime.check_acceptance(receipt, values, manifest, now=now)
        for key, value in (("isolated", True), ("environment", "fixture"),
                           ("source_sha256", "c" * 64), ("captured_at", (now - timedelta(days=2)).timestamp()),
                           ("checks", {"database": True})):
            with self.subTest(key=key), self.assertRaises(deploy.DeployError):
                runtime.check_acceptance({**receipt, key: value}, values, manifest, now=now)

    def test_unsafe_receipt_cannot_start_compose(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "runtime.env"
            config.write_text(f"RELEASE_DIR={directory}\n"); config.chmod(0o600)
            with patch.object(sys, "argv", ["runtime", "start", "--env-file", str(config)]), \
                    patch.object(runtime, "verify_bundle", side_effect=deploy.DeployError("bad bundle")), \
                    patch.object(runtime.subprocess, "run") as command:
                with self.assertRaises(deploy.DeployError):
                    runtime.main()
                command.assert_not_called()

    def test_archived_frontend_is_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = root / "site"; site.mkdir()
            page = site / "index.html"; page.write_text("same source")
            deploy.deterministic_zip(site, root / "first.zip")
            page.touch()
            deploy.deterministic_zip(site, root / "second.zip")
            self.assertEqual(deploy.checksum(root / "first.zip"), deploy.checksum(root / "second.zip"))

    def test_cloud_uses_verified_archive_and_rejects_source_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = b"release snapshot"
            expected = {"scripts/example.py": hashlib.sha256(data).hexdigest()}
            for tampered in (False, True):
                payload = b"changed after build" if tampered else data
                with tarfile.open(root / "source.tar.gz", "w:gz") as archive:
                    item = tarfile.TarInfo("scripts/example.py")
                    item.size = len(payload)
                    archive.addfile(item, io.BytesIO(payload))
                if tampered:
                    with self.assertRaisesRegex(deploy.DeployError, "归档源码"):
                        with deploy.verified_source_snapshot(root, {"release": {"files": expected}}):
                            self.fail("不应接受漂移归档")
                else:
                    with deploy.verified_source_snapshot(root, {"release": {"files": expected}}) as source:
                        self.assertEqual((source / "scripts/example.py").read_bytes(), data)


class RealMigrationGuardTest(unittest.TestCase):
    def setUp(self):
        self.name = "shopro-migration-guard-" + uuid.uuid4().hex[:8]
        subprocess.run(["docker", "run", "-d", "--name", self.name, "--network", "none",
                        "-e", "POSTGRES_PASSWORD=isolated_fixture_only", "postgres:16"],
                       check=True, capture_output=True, timeout=60)
        self.addCleanup(lambda: subprocess.run(["docker", "rm", "-f", self.name], capture_output=True, timeout=30))
        for _ in range(40):
            if subprocess.run(["docker", "exec", self.name, "pg_isready", "-h", "127.0.0.1", "-t", "1"],
                              capture_output=True, timeout=5).returncode == 0:
                break
            time.sleep(0.25)
        else:
            self.fail("隔离PG未就绪")
        self.files = deploy.migration_files()
        self.baseline = [p for p in self.files if p.name < "00066_"]
        self.upgrade = [p for p in self.files if p.name >= "00066_"]
        initial = self.sql((ROOT / "tests/db/bootstrap.sql").read_text() + deploy.migration_sql(self.baseline))
        self.assertEqual(initial.returncode, 0, initial.stderr[-2000:])

    def sql(self, statement):
        return subprocess.run(["docker", "exec", "-i", self.name, "psql", "-h", "127.0.0.1", "-U", "postgres",
                               "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
                              input=statement, text=True, capture_output=True, timeout=60)

    def test_verified_baseline_appends_three_migrations_in_one_transaction(self):
        result = self.sql(deploy.guarded_migration_sql(snapshot(self.baseline), self.upgrade))
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])
        self.assertEqual(self.sql("SELECT count(*) FROM shopro_deploy.schema_migrations;").stdout.strip(), "66")

    def test_concurrent_ledger_change_prevents_every_pending_migration(self):
        state = snapshot(self.baseline)
        self.assertEqual(self.sql("UPDATE shopro_deploy.schema_migrations SET sha256=repeat('0',64) WHERE version='00065';").returncode, 0)
        result = self.sql(deploy.guarded_migration_sql(state, self.upgrade))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("migration ledger changed", result.stderr)
        self.assertEqual(self.sql("SELECT count(*) FROM shopro_deploy.schema_migrations;").stdout.strip(), "63")
        self.assertEqual(self.sql("SELECT count(*) FROM shopro_deploy.schema_migrations WHERE version>='00066';").stdout.strip(), "0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
