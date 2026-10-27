"""持久原事件告警投递；HTTPS relay必须确认原event_id，未知结果保留退避。"""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid


class DeliveryError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def validate_url(value, isolated=False):
    parsed = urllib.parse.urlsplit(value)
    if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.scheme != "https" and not (
                isolated is True and parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost"))):
        raise DeliveryError("invalid_endpoint")
    return value


def private_json(path):
    path = Path(path)
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise DeliveryError("private_file_required")
    return json.loads(path.read_text())


def load_config(path):
    config = private_json(path)
    for name in ("worker", "relay"):
        validate_url(config[name + "_url"], config.get("isolated"))
        secret = Path(config[name + "_secret_file"])
        if secret.is_symlink() or secret.stat().st_mode & 0o077:
            raise DeliveryError("private_file_required")
        value = secret.read_text().strip()
        if len(value) < 32 or "\r" in value or "\n" in value:
            raise DeliveryError("invalid_secret")
        config[name + "_secret"] = value
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", config["channel"]):
        raise DeliveryError("invalid_channel")
    return config


@contextmanager
def spool(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise DeliveryError("invalid_spool")
    descriptor = os.open(str(path) + ".lock", os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        value = json.loads(path.read_text()) if path.exists() else {}
        if not isinstance(value, dict) or value and not isinstance(value.get("events"), list):
            raise DeliveryError("invalid_spool")
        yield value
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            try:
                json.dump(value, output, ensure_ascii=False)
                output.flush()
                os.fsync(output.fileno())
            except Exception:
                temporary.unlink(missing_ok=True)
                raise
        try:
            os.replace(temporary, path)
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            temporary.unlink(missing_ok=True)


def request(config, target, payload, event_id=None):
    endpoint = validate_url(config[target + "_url"], config.get("isolated"))
    headers = {"Authorization": "Bearer " + config[target + "_secret"], "Content-Type": "application/json"}
    if event_id:
        headers["Idempotency-Key"] = event_id
    req = urllib.request.Request(endpoint, data=json.dumps(payload, ensure_ascii=False).encode(), headers=headers, method="POST")
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=20) as response:
            data = response.read(16385)
            if len(data) > 16384:
                raise DeliveryError("invalid_response")
            return json.loads(data)
    except Exception:
        raise DeliveryError("delivery_unconfirmed") from None


def send(config, payload):
    event_id = payload["event_id"]
    if str(uuid.UUID(event_id)) != event_id:
        raise DeliveryError("invalid_event_id")
    try:
        receipt = request(config, "relay", payload, event_id)
        if isinstance(receipt, dict) and receipt.get("accepted") is True and receipt.get("event_id") == event_id:
            return {"accepted": True, "event_id": event_id}
    except DeliveryError:
        pass
    return None


def deliver_local(config, path):
    if not Path(path).exists():
        return 0, 0
    now = time.time()
    with spool(path) as value:
        if value.get("endpoint") != config["worker_url"]:
            raise DeliveryError("spool_endpoint_mismatch")
        if any(e.get("lease_until", 0) > now for e in value["events"]):
            return 0, 0
        event = next((e for e in value["events"] if not e.get("delivered_at") and e.get("next_run_at", 0) <= now), None)
        if event is None:
            return 0, 0
        event.setdefault("event_id", str(uuid.uuid4()))
        event.update(lease_token=str(uuid.uuid4()), lease_until=now + 90, attempts=event.get("attempts", 0) + 1)
        claimed = dict(event)
    payload = {key: claimed[key] for key in ("event_id", "rule", "event", "at", "version", "source_id") if key in claimed}
    payload["source_type"] = "scheduler"
    receipt = send(config, payload)
    with spool(path) as value:
        event = next(e for e in value["events"] if e["event_id"] == claimed["event_id"])
        if event.get("lease_token") != claimed["lease_token"] or event.get("lease_until", 0) <= time.time():
            return 0, 1
        event.pop("lease_token", None)
        event.pop("lease_until", None)
        if receipt:
            event.update(receipt=receipt, delivered_at=time.time())
        else:
            event["next_run_at"] = time.time() + min(3600, 30 * 2 ** min(event["attempts"] - 1, 7))
    return int(receipt is not None), int(receipt is None)


def run_once(config):
    delivered = errors = 0
    # 数据库/Worker断连时仍先发送独立持久卷中的故障与恢复事件。
    for path in config.get("spool_paths", []):
        for _ in range(20):
            try:
                success, failed = deliver_local(config, path)
            except (DeliveryError, OSError, ValueError):
                success, failed = 0, 1
            delivered += success
            errors += failed
            if not success:
                break
    try:
        for _ in range(20):
            item = request(config, "worker", {"action": "alert_claim", "channel": config["channel"]})
            if item is None:
                break
            if not isinstance(item, dict) or item.get("event_id") != item.get("payload", {}).get("event_id"):
                raise DeliveryError("invalid_claim")
            receipt = send(config, item["payload"])
            saved = request(config, "worker", {"action": "alert_finish", "channel": config["channel"],
                            "event_id": item["event_id"], "lease_token": item["lease_token"], "receipt": receipt})
            if not isinstance(saved, dict) or saved.get("saved") is not True:
                raise DeliveryError("receipt_not_saved")
            delivered += int(receipt is not None)
            if receipt is None:
                errors += 1
                break
    except (DeliveryError, KeyError, ValueError):
        errors += 1
    return {"delivered": delivered, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--daemon", action="store_true")
    args = parser.parse_args()
    try:
        config = load_config(args.config)
        stop = threading.Event()
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, lambda *_: stop.set())
        while not stop.is_set():
            result = run_once(config)
            print(json.dumps(result), flush=True)
            if not args.daemon:
                return int(result["errors"] > 0)
            stop.wait(30)
        return 0
    except Exception:
        print(json.dumps({"error": "alert_delivery_configuration_failed"}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
