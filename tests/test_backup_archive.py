"""真实本地归档网关上传/拉回、回执未知与恶意归档拒绝。"""
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]

if os.environ.get("ARCHIVE_TEST_INNER") != "true":
    class DockerArchiveTest(unittest.TestCase):
        def test_real_archive_protocol(self):
            files = ["scripts/backup_restore.py", "tests/test_backup_archive.py"]
            if (ROOT / "scripts/backup_archive.py").exists():
                files.append("scripts/backup_archive.py")
            archive = subprocess.run(["tar", "--format=ustar", "--exclude=__pycache__", "-cf", "-", *files],
                                     cwd=ROOT, capture_output=True, check=True, timeout=30).stdout
            result = subprocess.run(["docker", "run", "--rm", "-i", "--network", "none", "--user", "0:0",
                                     "-e", "ARCHIVE_TEST_INNER=true", "--entrypoint", "sh", "shoproai-backup:local",
                                     "-c", "mkdir /tmp/workspace && tar -xf - -C /tmp/workspace && python /tmp/workspace/tests/test_backup_archive.py"],
                                    input=archive, capture_output=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout.decode() + result.stderr.decode())
            print(result.stderr.decode().strip())
else:
    import hashlib
    import http.server
    import io
    import json
    import sys
    import tarfile
    import tempfile
    import threading
    import uuid
    sys.path.insert(0, str(ROOT / "scripts"))
    import backup_restore as backup
    try:
        import backup_archive as archiver
    except ModuleNotFoundError:
        archiver = None

    class ArchiveTest(unittest.TestCase):
        def setUp(self):
            self.directory = tempfile.TemporaryDirectory()
            self.addCleanup(self.directory.cleanup)
            self.root = Path(self.directory.name)
            self.artifact = self.root / "artifact"
            self.artifact.mkdir()
            self.key = b"a" * 32
            self.identifier = str(uuid.uuid4())
            plain = self.root / "plain"
            plain.write_bytes(b"isolated fake SQL dump, encrypted before upload")
            meta = backup.encrypt_file(plain, self.artifact / "database.dump.enc", self.key, "database.dump.enc")
            manifest = {"format": 1, "id": self.identifier, "storage_mapping_verified": True,
                        "files": [{"path": "database.dump.enc", **meta}], "objects": [], "secrets": []}
            plain.write_text(json.dumps(manifest))
            backup.encrypt_file(plain, self.artifact / "manifest.enc", self.key, "manifest.enc")
            self.receipt = self.root / "archive-receipt.json"
            self.objects = {}
            self.requests = []
            self.wrong_ack = False
            outer = self
            class Handler(http.server.BaseHTTPRequestHandler):
                def log_message(self, *_):
                    pass
                def do_PUT(self):
                    data = self.rfile.read(int(self.headers["Content-Length"]))
                    outer.objects[self.path] = data
                    outer.requests.append((self.path, dict(self.headers)))
                    self.send_response(200); self.end_headers()
                    answer = {"accepted": True, "backup_id": outer.identifier,
                              "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
                    if outer.wrong_ack:
                        answer["backup_id"] = str(uuid.uuid4())
                    self.wfile.write(json.dumps(answer).encode())
                def do_GET(self):
                    data = outer.objects[self.path]
                    self.send_response(200); self.end_headers()
                    self.wfile.write(data)
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
            secret = self.root / "token"
            secret.write_text("isolated_archive_secret"); secret.chmod(0o600)
            self.config = {"isolated": True, "archive": {"url": f"http://127.0.0.1:{server.server_port}",
                                                       "secret_file": str(secret)}}

        def test_real_upload_pull_and_original_encrypted_manifest(self):
            self.assertIsNotNone(archiver, "encrypted archive transfer implementation missing")
            receipt = archiver.upload(self.config, self.key, self.artifact, self.receipt)
            self.assertEqual(receipt["backup_id"], self.identifier)
            self.assertEqual(self.requests[0][1]["Idempotency-Key"], self.identifier + ":" + receipt["sha256"])
            self.assertNotIn("isolated fake SQL", next(iter(self.objects.values())).decode("latin1"))
            output = self.root / "pulled"
            result = archiver.pull(self.config, self.key, self.receipt, output)
            self.assertEqual(result["backup_id"], self.identifier)
            self.assertEqual((output / "manifest.enc").read_bytes(), (self.artifact / "manifest.enc").read_bytes())
            self.assertEqual(self.receipt.stat().st_mode & 0o777, 0o600)

        def test_unknown_ack_keeps_idempotent_object_without_success_receipt(self):
            self.assertIsNotNone(archiver, "encrypted archive transfer implementation missing")
            self.wrong_ack = True
            with self.assertRaises(backup.BackupError):
                archiver.upload(self.config, self.key, self.artifact, self.receipt)
            self.assertFalse(self.receipt.exists())
            self.wrong_ack = False
            archiver.upload(self.config, self.key, self.artifact, self.receipt)
            self.assertEqual(len(self.objects), 1)
            self.assertEqual(self.requests[0][1]["Idempotency-Key"], self.requests[1][1]["Idempotency-Key"])

        def test_corrupted_or_symlink_archive_is_rejected_before_output(self):
            self.assertIsNotNone(archiver, "encrypted archive transfer implementation missing")
            receipt = archiver.upload(self.config, self.key, self.artifact, self.receipt)
            path = next(iter(self.objects))
            self.objects[path] = b"corrupted"
            output = self.root / "invalid"
            with self.assertRaises(backup.BackupError):
                archiver.pull(self.config, self.key, self.receipt, output)
            self.assertFalse(output.exists())
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode="w") as archive:
                item = tarfile.TarInfo("manifest.enc")
                item.type = tarfile.SYMTYPE
                item.linkname = "/etc/passwd"
                archive.addfile(item)
            self.objects[path] = data.getvalue()
            receipt.update(size=len(data.getvalue()), sha256=hashlib.sha256(data.getvalue()).hexdigest())
            receipt["object_key"] = f"backups/{receipt['backup_id']}/{receipt['sha256']}.tar"
            self.objects["/" + receipt["object_key"]] = data.getvalue()
            self.receipt.write_text(json.dumps(receipt))
            with self.assertRaises(backup.BackupError):
                archiver.pull(self.config, self.key, self.receipt, output)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
