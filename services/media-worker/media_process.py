"""有界本地媒体子进程，停止、租约丢失或空间不足时回收子进程。"""
import subprocess
import time
from render import RenderError


def run_media(args, cancelled=lambda: False, timeout=180, budget=None):
    if cancelled():
        raise RenderError("媒体预处理已停止或租约失效")
    if budget:
        budget.check()
    with subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
        started = time.monotonic()
        try:
            while process.poll() is None:
                if cancelled() or time.monotonic() - started > timeout:
                    raise RenderError("媒体预处理已停止、租约失效或超过执行时限")
                if budget:
                    budget.check()
                time.sleep(.1)
            if process.returncode:
                raise RenderError("媒体预处理失败，请检查素材格式")
            if budget:
                budget.check()
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
