"""真实旧库→最新发布事务与Auth/Storage/Edge/前端本地HTTP接受。"""
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]

if os.environ.get("ACCEPTANCE_TEST_INNER") != "true":
    import importlib.util
    import json
    spec = importlib.util.spec_from_file_location("deploy_acceptance", ROOT / "scripts/deploy_volcengine.py")
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)

    class DockerAcceptanceTest(unittest.TestCase):
        def test_real_upgrade_and_read_only_acceptance(self):
            suffix = uuid.uuid4().hex[:8]
            network, container = "acceptance-" + suffix, "acceptance-db-" + suffix
            subprocess.run(["docker", "network", "create", network], check=True, capture_output=True, timeout=30)
            self.addCleanup(lambda: subprocess.run(["docker", "network", "rm", network], capture_output=True, timeout=30))
            subprocess.run(["docker", "run", "-d", "--name", container, "--network", network, "--network-alias", "acceptance-db",
                            "-e", "POSTGRES_PASSWORD=isolated_acceptance_only", "postgres:16"],
                           check=True, capture_output=True, timeout=60)
            self.addCleanup(lambda: subprocess.run(["docker", "rm", "-f", container], capture_output=True, timeout=30))
            for _ in range(60):
                if subprocess.run(["docker", "exec", container, "pg_isready", "-t", "1"], capture_output=True, timeout=5).returncode == 0:
                    break
                time.sleep(0.25)
            else:
                self.fail("隔离数据库未就绪")
            with tempfile.TemporaryDirectory(dir=ROOT / ".volcengine-build") as directory:
                fixture = Path(directory)
                migrations = deploy.migration_files()
                (fixture / "baseline.sql").write_text(deploy.migration_sql([p for p in migrations if p.name < "00066_"]))
                (fixture / "upgrade.sql").write_text(deploy.migration_sql([p for p in migrations if p.name >= "00066_"]))
                (fixture / "release.json").write_text(json.dumps({"release": deploy.release_manifest(),
                    "migrations": [{"version": p.name.split("_")[0], "sha256": deploy.checksum(p)} for p in migrations]}))
                files = ["scripts/backup_restore.py", "tests/test_release_acceptance.py", "tests/db"]
                if (ROOT / "scripts/accept_release.py").exists():
                    files.append("scripts/accept_release.py")
                archive = subprocess.run(["tar", "--format=ustar", "--exclude=__pycache__", "-cf", "-", *files,
                    "-C", str(fixture), "baseline.sql", "upgrade.sql", "release.json"], cwd=ROOT,
                    capture_output=True, check=True, timeout=30).stdout
                result = subprocess.run(["docker", "run", "--rm", "-i", "--network", network, "--user", "0:0",
                    "-e", "ACCEPTANCE_TEST_INNER=true", "--entrypoint", "sh", "shoproai-backup:local",
                    "-c", "mkdir /tmp/workspace && tar -xf - -C /tmp/workspace && python /tmp/workspace/tests/test_release_acceptance.py"],
                    input=archive, capture_output=True, timeout=120)
                self.assertEqual(result.returncode, 0, result.stdout.decode() + result.stderr.decode())
                print(result.stdout.decode().strip())
                print(result.stderr.decode().strip())
