"""只读核对匹配迁移、Edge、Auth、私有Storage与前端身份，记录独立环境回执。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
import urllib.parse
import urllib.request

import psycopg
from backup_restore import BackupError, NoRedirect, pg_parameters, protected_file


def endpoint(config, value):
    parsed = urllib.parse.urlsplit(value)
    if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.scheme != "https" and not (
                config.get("isolated") is True and parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost"))):
        raise BackupError("invalid_acceptance_endpoint")
    return value.rstrip("/")


def secret(path):
    value = protected_file(path).read_text().strip()
    if len(value) < 32 or "\r" in value or "\n" in value:
        raise BackupError("invalid_acceptance_secret")
    return value


def http_json(url, headers, body=None):
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
        headers={**headers, "Content-Type": "application/json"}, method="POST" if body else "GET")
    with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
        raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise BackupError("invalid_acceptance_response")
        return json.loads(raw)


def collect(config, release):
    checks, details = {}, {}
    source = release["release"]
    contract = source["worker_contract"]

    def check(name, action):
        try:
            result = action()
            checks[name] = result is not False
            if result is not False:
                details[name] = result
        except Exception:
            checks[name] = False

    def identity():
        digest = hashlib.sha256(json.dumps(source["files"], sort_keys=True).encode()).hexdigest()
        return digest == source["source_sha256"] and re.fullmatch(r"[0-9a-f]{64}", digest) is not None
    check("release_manifest", identity)

    def database():
        expected = {item["version"]: item["sha256"] for item in release["migrations"]}
        if not expected or max(expected) != contract["required_migration"]:
            return False
        if any(source["files"].get(name) != digest for name, digest in {
            name: expected[name.split("/")[-1].split("_")[0]]
            for name in source["files"] if name.startswith("supabase/migrations/")
            and name.split("/")[-1].split("_")[0] in expected
        }.items()):
            return False
        with psycopg.connect(**pg_parameters(config)) as connection:
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            actual = dict(connection.execute("SELECT version,sha256 FROM shopro_deploy.schema_migrations ORDER BY version"))
            if actual != expected:
                return False
            connection.execute("SET LOCAL request.jwt.claim.role='service_role'")
            probe = connection.execute("SELECT worker_capabilities()").fetchone()[0]
            if probe.get("ready") is not True or probe.get("missing") != [] or any(probe.get(k) != v for k, v in contract.items()):
                return False
        return {"migration_count": len(expected), **contract}
    check("database", database)

    def worker():
        base = endpoint(config, config["backend_url"])
        value = http_json(base + "/functions/v1/production-worker",
                          {"Authorization": "Bearer " + secret(config["worker_secret_file"])}, {"action": "probe"})
        return (isinstance(value, dict) and value.get("ready") is True and value.get("missing") == []
                and all(value.get(k) == v for k, v in contract.items())
                and value.get("source_sha256") == source["source_sha256"])
    check("worker", worker)

    def auth():
        base = endpoint(config, config["backend_url"])
        key = secret(config["service_key_file"])
        value = http_json(base + "/auth/v1/settings", {"apikey": key, "Authorization": "Bearer " + key})
        return isinstance(value, dict) and isinstance(value.get("external"), dict)
    check("auth_settings", auth)

    def storage():
        base = endpoint(config, config["backend_url"])
        key = secret(config["service_key_file"])
        value = http_json(base + "/storage/v1/bucket", {"apikey": key, "Authorization": "Bearer " + key})
        if not isinstance(value, list) or not config.get("private_buckets"):
            return False
        buckets = {item["id"]: item.get("public") for item in value if isinstance(item, dict) and isinstance(item.get("id"), str)}
        return all(buckets.get(name) is False for name in config["private_buckets"])
    check("private_storage", storage)

    def frontend():
        base = endpoint(config, config["frontend_url"])
        value = http_json(base + "/release-identity.json", {})
        return isinstance(value, dict) and value.get("source_sha256") == source["source_sha256"]
    check("frontend", frontend)
    return {"environment": config["environment"], "isolated": config.get("isolated") is True,
            "captured_at": time.time(), "source_sha256": source["source_sha256"],
            "technical_ready": all(checks.values()), "checks": checks, "details": details,
            "production_accepted": False,
            "remaining_target_checks": ["runtime_images", "auth_sessions_rls_realtime", "external_business_receipts",
                                        "production_capacity_and_offsite_recovery"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        config = json.loads(protected_file(args.config).read_text())
        release = json.loads(Path(args.release).read_text())
        receipt = collect(config, release)
        output = Path(args.output)
        if output.exists():
            raise BackupError("acceptance_output_exists")
        with tempfile.NamedTemporaryFile(mode="w", dir=output.parent, delete=False) as target:
            temporary = Path(target.name)
            json.dump(receipt, target, ensure_ascii=False)
            target.flush()
            os.fsync(target.fileno())
        try:
            os.rename(temporary, output)
        finally:
            temporary.unlink(missing_ok=True)
        print(json.dumps(receipt, ensure_ascii=False))
        return int(not receipt["technical_ready"])
    except Exception:
        print(json.dumps({"error": "release_acceptance_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
