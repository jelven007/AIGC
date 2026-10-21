"""独立后台调度器：周期触发受控 Worker，可单次预检或运行。"""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import signal
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


@dataclass(repr=False)
class Config:
    endpoint: str
    secret: str
    concurrency: int
    interval: int
    timeout: int
    state_path: Path


class WorkerError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def load_config():
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise ValueError("SUPABASE_URL 必须为不含凭据的 HTTPS 项目地址")
    secret_file = os.environ.get("VIDEO_WORKER_SECRET_FILE")
    secret = Path(secret_file).read_text().strip() if secret_file else os.environ.get("VIDEO_WORKER_SECRET", "")
    if len(secret) < 32 or "\n" in secret or "\r" in secret:
        raise ValueError("请配置至少 32 字符的 VIDEO_WORKER_SECRET 或密钥文件")

    def number(key, default, minimum, maximum):
        try:
            value = int(os.environ.get(key, str(default)))
        except ValueError:
            raise ValueError(f"{key} 必须为整数") from None
        if not minimum <= value <= maximum:
            raise ValueError(f"{key} 应为 {minimum}–{maximum}")
        return value

    return Config(
        base + "/functions/v1/" + (
            "production-worker" if os.environ.get("PRODUCTION_WORKER_ENABLED") == "true" else "video-job-worker"), secret,
        number("VIDEO_WORKER_CONCURRENCY", 4, 1, 8),
        number("VIDEO_WORKER_INTERVAL_SECONDS", 10, 5, 300),
        number("VIDEO_WORKER_TIMEOUT_SECONDS", 150, 10, 150),
        Path(os.environ.get("VIDEO_WORKER_STATE_FILE", "/tmp/shopro-video-scheduler.json")),
    )


def call_worker(config, action="run"):
    request = urllib.request.Request(
        config.endpoint, method="POST", data=json.dumps({"action": action}).encode(),
        headers={"Authorization": "Bearer " + config.secret, "Content-Type": "application/json"},
    )
    # 禁止跳转，避免将专用密钥随重定向发送到其他主机。
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request, timeout=config.timeout) as response:
            raw = response.read(16385)
            if len(raw) > 16384:
                raise WorkerError("invalid_response")
            data = json.loads(raw)
        if action == "probe":
            production = config.endpoint.endswith("/production-worker")
            expected_version = 9 if production else 1
            if data.get("ready") is not True or data.get("version") != expected_version:
                raise WorkerError("worker_not_ready")
            if production and (data.get("required_migration") != "00048" or data.get("render_version") != 2):
                raise WorkerError("worker_not_ready")
            return 0
        processed = data.get("processed")
        if type(processed) is not int or processed not in (0, 1):
            raise WorkerError("invalid_response")
        return processed
    except urllib.error.HTTPError as cause:
        raise WorkerError(f"http_{cause.code}") from None
    except (urllib.error.URLError, TimeoutError, socket.timeout):
        raise WorkerError("network_error") from None
    except (ValueError, AttributeError):
        raise WorkerError("invalid_response") from None


def run_cycle(config):
    def run(_):
        try:
            return call_worker(config), None
        except WorkerError as cause:
            return 0, cause.code
    with concurrent.futures.ThreadPoolExecutor(max_workers=config.concurrency) as pool:
        results = list(pool.map(run, range(config.concurrency)))
    failures = [error for _, error in results if error]
    return {"processed": sum(count for count, _ in results), "errors": len(failures),
            "error_codes": sorted(set(failures))}


def write_state(config, value):
    config.state_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = config.state_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value))
    os.replace(temporary, config.state_path)


def log(event, **values):
    print(json.dumps({"event": event, **values}, ensure_ascii=False), flush=True)


def healthy(config):
    try:
        state = json.loads(config.state_path.read_text())
        return state.get("ready") is True and time.time() - state["last_ok"] < max(
            90, config.timeout + config.interval * 3)
    except (OSError, KeyError, ValueError, TypeError):
        return False


def serve(config, stop):
    state = {"ready": False, "last_ok": 0, "failures": 0}
    while not stop.is_set():
        started = time.monotonic()
        try:
            if not state["ready"]:
                call_worker(config, "probe")
                state["ready"] = True
                state["last_ok"] = time.time()
                log("ready")
            result = run_cycle(config)
            if config.endpoint.endswith('/production-worker'):
                # 独立低频采集自然视频指标，避免每条图片任务触发全账号采集。
                if time.time() - state.get("last_metrics", 0) >= 900:
                    request = urllib.request.Request(config.endpoint, method="POST",
                        data=b'{"action":"metrics"}',
                        headers={"Authorization": "Bearer " + config.secret, "Content-Type": "application/json"})
                    try:
                        with urllib.request.build_opener(NoRedirect).open(request, timeout=config.timeout) as response:
                            response.read(16384)
                        state["last_metrics"] = time.time()
                    except Exception:
                        log("metrics_deferred")
            if result["errors"]:
                state["failures"] += 1
                if any(code in ("http_401", "http_403", "http_404") for code in result["error_codes"]):
                    state["ready"] = False
            else:
                state["failures"] = 0
                state["last_ok"] = time.time()
            state.update(result)
            log("cycle", **result)
        except WorkerError as cause:
            state.update(ready=False, failures=state["failures"] + 1)
            log("probe_failed", code=cause.code)
        write_state(config, state)
        delay = min(300, config.interval * 2 ** min(state["failures"], 5))
        # 一批结束后再进入下一批，无本地重叠；信号可立即打断等待。
        stop.wait(max(1, delay - (time.monotonic() - started)))
    log("stopped")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--daemon", action="store_true", help="持续调度，脱离浏览器运行")
    parser.add_argument("--probe", action="store_true", help="只读检查 Worker、密钥和任务迁移")
    parser.add_argument("--healthcheck", action="store_true", help="检查后台最近一次成功调度")
    args = parser.parse_args()
    try:
        config = load_config()
        if args.healthcheck:
            return 0 if healthy(config) else 1
        if args.probe:
            call_worker(config, "probe")
            log("ready")
            return 0
        if args.daemon:
            stop = threading.Event()
            for signum in (signal.SIGTERM, signal.SIGINT):
                signal.signal(signum, lambda *_: stop.set())
            return serve(config, stop)
        result = run_cycle(config)
        log("cycle", **result)
        return 1 if result["errors"] else 0
    except (ValueError, OSError) as cause:
        # 文件/配置异常不打印凭据或远端响应。
        log("configuration_error", message=str(cause) if isinstance(cause, ValueError) else "配置文件不可读")
        return 1
    except WorkerError as cause:
        log("worker_error", code=cause.code)
        return 1


if __name__ == "__main__":
    sys.exit(main())
