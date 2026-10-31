"""核验真实快照恢复后原管理员、任务、私有成片与历史模型密钥。"""
import json
import os
from pathlib import Path
import sys
import tempfile

import psycopg
from psycopg.rows import dict_row
from self_hosted_acceptance import api, login, require, BASE

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from backup_restore import validate_credentials
from initial_admin import read_initial_admin
INITIAL_IDENTITY = read_initial_admin()

require(os.environ.get("SELF_HOSTED_ISOLATED_ACCEPTANCE") == "true", "需要隔离实例")
values = dict(line.split("=", 1) for line in Path("/state/runtime.env").read_text().splitlines() if line and not line.startswith("#"))
seed = json.loads(Path("/state/receipts/recovery-seed.json").read_text())
token = login(INITIAL_IDENTITY["email"], INITIAL_IDENTITY["password"])
require(token["user"]["id"] == seed["uid"], "恢复后管理员UUID变化")
with psycopg.connect(host="db", dbname="postgres", user="supabase_admin",
                     password=os.environ["POSTGRES_PASSWORD"], autocommit=True, row_factory=dict_row) as db:
    balance = db.execute("SELECT credits_total,credits_used FROM public.user_plans WHERE user_id=%s", (seed["uid"],)).fetchone()
    require(balance == seed["balance"], "恢复后余额不符")
    job = db.execute("SELECT result,status FROM public.production_jobs WHERE id=%s", (seed["completed"]["id"],)).fetchone()
    require(job["status"] == "completed" and job["result"] == seed["completed"]["result"], "恢复后原成片任务变化")
    with tempfile.TemporaryDirectory() as directory:
        ring = Path(directory) / "keyring"
        ring.write_text(values["MODEL_KEYRING"])
        ring.chmod(0o600)
        with psycopg.connect(host="db", dbname="postgres", user="supabase_admin",
                             password=os.environ["POSTGRES_PASSWORD"]) as key_db:
            credentials = validate_credentials(key_db, {"model_keyring": str(ring)})
    require(credentials["checked"] >= 1, "未验证历史加密密钥")
result = api("/functions/v1/production-jobs", token=token["access_token"],
    body={"action": "query", "job_id": seed["completed"]["id"]})["job"]["result"]
url = result.get("video_url") or result.get("url")
require(url and url.startswith(BASE + "/storage/v1/"), "恢复后成片未在本实例签名")
content = api(url.removeprefix(BASE), token=token["access_token"], binary=True)
require(len(content) == result["size"] and b"ftyp" in content[:32], "恢复后Storage实物不符")
print(json.dumps({"passed": True, "original_admin_uuid": True, "original_balance": True,
    "original_completed_job": True, "private_video_download_bytes": len(content),
    "historical_credentials": credentials, "restored_origin": BASE}))
