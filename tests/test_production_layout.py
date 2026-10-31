"""生产目录迁移门禁：真实源码、构建入口和交付清单必须指向同一布局。"""
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import deploy_volcengine as deploy


class ProductionLayoutTest(unittest.TestCase):
    def test_production_boundaries_have_real_entrypoints(self):
        for name in (
            "apps/web/src/App.tsx", "apps/web/public/runtime-config.js", "apps/web/index.html",
            "services/media-worker/main.py", "services/media-worker/Dockerfile",
            "services/mcp/http_server.py", "services/mcp/tools.json",
            "infra/self-hosted/compose.yaml", "supabase/functions", "supabase/migrations",
        ):
            with self.subTest(path=name):
                self.assertTrue((ROOT / name).exists(), name)
        for name in ("src", "public", "worker", "mcp", "deploy", "clipforge"):
            self.assertFalse((ROOT / name).exists(), name)

    def test_release_fingerprint_covers_migrated_runtime_and_build_inputs(self):
        manifest = deploy.release_manifest()
        for name in (
            "apps/web/src/App.tsx", "apps/web/index.html", "apps/web/public/runtime-config.js",
            "services/media-worker/main.py", "services/media-worker/requirements.lock",
            "services/mcp/http_server.py", "services/mcp/requirements.lock",
            "infra/self-hosted/compose.yaml", "infra/backup/requirements.lock",
            "vite.config.mjs", "tailwind.config.js", "scripts/build_frontend.mjs",
        ):
            with self.subTest(path=name):
                self.assertTrue(name in manifest["files"], name)
        self.assertFalse(any(name.startswith(("src/", "public/", "worker/", "mcp/", "deploy/"))
                             for name in manifest["files"]))

    def test_typecheck_and_component_generation_target_web_app(self):
        config = json.loads((ROOT / "tsconfig.check.json").read_text())
        self.assertEqual(config["include"], ["./apps/web/src"])
        self.assertEqual(config["compilerOptions"]["paths"]["@/*"], ["./apps/web/src/*"])
        components = json.loads((ROOT / "components.json").read_text())
        self.assertEqual(components["tailwind"]["css"], "apps/web/src/index.css")


if __name__ == "__main__":
    unittest.main(verbosity=2)
