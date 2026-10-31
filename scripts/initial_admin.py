"""Read operator-provided initialization secrets from a private, external file."""
import json
import os
from pathlib import Path
import re
import sys


class InitialAdminError(RuntimeError):
    pass


def set_bootstrap_owner(path):
    """The pinned backup/bootstrap image runs as nobody on Linux."""
    if sys.platform == "linux" and os.geteuid() == 0:
        os.chown(path, 65534, 65534)


def read_initial_admin(path=None):
    path = Path(path or os.environ.get("SELF_HOSTED_INITIAL_ADMIN_FILE",
                                      "/run/bootstrap/initial-admin.json"))
    try:
        if not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o077:
            raise ValueError()
        value = json.loads(path.read_text())
        if (not isinstance(value, dict) or set(value) != {"username", "email", "password"}
                or not all(isinstance(x, str) for x in value.values())
                or not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", value["username"])
                or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value["email"])
                or not 8 <= len(value["password"]) <= 256):
            raise ValueError()
        return value
    except (OSError, ValueError, TypeError):
        raise InitialAdminError("初始化需要有效的普通0600私有账号文件") from None
