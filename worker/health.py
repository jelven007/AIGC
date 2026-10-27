"""健康文件不包含签名、密钥或用户正文，停止与过期状态均不就绪。"""
import json
import os
from pathlib import Path
import time


class WorkerHealth:
    def __init__(self, path):
        self.path = Path(path)

    def write(self, status, job=None):
        value = {"status": status, "updated_at": time.time(), "pid": os.getpid()}
        if job:
            value["job_id"] = job["id"]
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value), encoding="utf-8")
        temporary.chmod(0o600)
        temporary.replace(self.path)

    def healthy(self):
        try:
            value = json.loads(self.path.read_text())
            age = time.time() - value["updated_at"]
            return value["status"] in ("idle", "active", "recovering") and 0 <= age < 90
        except (OSError, ValueError, KeyError, TypeError):
            return False
