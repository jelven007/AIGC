"""将已认证的加密备份归档到独立HTTPS网关，凭原ID/摘要回执拉回。"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import tempfile
import urllib.parse
import urllib.request
import uuid

from backup_restore import BackupError, CHUNK, NoRedirect, file_hash, load_config, protected_file, verified_stage


def remote(config):
    value = config["archive"]
    base = value["url"].rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.scheme != "https" and not (
                config.get("isolated") is True and parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost"))):
        raise BackupError("invalid_archive_url")
    secret = protected_file(value["secret_file"]).read_text().strip()
    if len(secret) < 16 or "\r" in secret or "\n" in secret:
        raise BackupError("invalid_archive_secret")
    return base, parsed, secret


def object_key(identifier, digest):
    if str(uuid.UUID(identifier)) != identifier or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise BackupError("invalid_archive_receipt")
    return f"backups/{identifier}/{digest}.tar"


def upload(config, key, artifact, receipt_path):
    artifact, receipt_path = Path(artifact), Path(receipt_path)
    if receipt_path.exists():
        raise BackupError("archive_receipt_exists")
    base, parsed, secret = remote(config)
    with tempfile.TemporaryDirectory(prefix=".archive-", dir=receipt_path.parent) as directory:
        stage = Path(directory)
        verified = stage / "verified"
        verified.mkdir()
        manifest = verified_stage(artifact, verified, key)
        bundle = stage / "bundle.tar"
        # 固定tar头以保持同一加密备份的摘要与幂等对象键，归档仅含.enc实物。
        with tarfile.open(bundle, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for label in sorted(["manifest.enc", *[f["path"] for f in manifest["files"]]]):
                source = protected_file(artifact / label)
                item = tarfile.TarInfo(label)
                item.size, item.mode, item.mtime = source.stat().st_size, 0o600, 0
                with source.open("rb") as incoming:
                    archive.addfile(item, incoming)
        digest, size = file_hash(bundle), bundle.stat().st_size
        identifier = manifest["id"]
        name = object_key(identifier, digest)
        connection = (http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection)(
            parsed.hostname, parsed.port, timeout=60)
        try:
            connection.putrequest("PUT", parsed.path + "/" + name)
            for header, value in {"Authorization": "Bearer " + secret, "Content-Type": "application/x-tar",
                                  "Content-Length": str(size), "Idempotency-Key": identifier + ":" + digest,
                                  "X-Content-SHA256": digest}.items():
                connection.putheader(header, value)
            connection.endheaders()
            with bundle.open("rb") as incoming:
                while chunk := incoming.read(CHUNK):
                    connection.send(chunk)
            response = connection.getresponse()
            data = response.read(16385)
            if response.status not in (200, 201) or len(data) > 16384:
                raise BackupError("archive_upload_unconfirmed")
            receipt = json.loads(data)
            if not (isinstance(receipt, dict) and receipt.get("accepted") is True
                    and receipt.get("backup_id") == identifier and receipt.get("sha256") == digest
                    and type(receipt.get("size")) is int and receipt["size"] == size):
                raise BackupError("archive_upload_unconfirmed")
        except BackupError:
            raise
        except Exception:
            raise BackupError("archive_upload_unconfirmed") from None
        finally:
            connection.close()
        receipt = {"backup_id": identifier, "sha256": digest, "size": size, "object_key": name,
                   "archive_url": base, "accepted": True, "encrypted": True}
        with receipt_path.open("x") as outgoing:
            receipt_path.chmod(0o600)
            json.dump(receipt, outgoing)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        return receipt


def pull(config, key, receipt_path, output):
    output = Path(output)
    if output.exists():
        raise BackupError("archive_output_exists")
    base, _, secret = remote(config)
    receipt = json.loads(protected_file(receipt_path).read_text())
    name = object_key(receipt["backup_id"], receipt["sha256"])
    if (receipt.get("object_key") != name or receipt.get("archive_url") != base or receipt.get("accepted") is not True
            or type(receipt.get("size")) is not int or not 1 <= receipt["size"] <= 1024 ** 4):
        raise BackupError("invalid_archive_receipt")
    with tempfile.TemporaryDirectory(prefix=".pull-", dir=output.parent) as directory:
        stage = Path(directory)
        bundle = stage / "bundle.tar"
        request = urllib.request.Request(base + "/" + name, headers={"Authorization": "Bearer " + secret})
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response, bundle.open("xb") as outgoing:
                bundle.chmod(0o600)
                size = 0
                while chunk := response.read(CHUNK):
                    size += len(chunk)
                    if size > receipt["size"]:
                        raise BackupError("archive_checksum_failed")
                    outgoing.write(chunk)
        except BackupError:
            raise
        except Exception:
            raise BackupError("archive_download_failed") from None
        if bundle.stat().st_size != receipt["size"] or file_hash(bundle) != receipt["sha256"]:
            raise BackupError("archive_checksum_failed")
        artifact = stage / "artifact"
        artifact.mkdir(mode=0o700)
        seen = set()
        with tarfile.open(bundle, mode="r:") as archive:
            for member in archive:
                if (not member.isfile() or not re.fullmatch(
                    r"(manifest|database\.dump|object-\d+|secret-[a-z][a-z0-9_]*)\.enc", member.name)
                        or member.name in seen or not 0 <= member.size <= receipt["size"]):
                    raise BackupError("invalid_archive_member")
                seen.add(member.name)
                with archive.extractfile(member) as incoming, (artifact / member.name).open("xb") as outgoing:
                    os.chmod(artifact / member.name, 0o600)
                    shutil.copyfileobj(incoming, outgoing, CHUNK)
        verified = stage / "verified"
        verified.mkdir()
        manifest = verified_stage(artifact, verified, key)
        if manifest["id"] != receipt["backup_id"] or seen != {"manifest.enc", *[f["path"] for f in manifest["files"]]}:
            raise BackupError("archive_manifest_mismatch")
        os.rename(artifact, output)
        return {"backup_id": manifest["id"], "sha256": receipt["sha256"], "encrypted": True, "verified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("upload", "pull"))
    parser.add_argument("--config", required=True)
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--artifact")
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        config, key = load_config(args.config)
        if args.action == "upload" and args.artifact:
            receipt = upload(config, key, Path(args.artifact), Path(args.receipt))
        elif args.action == "pull" and args.output:
            receipt = pull(config, key, Path(args.receipt), Path(args.output))
        else:
            raise BackupError("required_argument_missing")
        print(json.dumps(receipt))
        return 0
    except Exception as cause:
        print(json.dumps({"error": str(cause) if isinstance(cause, BackupError) else "archive_transfer_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