else:
    import copy
    import http.server
    import json
    import sys
    import threading
    import psycopg
    sys.path.insert(0, str(ROOT / "scripts"))
    import backup_restore as backup
    try:
        import accept_release as acceptance
    except ModuleNotFoundError:
        acceptance = None

    class AcceptanceTest(unittest.TestCase):
        @classmethod
        def setUpClass(cls):
            cls.directory = Path("/tmp/workspace")
            def private(name, value):
                path = cls.directory / name
                path.write_text(value); path.chmod(0o600)
                return str(path)
            cls.config = {"environment": "isolated_fixture", "isolated": True,
                "database": {"host": "acceptance-db", "port": 5432, "dbname": "postgres", "user": "postgres",
                    "sslmode": "disable", "password_file": private("password", "isolated_acceptance_only")},
                "worker_secret_file": private("worker-secret", "isolated_worker_" + "a" * 32),
                "service_key_file": private("service-key", "isolated_service_" + "b" * 32)}
            cls.release = json.loads((cls.directory / "release.json").read_text())
            with psycopg.connect(**backup.pg_parameters(cls.config), autocommit=True) as connection:
                connection.execute((ROOT / "tests/db/bootstrap.sql").read_text())
                connection.execute((cls.directory / "baseline.sql").read_text())
                cls.user, cls.version = str(uuid.uuid4()), str(uuid.uuid4())
                connection.execute("INSERT INTO plans(name,price,credits,level) VALUES('免费版',0,100,0)")
                connection.execute("INSERT INTO auth.users(id,raw_app_meta_data) VALUES(%s,'{\"role\":\"admin\"}')", (cls.user,))
                connection.execute("SET request.jwt.claim.role='service_role'")
                cls.version = connection.execute("""SELECT save_model_config('video.SeedanceMini',NULL,
                    '{"name":"old","model":"old"}',true,'isolated_cipher',%s,true)""", (cls.user,)).fetchone()[0]
                cls.job = connection.execute("""SELECT create_video_job(%s,%s,'SeedanceMini',
                    '{"prompt":"原受理未知任务","duration":5,"resolution":"720P","ratio":"16:9"}',%s)""",
                    (cls.user, str(uuid.uuid4()), cls.version)).fetchone()[0]
                connection.execute("UPDATE video_jobs SET submission_state='unknown',status='processing' WHERE id=%s", (cls.job["id"],))
                connection.execute((cls.directory / "upgrade.sql").read_text())
            cls.bad_digest = False
            cls.public_bucket = False
            class Handler(http.server.BaseHTTPRequestHandler):
                def log_message(self, *_):
                    pass
                def reply(self, body):
                    data = json.dumps(body).encode()
                    self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers()
                    self.wfile.write(data)
                def do_POST(self):
                    body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                    if body != {"action": "probe"}:
                        self.send_error(400); return
                    self.reply({"ready": True, **cls.release["release"]["worker_contract"], "missing": [],
                        "source_sha256": "0" * 64 if cls.bad_digest else cls.release["release"]["source_sha256"]})
                def do_GET(self):
                    if self.path == "/auth/v1/settings":
                        self.reply({"external": {"email": True}})
                    elif self.path == "/storage/v1/bucket":
                        self.reply([{"id": "materials", "public": cls.public_bucket}])
                    elif self.path == "/release-identity.json":
                        self.reply({"source_sha256": cls.release["release"]["source_sha256"]})
                    else:
                        self.send_error(404)
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            cls.addClassCleanup(server.server_close)
            cls.addClassCleanup(server.shutdown)
            cls.config.update(backend_url=f"http://127.0.0.1:{server.server_port}",
                              frontend_url=f"http://127.0.0.1:{server.server_port}", private_buckets=["materials"])

        def test_a_old_uuid_unknown_and_charge_survive_real_upgrade(self):
            with psycopg.connect(**backup.pg_parameters(self.config)) as connection:
                row = connection.execute("SELECT submission_state,charge_id,model_config_version_id FROM video_jobs WHERE id=%s", (self.job["id"],)).fetchone()
                self.assertEqual(row[0], "unknown")
                self.assertEqual(str(row[1]), self.job["charge_id"])
                self.assertEqual(str(row[2]), str(self.version))
                self.assertEqual(connection.execute("SELECT count(*) FROM shopro_deploy.schema_migrations").fetchone()[0], len(self.release["migrations"]))
                self.assertEqual(connection.execute("SELECT count(*) FROM credit_logs WHERE user_id=%s AND amount<0", (self.user,)).fetchone()[0], 1)

        def test_b_cli_verifies_matching_stack_without_business_writes(self):
            self.assertIsNotNone(acceptance, "read-only release acceptance implementation missing")
            config = self.directory / "acceptance-config.json"
            config.write_text(json.dumps(self.config)); config.chmod(0o600)
            result = subprocess.run([sys.executable, str(ROOT / "scripts/accept_release.py"), "--config", str(config),
                "--release", str(self.directory / "release.json"), "--output", str(self.directory / "acceptance-receipt.json")],
                capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            receipt = json.loads(result.stdout)
            self.assertTrue(receipt["technical_ready"])
            self.assertEqual(receipt["environment"], "isolated_fixture")
            self.assertFalse(receipt["production_accepted"])
            print(json.dumps(receipt))

        def test_c_mismatched_sources_public_storage_and_ledger_fail_acceptance(self):
            self.assertIsNotNone(acceptance, "read-only release acceptance implementation missing")
            type(self).bad_digest = True
            try:
                self.assertFalse(acceptance.collect(self.config, self.release)["technical_ready"])
            finally:
                type(self).bad_digest = False
            type(self).public_bucket = True
            try:
                self.assertFalse(acceptance.collect(self.config, self.release)["technical_ready"])
            finally:
                type(self).public_bucket = False
            wrong = copy.deepcopy(self.release)
            wrong["migrations"][-1]["sha256"] = "0" * 64
            self.assertFalse(acceptance.collect(self.config, wrong)["technical_ready"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
