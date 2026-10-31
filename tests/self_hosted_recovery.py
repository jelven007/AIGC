"""在真实自托管库准备和核验容器重启、过期租约、UNKNOWN不重提。"""
import json
import os
from pathlib import Path
import sys
import uuid

import psycopg
from psycopg.rows import dict_row
from self_hosted_acceptance import require

require(os.environ.get("SELF_HOSTED_ISOLATED_ACCEPTANCE") == "true", "需要隔离实例")
receipt = Path("/recovery/recovery-seed.json")
with psycopg.connect(host="db", dbname="postgres", user="supabase_admin",
                     password=os.environ["POSTGRES_PASSWORD"], autocommit=True, row_factory=dict_row) as db:
    if sys.argv[1] == "prepare":
        uid = db.execute("SELECT user_id FROM shopro_selfhost.bootstrap WHERE name='initial-admin'").fetchone()["user_id"]
        jobs = [str(uuid.uuid4()), str(uuid.uuid4())]
        completed = db.execute("SELECT id,result FROM public.production_jobs WHERE status='completed' AND kind='render' ORDER BY created_at DESC LIMIT 1").fetchone()
        require(completed, "需要真实已完成渲染")
        balance = db.execute("SELECT credits_total,credits_used FROM public.user_plans WHERE user_id=%s", (uid,)).fetchone()
        logs = db.execute("SELECT count(*) AS n FROM public.credit_logs WHERE user_id=%s", (uid,)).fetchone()["n"]
        with db.transaction():
            for identifier, kind, phase in zip(jobs, ("image", "render"), ("executing", "claimed")):
                db.execute("""INSERT INTO public.production_jobs(id,user_id,request_key,kind,payload,status,phase,
                    attempts,lease_token,lease_until,next_run_at) VALUES(%s,%s,%s,%s,'{}','running',%s,1,%s,
                    now()-interval '1 second',now()+interval '1 day')""",
                    (identifier, uid, uuid.uuid4(), kind, phase, uuid.uuid4()))
        receipt.write_text(json.dumps({"uid": str(uid), "jobs": jobs,
            "completed": {"id": str(completed["id"]), "result": completed["result"]}, "balance": balance, "logs": logs}))
        receipt.chmod(0o600)
        print(json.dumps({"prepared": True}))
    else:
        seed = json.loads(receipt.read_text())
        image, render = seed["jobs"]
        try:
            with db.transaction():
                db.execute("SET LOCAL request.jwt.claim.role='service_role'")
                db.execute("""SET LOCAL request.jwt.claims='{"role":"service_role"}'""")
                db.execute("UPDATE public.production_jobs SET next_run_at=now() WHERE id=ANY(%s::uuid[])", (seed["jobs"],))
                require(db.execute("SELECT public.claim_production_job('image',%s) AS job", (image,)).fetchone()["job"] is None,
                        "执行中断任务被重新领取")
                current = db.execute("SELECT status,attempts FROM public.production_jobs WHERE id=%s", (image,)).fetchone()
                require(current == {"status": "unknown", "attempts": 1}, "UNKNOWN任务被重提")
                require(db.execute("SELECT public.claim_production_job('image',%s) AS job", (image,)).fetchone()["job"] is None,
                        "UNKNOWN任务再次被领取")
                first = db.execute("SELECT public.claim_production_job('render',%s) AS job", (render,)).fetchone()["job"]
                require(first and first["attempts"] == 2, "可安全重试的本地渲染未恢复")
                require(db.execute("SELECT public.claim_production_job('render',%s) AS job", (render,)).fetchone()["job"] is None,
                        "同一任务并发重复领取")
                db.execute("UPDATE public.production_jobs SET lease_until=now()-interval '1 second' WHERE id=%s", (render,))
                second = db.execute("SELECT public.claim_production_job('render',%s) AS job", (render,)).fetchone()["job"]
                require(first["lease_token"] != second["lease_token"], "租约令牌未更换")
                try:
                    with db.transaction():
                        db.execute("SELECT public.update_production_job(%s,%s,'retry','{}')", (render, first["lease_token"]))
                except psycopg.Error:
                    pass
                else:
                    raise AssertionError("旧租约仍可修改任务")
                completed = db.execute("SELECT result,status FROM public.production_jobs WHERE id=%s", (seed["completed"]["id"],)).fetchone()
                require(completed["status"] == "completed" and completed["result"] == seed["completed"]["result"],
                        "已完成任务重启后改变")
                require(db.execute("SELECT credits_total,credits_used FROM public.user_plans WHERE user_id=%s", (seed["uid"],)).fetchone() == seed["balance"],
                        "恢复任务重复扣分")
                require(db.execute("SELECT count(*) AS n FROM public.credit_logs WHERE user_id=%s", (seed["uid"],)).fetchone()["n"] == seed["logs"],
                        "恢复任务重复资金流水")
        finally:
            db.execute("DELETE FROM public.production_jobs WHERE id=ANY(%s::uuid[])", (seed["jobs"],))
        print(json.dumps({"passed": True, "completed_job_persisted": True, "unknown_not_resubmitted": True,
            "expired_render_lease_recovered": True, "old_token_rejected": True, "no_duplicate_credit": True}))
