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
from self_hosted_bootstrap import sync_initial_email
from unittest.mock import patch


import sys as _initial_sys
_initial_sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from initial_admin import read_initial_admin
INITIAL_IDENTITY = read_initial_admin()

def main():
    require(os.environ.get("SELF_HOSTED_ISOLATED_ACCEPTANCE") == "true", "需要隔离实例")
    original = login(INITIAL_IDENTITY["email"], INITIAL_IDENTITY["password"])
    uid, metadata = original["user"]["id"], original["user"]["app_metadata"]
    with psycopg.connect(host="db", dbname="postgres", user="supabase_admin",
                         password=os.environ["POSTGRES_PASSWORD"], autocommit=True, row_factory=dict_row) as db:
        profile = db.execute("SELECT role FROM public.profiles WHERE id=%s", (uid,)).fetchone()
        plan = db.execute("SELECT status,credits_total,credits_used FROM public.user_plans WHERE user_id=%s", (uid,)).fetchone()
        logs = db.execute("SELECT count(*) AS n FROM public.credit_logs WHERE user_id=%s", (uid,)).fetchone()["n"]
        with patch("self_hosted_bootstrap.read_initial_admin", return_value={
            **INITIAL_IDENTITY, "email": "renamed-" + uuid.uuid4().hex + "@example.com",
        }) as configured:
            desired = configured.return_value["email"]
            require(sync_initial_email(db, SERVICE), "未同步邮箱")
            require(login(desired, INITIAL_IDENTITY["password"])["user"]["id"] == uid, "邮箱更新改变原身份")
            require(not sync_initial_email(db, SERVICE), "重复邮箱同步不幂等")
        require(sync_initial_email(db, SERVICE), "未恢复夹具邮箱")
        current_plan = db.execute("SELECT status,credits_total,credits_used FROM public.user_plans WHERE user_id=%s", (uid,)).fetchone()
        require(current_plan == plan, "邮箱同步修改权益")
        require(db.execute("SELECT count(*) AS n FROM public.credit_logs WHERE user_id=%s", (uid,)).fetchone()["n"] == logs,
                "邮箱同步重复赠分")
        password = uuid.uuid4().hex
        try:
            api("/auth/v1/admin/users/" + uid, token=SERVICE, method="PUT", body={"password": password})
            require(bootstrap_admin(db, SERVICE) == (uid, False), "重复初始化重新创建账号")
            api("/auth/v1/token?grant_type=password", body={"email": INITIAL_IDENTITY["email"], "password": INITIAL_IDENTITY["password"]}, expected=(400,))
            require(login(INITIAL_IDENTITY["email"], password)["user"]["id"] == uid, "新密码被初始化覆盖")
            api("/auth/v1/admin/users/" + uid, token=SERVICE, method="PUT", body={"ban_duration": "24h"})
            require(bootstrap_admin(db, SERVICE) == (uid, False), "禁用账号被重建")
            api("/auth/v1/token?grant_type=password", body={"email": INITIAL_IDENTITY["email"], "password": password}, expected=(400,))
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
                body={"password": INITIAL_IDENTITY["password"], "ban_duration": "none", "app_metadata": metadata})
            with db.transaction():
                db.execute("SET LOCAL request.jwt.claim.role='service_role'")
                db.execute("""SET LOCAL request.jwt.claims='{"role":"service_role"}'""")
                db.execute("UPDATE public.profiles SET role=%s WHERE id=%s", (profile["role"], uid))
                db.execute("UPDATE public.user_plans SET status=%s,credits_total=%s,credits_used=%s WHERE user_id=%s",
                           (plan["status"], plan["credits_total"], plan["credits_used"], uid))
    require(login(INITIAL_IDENTITY["email"], INITIAL_IDENTITY["password"])["user"]["id"] == uid, "测试清理后默认账号不可用")
    print(json.dumps({"passed": True, "password_preserved": True, "ban_preserved": True,
                      "revoked_roles_and_entitlement_preserved": True, "no_duplicate_credit": True,
                      "isolated_cleanup_default_login": True}))


if __name__ == "__main__":
    main()
