"""Private initialization input must never be published or silently weakened."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))


class InitialAdminConfigTest(unittest.TestCase):
    def test_linux_root_install_assigns_private_seed_to_bootstrap_user(self):
        import initial_admin
        path = Path("/state/initial-admin.json")
        with patch("initial_admin.sys.platform", "linux"), patch("initial_admin.os.geteuid", return_value=0), \
                patch("initial_admin.os.chown") as chown:
            initial_admin.set_bootstrap_owner(path)
            chown.assert_called_once_with(path, 65534, 65534)
        with patch("initial_admin.sys.platform", "darwin"), patch("initial_admin.os.chown") as chown:
            initial_admin.set_bootstrap_owner(path)
            chown.assert_not_called()

    def test_private_input_is_required_and_permissions_checked(self):
        import initial_admin
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "identity.json"
            expected = {"username": "operator-fixture", "email": "operator@example.com",
                        "password": "fixture-password-9"}
            path.write_text(json.dumps(expected))
            path.chmod(0o600)
            self.assertEqual(initial_admin.read_initial_admin(path), expected)
            path.chmod(0o644)
            with self.assertRaises(initial_admin.InitialAdminError):
                initial_admin.read_initial_admin(path)
            path.unlink()
            with self.assertRaises(initial_admin.InitialAdminError):
                initial_admin.read_initial_admin(path)

    def test_rejects_symlinks_and_invalid_identity_without_echoing_input(self):
        import initial_admin
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "identity.json"
            path.write_text(json.dumps({"username": "operator-fixture",
                                        "email": "operator@example.com", "password": "x"}))
            path.chmod(0o600)
            with self.assertRaises(initial_admin.InitialAdminError) as error:
                initial_admin.read_initial_admin(path)
            self.assertNotIn("operator@example.com", str(error.exception))
            link = Path(directory) / "link.json"
            link.symlink_to(path)
            with self.assertRaises(initial_admin.InitialAdminError):
                initial_admin.read_initial_admin(link)


if __name__ == "__main__":
    unittest.main()
