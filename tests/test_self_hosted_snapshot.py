"""真实恢复控制流的状态覆盖、旧快照兼容及停机前布局保护。"""
from contextlib import ExitStack
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import self_hosted
import self_hosted_snapshot as snapshot


class SnapshotStateTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state, self.target = self.root / "source", self.root / "restored"
        self_hosted.configure(self.state, "https://snapshot.test", project="snapshot-source")
        self.identity = {"username": "snapshot-user", "email": "snapshot@example.com",
                         "password": "isolated-snapshot-input"}
        for name, value in (
            ("initial-admin.json", self.identity),
            ("login-identity.json", {key: self.identity[key] for key in ("username", "email")}),
        ):
            path = self.state / name
            path.write_text(json.dumps(value))
            path.chmod(0o600)
        (self.state / "fixtures").mkdir()
        (self.state / "fixtures" / "original.mp4").write_bytes(b"isolated-media")
        self.artifact = self.root / "artifact"
        self.artifact.mkdir()
        self.manifest = {"format": 1, "project": "snapshot-source", "cold_consistent": True,
            "files": {name: {"fixture": name} for name in (*snapshot.DATA_VOLUMES, "state")}}
        (self.artifact / "manifest.json").write_text(json.dumps(self.manifest))
        self.key = self.root / "key"
        self.key.write_text("00" * 32)
        self.key.chmod(0o600)
        self.commands = []

    def restore(self, **options):
        def helper(values, key, artifact, data, action, name):
            if name == "state":
                shutil.copytree(self.state, Path(data), dirs_exist_ok=True, symlinks=True)
            return self.manifest["files"][name]
        with ExitStack() as stack:
            stack.enter_context(patch.object(snapshot, "helper", side_effect=helper))
            stack.enter_context(patch.object(snapshot, "command",
                side_effect=lambda args, **kwargs: self.commands.append(args) or ""))
            stack.enter_context(patch.object(snapshot.subprocess, "run",
                return_value=subprocess.CompletedProcess([], 1)))
            stack.enter_context(patch.object(snapshot, "tls"))
            return snapshot.restore(self.state, self.key, self.artifact, self.target,
                "snapshot-restored", "https://snapshot.test", "172.31.240.0/24", **options)

    def test_restores_required_private_identity_files_and_media_fixtures(self):
        self.restore()
        for name in ("initial-admin.json", "login-identity.json"):
            path = self.target / name
            self.assertTrue(path.is_file(), name)
            self.assertEqual(path.read_bytes(), (self.state / name).read_bytes())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.target / "fixtures/original.mp4").read_bytes(), b"isolated-media")
        values = self_hosted.read_env(self.target / "runtime.env")
        original = self_hosted.read_env(self.state / "runtime.env")
        for name in ("JWT_SECRET", "POSTGRES_PASSWORD", "MODEL_KEYRING"):
            self.assertEqual(values[name], original[name])

    def test_missing_legacy_initialization_requires_explicit_private_input_before_new_volumes(self):
        (self.state / "initial-admin.json").unlink()
        (self.state / "login-identity.json").unlink()
        with self.assertRaises(self_hosted.SelfHostError):
            self.restore()
        self.assertFalse(self.target.exists())
        self.assertFalse(any(args[:3] == ["docker", "volume", "create"] for args in self.commands))

    def test_legacy_snapshot_accepts_explicit_private_identity_without_resetting_database(self):
        (self.state / "initial-admin.json").unlink()
        (self.state / "login-identity.json").unlink()
        supplied = self.root / "private-input.json"
        supplied.write_text(json.dumps(self.identity))
        supplied.chmod(0o600)
        self.restore(initial_admin_file=supplied)
        self.assertEqual(json.loads((self.target / "initial-admin.json").read_text()), self.identity)
        self.assertEqual(json.loads((self.target / "login-identity.json").read_text()),
            {key: self.identity[key] for key in ("username", "email")})

    def test_private_identity_permissions_and_mapping_are_checked_before_creating_target(self):
        (self.state / "initial-admin.json").chmod(0o644)
        with self.assertRaises(self_hosted.SelfHostError):
            self.restore()
        self.assertFalse(self.target.exists())

    def test_missing_login_mapping_is_derived_from_snapshot_identity(self):
        (self.state / "login-identity.json").unlink()
        self.restore()
        self.assertEqual(json.loads((self.target / "login-identity.json").read_text()),
            {key: self.identity[key] for key in ("username", "email")})

    def test_mismatched_login_mapping_does_not_create_target_or_reset_identity(self):
        path = self.state / "login-identity.json"
        path.write_text(json.dumps({"username": "other-user", "email": "other@example.com"}))
        with self.assertRaises(self_hosted.SelfHostError):
            self.restore()
        self.assertFalse(self.target.exists())

    def test_identity_symlink_is_rejected_even_when_target_has_private_permissions(self):
        path = self.state / "initial-admin.json"
        private = self.root / "private.json"
        path.rename(private)
        path.symlink_to(private)
        with self.assertRaises(self_hosted.SelfHostError):
            self.restore()
        self.assertFalse(self.target.exists())


class ComposeLayoutTest(unittest.TestCase):
    def test_compose_uses_target_source_layout_instead_of_calling_script_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for layout in ("infra", "deploy"):
                source = root / layout
                compose = source / layout / "self-hosted/compose.yaml"
                compose.parent.mkdir(parents=True)
                compose.write_text("services: {}")
                env = root / (layout + ".env")
                env.write_text("SOURCE_DIR=" + str(source) + "\n")
                env.chmod(0o600)
                with patch.object(self_hosted, "command", return_value="") as command:
                    self_hosted.compose(env, ["ps"])
                args = command.call_args.args[0]
                self.assertEqual(args[args.index("-f") + 1], str(compose))

    def test_missing_target_layout_is_rejected_without_docker_command(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "runtime.env"
            env.write_text("SOURCE_DIR=" + directory + "\n")
            env.chmod(0o600)
            with patch.object(self_hosted, "command") as command:
                with self.assertRaises(self_hosted.SelfHostError):
                    self_hosted.compose(env, ["--profile", "execution", "stop"])
                command.assert_not_called()

    def test_backup_config_failure_never_stops_instance_or_creates_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            self_hosted.configure(state, "https://snapshot.test", project="snapshot-source")
            key = root / "key"
            key.write_text("00" * 32)
            key.chmod(0o600)
            output = root / "new-snapshot"
            with patch.object(snapshot, "compose_file"), patch.object(snapshot, "compose",
                side_effect=self_hosted.SelfHostError("incompatible mounts")) as compose:
                with self.assertRaises(self_hosted.SelfHostError):
                    snapshot.backup(state, key, output)
                self.assertEqual(compose.call_args.args[1], ["--profile", "execution", "config", "--quiet"])
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
