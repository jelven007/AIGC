"""单任务素材缓存与磁盘预算；缓存不跨账号、任务或租约共享。"""
from contextlib import contextmanager
import fcntl
import hashlib
import os
from pathlib import Path
from shutil import disk_usage, rmtree
import time
from urllib.parse import urlsplit
import requests
from render import RenderError

MIB = 1024 * 1024


class RetryableError(RenderError):
    """执行条件或受理结果未知，只能按原任务恢复，不能认定明确失败。"""


@contextmanager
def exclusive_workspace(directory):
    root = Path(directory or "/tmp/shopro-workspace")
    root.mkdir(parents=True, exist_ok=True)
    with (root / ".worker.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as cause:
            raise RetryableError("任务空间已被另一个Worker占用") from cause
        try:
            # 独占目录后才清理上次进程被强制终止留下的私有素材。
            for path in root.glob("shopro-render-*"):
                if path.is_dir() and not path.is_symlink():
                    rmtree(path)
            yield root
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def download(url, target, max_bytes=500 * MIB, cancelled=lambda: False,
             check_space=lambda _size: None, validate_url=lambda value: value, digest=None, request_get=None):
    target = Path(target)
    try:
        if cancelled():
            raise RetryableError("任务已停止或租约失效")
        check_space(0)
        validate_url(url)
        started, total = time.monotonic(), 0
        with (request_get or requests.get)(url, stream=True, timeout=(10, 5), allow_redirects=False) as response:
            if response.status_code != 200:
                raise RetryableError("素材下载暂时不可用，请恢复原任务")
            length = response.headers.get("Content-Length")
            if length and length.isdigit():
                if int(length) > max_bytes:
                    raise RenderError(f"单素材超过{max_bytes // MIB}MB")
                check_space(int(length))
            with target.open("wb") as output:
                for chunk in response.iter_content(MIB):
                    if cancelled() or time.monotonic() - started > 180:
                        raise RetryableError("下载已停止、租约失效或超过执行时限")
                    total += len(chunk)
                    if total > max_bytes:
                        raise RenderError(f"单素材超过{max_bytes // MIB}MB")
                    check_space(len(chunk))
                    output.write(chunk)
                    if digest is not None:
                        digest.update(chunk)
        if not total:
            raise RenderError("素材内容为空")
        return total
    except requests.RequestException as cause:
        target.unlink(missing_ok=True)
        raise RetryableError("素材连接异常，请恢复原任务") from cause
    except BaseException:
        target.unlink(missing_ok=True)
        raise


def source_key(url, backend):
    parsed = urlsplit(url)
    # 同一私有对象每次签名可能不同。外部URL保留查询参数，不能猜测内容相同。
    parts = parsed.path.split("/")
    if (backend and (parsed.scheme, parsed.netloc) == (urlsplit(backend).scheme, urlsplit(backend).netloc)
        and parts[1:4] == ["storage", "v1", "object"] and len(parts) > 6
        and parts[4] in ("sign", "authenticated", "public") and parts[5] in ("materials", "videos", "thumbnails")):
        return f"{parsed.scheme}://{parsed.netloc}/storage/v1/object/{'/'.join(parts[5:])}"
    return url


class TaskWorkspace:
    def __init__(self, directory, validate_url, cancelled=lambda: False,
                 output_reserve=1056 * MIB, mask_reserve=0, max_bytes=4096 * MIB,
                 minimum_free=128 * MIB, request_get=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.validate_url, self.cancelled = validate_url, cancelled
        self.request_get = request_get
        self.backend = os.environ.get("SUPABASE_URL", "")
        self.reserve = output_reserve + mask_reserve
        self.max_bytes, self.minimum_free = max_bytes, minimum_free
        self.input_bytes, self.peak_bytes, self.downloads = 0, 0, 0
        self.sources = {}

    def check(self, extra=0, reserve=False):
        if self.cancelled():
            raise RetryableError("任务已停止或租约失效")
        seen, used, masks = set(), 0, 0
        for path in self.directory.rglob("*"):
            if path.is_file():
                stat = path.stat()
                key = (stat.st_dev, stat.st_ino)
                if key not in seen:
                    used += stat.st_size
                    seen.add(key)
                    if path.name.startswith("person-") and path.suffix == ".mkv":
                        masks += stat.st_size
        self.peak_bytes = max(self.peak_bytes, used)
        if masks > 768 * MIB:
            raise RenderError("工程人物蒙版总量超过768MB，请减少人物片段")
        needed = extra + (self.reserve if reserve else 0)
        if used + needed > self.max_bytes:
            raise RetryableError("任务临时文件超过磁盘预算，请缩短工程")
        if disk_usage(self.directory).free < needed + self.minimum_free:
            raise RetryableError("任务临时空间不足，请恢复空间后继续原任务")

    def fetch(self, url, max_bytes=500 * MIB):
        self.check(reserve=True)
        key = source_key(url, self.backend)
        if key in self.sources:
            return self.sources[key]
        digest = hashlib.sha256()
        partial = self.directory / "download.partial"

        def check_space(size):
            if self.input_bytes + (partial.stat().st_size if partial.exists() else 0) + size > 2048 * MIB:
                raise RenderError("工程素材总量超过2GB")
            self.check(size, reserve=True)

        size = download(url, partial, max_bytes, self.cancelled, check_space, self.validate_url, digest, self.request_get)
        target = self.directory / digest.hexdigest()
        if target.exists():
            partial.unlink()
        else:
            partial.replace(target)
            self.input_bytes += size
        self.downloads += 1
        self.sources[key] = target
        self.check(reserve=True)
        return target
