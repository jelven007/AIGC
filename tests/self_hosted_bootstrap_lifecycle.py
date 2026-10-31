"""仅在隔离实例修改初始账号，并证明bootstrap不会恢复管理变更。"""
import json
import os
from pathlib import Path
import sys
import uuid

import psycopg
from psycopg.rows import dict_row
from self_hosted_acceptance import api, login, require, SERVICE

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from self_hosted_bootstrap import bootstrap_admin


def main():
    require(os.environ.get("SELF_HOSTED_ISOLATED_ACCEPTANCE") == "true", "需要隔离实例")
    original = login("admin@shopro.local", "<REDACTED_CREDENTIAL>")
    uid, metadata = original["user"]["id"], original["user"]["app_metadata"]
    with psycopg.connect(host="db", dbname="postgres", user="supabase_admin",
                         password=os.environ["POSTGRES_PASSWORD"], autocommit=True, row_factory=dict_row) as db:
        profile = db.execute("SELECT role FROM public.profiles WHERE id=%s", (uid,)).fetchone()
        plan = db.execute("SELECT status,credits_total,credits_used FROM public.user_plans WHERE user_id=%s", (uid,)).fetchone()
        logs = db.execute("SELECT count(*) AS n FROM public.credit_logs WHERE user_id=%s", (uid,)).fetchone()["n"]
        password = uuid.uuid4().hex
        try:
            api("/auth/v1/admin/users/" + uid, token=SERVICE, method="PUT", body={"password": password})
            require(bootstrap_admin(db, SERVICE) == (uid, False), "重复初始化重新创建账号")
            api("/auth/v1/token?grant_type=password", body={"email": "admin@shopro.local", "password": "<REDACTED_CREDENTIAL>"}, expected=(400,))
            require(login("admin@shopro.local", password)["user"]["id"] == uid, "新密码被初始化覆盖")
            api("/auth/v1/admin/users/" + uid, token=SERVICE, method="PUT", body={"ban_duration": "24h"})
            require(bootstrap_admin(db, SERVICE) == (uid, False), "禁用账号被重建")
            api("/auth/v1/token?grant_type=password", body={"email": "admin@shopro.local", "password": password}, expected=(400,))
            api("/auth/v1/admin/users/" + uid, token=SERVICE, method="PUT",
                body={"app_metadata": {**metadata, "role": "user"}})
            with db.transaction():
                db.execute("SET LOCAL request.jwt.claim.role='service_role'")
                db.execute("""SET LOCAL request.jwt.claims='{"role":"service_role"}'""")
                db.execute("UPDATE public.profiles SET role='user' WHERE id=%s", (uid,))
                db.execute("UPDATE public.user_plans SET status='expired',credits_total=credits_used WHERE user_id=%s", (uid,))
            require(bootstrap_admin(db, SERVICE) == (uid, False), "撤权后重新初始化")
            require(db.execute("SELECT raw_app_meta_data->>'role' AS role FROM auth.users WHERE id=%s", (uid,)).fetchone()["role"] == "user",
                    "可信管理员角色被恢复")
            require(db.execute("SELECT role FROM public.profiles WHERE id=%s", (uid,)).fetchone()["role"] == "user", "档案角色被恢复")
            current = db.execute("SELECT status,credits_total,credits_used FROM public.user_plans WHERE user_id=%s", (uid,)).fetchone()
            require(current["status"] == "expired" and current["credits_total"] == current["credits_used"], "权益被恢复")
            require(db.execute("SELECT count(*) AS n FROM public.credit_logs WHERE user_id=%s", (uid,)).fetchone()["n"] == logs,
                    "初始化重复赠分")
        finally:
            # 显式隔离测试清理；恢复原快照，不由bootstrap执行。
            api("/auth/v1/admin/users/" + uid, token=SERVICE, method="PUT",
                body={"password": "<REDACTED_CREDENTIAL>", "ban_duration": "none", "app_metadata": metadata})
            with db.transaction():
                db.execute("SET LOCAL request.jwt.claim.role='service_role'")
                db.execute("""SET LOCAL request.jwt.claims='{"role":"service_role"}'""")
                db.execute("UPDATE public.profiles SET role=%s WHERE id=%s", (profile["role"], uid))
                db.execute("UPDATE public.user_plans SET status=%s,credits_total=%s,credits_used=%s WHERE user_id=%s",
                           (plan["status"], plan["credits_total"], plan["credits_used"], uid))
    require(login("admin@shopro.local", "<REDACTED_CREDENTIAL>")["user"]["id"] == uid, "测试清理后默认账号不可用")
    print(json.dumps({"passed": True, "password_preserved": True, "ban_preserved": True,
                      "revoked_roles_and_entitlement_preserved": True, "no_duplicate_credit": True,
                      "isolated_cleanup_default_login": True}))


if __name__ == "__main__":
    main()
