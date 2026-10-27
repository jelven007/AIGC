"""发布前核对真实源码、权威锁与全栈协议，不连接外部资源。"""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("deploy", ROOT / "scripts/deploy_volcengine.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class ReleaseManifestTest(unittest.TestCase):
    def test_manifest_covers_real_runtime_sources_and_locks(self):
        manifest = deploy.release_manifest()
        self.assertRegex(manifest["git_sha"], r"^[0-9a-f]{40}$")
        for name in ("pnpm-lock.yaml", "package.json", "supabase/functions/deno.lock",
                     "mcp/requirements_mcp.txt", "worker/Dockerfile", "mcp/requirements.lock",
                     "worker/requirements.lock", "deploy/backup/requirements.lock", "docs/ai/evaluation-v1.json"):
            self.assertRegex(manifest["files"][name], r"^[0-9a-f]{64}$")
        self.assertIn("supabase/functions/_shared/text-provider.ts", manifest["files"])
        self.assertIn("src/App.tsx", manifest["files"])
        self.assertNotIn("package-lock.json", manifest["files"])
        self.assertEqual(set(manifest["functions"]), {
            item["name"] for item in json.loads(deploy.MANIFEST.read_text())["functions"]})
        self.assertGreater(manifest["mcp"]["tool_count"], 0)
        self.assertEqual(manifest["protocols"], {"render": 4, "edit": 2})
        self.assertEqual(manifest["worker_contract"]["required_migration"], "00068")
        self.assertIn("deploy/video-scheduler/compose.yaml", manifest["files"])

    def test_frontend_identity_binds_full_source_without_private_manifest(self):
        release = deploy.release_manifest()
        with tempfile.TemporaryDirectory() as directory:
            deploy.write_frontend_identity(Path(directory), release)
            identity = json.loads((Path(directory) / "release-identity.json").read_text())
            self.assertEqual(identity["source_sha256"], release["source_sha256"])
            self.assertEqual(identity["worker_contract"], release["worker_contract"])
            self.assertNotIn("files", identity)

    def test_source_drift_blocks_cloud_call(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "manifest.json").write_text(json.dumps({
                "release": {"git_sha": "0" * 40, "source_sha256": "0" * 64}}))
            with patch.object(deploy, "OUTPUT", root), patch.object(deploy, "cli") as cli:
                with self.assertRaisesRegex(RuntimeError, "源码"):
                    deploy.check_release_receipt()
                cli.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
