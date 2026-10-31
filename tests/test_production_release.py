"""Production identity and non-destructive upgrade regressions."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import self_hosted
import self_hosted_release


class ProductionReleaseTest(unittest.TestCase):
    def test_upgrade_preserves_original_identity_and_capacity(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            state.chmod(0o700)
            env = state / "runtime.env"
            original = {"COMPOSE_PROJECT_NAME": "original", "JWT_SECRET": "original-secret",
                        "STATE_DIR": str(state), "SOURCE_DIR": "/old/source",
                        "RENDERER_REPLICAS": "16", "DB_MAX_CONNECTIONS": "240",
                        "PUBLIC_ORIGIN": "https://example.com"}
            self_hosted.write_private(env, "".join(f"{k}={v}\n" for k, v in original.items()))
            self.assertTrue(hasattr(self_hosted, "upgrade_environment"), "Missing supported upgrade entry")
            new = self_hosted.upgrade_environment(env, Path("/new/source"),
                [{"env": "RENDERER_IMAGE", "id": "sha256:" + "a" * 64}])
            for key in original:
                if key != "SOURCE_DIR":
                    self.assertEqual(new[key], original[key])
            self.assertEqual(new["SOURCE_DIR"], "/new/source")
            self.assertEqual(new["RENDERER_IMAGE"], "sha256:" + "a" * 64)
            self.assertTrue((state / "receipts/upgrade-runtime.env").is_file())

    def test_manifest_rejects_unlisted_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "payload").write_text("checked")
            (root / "release-manifest.json").write_text(json.dumps({
                "format": 1, "images": [{"platform": "linux/arm64"}],
                "files": {"payload": self_hosted_release.digest(root / "payload")}}))
            (root / "unlisted.py").write_text("unexpected code")
            with self.assertRaises(self_hosted.SelfHostError):
                self_hosted_release.verify(root)

    def test_public_identity_includes_version_and_source(self):
        import deploy_volcengine
        manifest = deploy_volcengine.release_manifest()
        self.assertIn("version", manifest)
        with tempfile.TemporaryDirectory() as directory:
            deploy_volcengine.write_frontend_identity(Path(directory), manifest)
            value = json.loads((Path(directory) / "release-identity.json").read_text())
            self.assertEqual(value["version"], manifest["version"])
            self.assertEqual(value["source_sha256"], manifest["source_sha256"])

    def test_runtime_templates_and_bundled_model_are_bound_to_source(self):
        import deploy_volcengine
        files = deploy_volcengine.release_manifest()["files"]
        for name in ("deploy/self-hosted/nginx.conf.template", "worker/model-assets/person.onnx",
                     "deploy/self-hosted/edge-dependencies/package-lock.json", "docs/lifecycle.json"):
            self.assertIn(name, files)


if __name__ == "__main__":
    unittest.main()
