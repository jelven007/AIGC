"""为不同非root服务初始化独立卷；主机私钥继续留在0700实例目录。"""
import os
from pathlib import Path
import shutil


def directory(name, uid, gid):
    path = Path(name)
    path.mkdir(exist_ok=True)
    os.chown(path, uid, gid)
    path.chmod(0o755)
    return path


certs = directory("/certs", 101, 101)
for name in ("server.crt", "server.key", "ca.crt"):
    target = certs / name
    shutil.copyfile(Path("/tls-in") / name, target)
    os.chown(target, 101, 101)
    target.chmod(0o600 if name == "server.key" else 0o644)
secrets = directory("/secrets", 0, 10001)
for name in ("video_worker_secret", "render_worker_secret"):
    worker = secrets / name
    worker.write_text(os.environ[name.upper()])
    os.chown(worker, 0, 10001)
    worker.chmod(0o440)
directory("/media", 10001, 10001)
directory("/alerts", 65534, 10001)
print('{"runtime_volumes_ready":true}')
