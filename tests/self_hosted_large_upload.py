"""真实普通用户40MiB上传、下载摘要和删除；回执不包含令牌。"""
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from self_hosted_acceptance import api, BASE, OPENER, ANON, SERVICE, require
import urllib.request

require(os.environ.get("SELF_HOSTED_ISOLATED_ACCEPTANCE") == "true", "需要隔离验收")
name = "selfhost-large-" + uuid.uuid4().hex
user = api("/auth/v1/admin/users", token=SERVICE, body={
    "email": name + "@example.com", "password": uuid.uuid4().hex, "email_confirm": True})
uid = user["id"]
path = uid + "/" + name + ".mp4"
report = {"bytes": 40 * 1024 * 1024, "origin": BASE, "ordinary_user": True}
try:
    link = api("/auth/v1/admin/generate_link", token=SERVICE,
               body={"type": "magiclink", "email": name + "@example.com"})
    session = api("/auth/v1/verify", body={"type": "magiclink", "token_hash": link["hashed_token"]})
    token = session["access_token"]
    content = (b"shopro-40mib-upload-check\n" * 2000000)[:report["bytes"]]
    require(len(content) == report["bytes"], "素材长度错误")
    api("/storage/v1/object/materials/" + path, token=token, body=content,
        headers={"Content-Type": "video/mp4"})
    expected = hashlib.sha256(content).hexdigest()
    request = urllib.request.Request(BASE + "/storage/v1/object/authenticated/materials/" + path,
        headers={"apikey": ANON, "Authorization": "Bearer " + token})
    actual, size = hashlib.sha256(), 0
    with OPENER.open(request, timeout=160) as response:
        for chunk in iter(lambda: response.read(1024 * 1024), b""):
            size += len(chunk)
            actual.update(chunk)
    require(size == report["bytes"] and actual.hexdigest() == expected, "上传下载摘要不符")
    report.update(passed=True, downloaded_bytes=size, sha256=expected)
except Exception as error:
    report.update(passed=False, error=str(error))
finally:
    api("/storage/v1/object/materials", method="DELETE", body={"prefixes": [path]},
        token=SERVICE, expected=(200, 404))
    api("/auth/v1/admin/users/" + uid, method="DELETE", token=SERVICE, expected=(200, 204))
    output = Path("/state/receipts/large-upload-checks.json")
    output.write_text(json.dumps(report, indent=2))
    output.chmod(0o600)
print(json.dumps(report))
raise SystemExit(0 if report["passed"] else 1)
