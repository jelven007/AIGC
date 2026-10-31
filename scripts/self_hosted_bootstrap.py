"""仅在未公开的内部网络初始化；原迁移摘要和管理员身份均持久记账。"""
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request
import uuid

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from deploy_volcengine import migration_files, migration_sql
from initial_admin import read_initial_admin


class BootstrapError(RuntimeError):
    pass


def auth_api(path, key, body=None, method=None):
    request = urllib.request.Request("http://auth:9999" + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"}, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=30) as response:
            return json.loads(response.read(1024 * 1024))
    except urllib.error.HTTPError as error:
        if error.code == 404 and body is None:
            return None
        raise BootstrapError(f"Auth初始化请求HTTP {error.code}") from None


def apply_migrations(db):
    with db.transaction():
        db.execute((ROOT / "infra/self-hosted/db/extensions.sql").read_text(), prepare=False)
    files = migration_files()
    with db.transaction():
        tracked = db.execute("SELECT to_regclass('shopro_deploy.schema_migrations') IS NOT NULL AS tracked,"
                             "to_regclass('public.profiles') IS NOT NULL AS initialized").fetchone()
        if not tracked["tracked"] and tracked["initialized"]:
            raise BootstrapError("原库缺少可信摘要账，不能从00001重放")
        if tracked["tracked"]:
            rows = db.execute("SELECT version,sha256 FROM shopro_deploy.schema_migrations ORDER BY version").fetchall()
        else:
            rows = []
    expected = {path.name.split("_")[0]: hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    known = {row["version"]: row["sha256"] for row in rows}
    if (len(known) != len(rows) or set(known) != set(list(expected)[:len(known)])
            or any(expected.get(version) != digest for version, digest in known.items())):
        raise BootstrapError("迁移摘要漂移、未知版本或断档")
    pending = [path for path in files if path.name.split("_")[0] not in known]
    if pending:
        # 原发布工具生成的事务、锁、摘要回执；不使用tests/db平台替身。
        db.execute(migration_sql(pending), prepare=False)
    with db.transaction():
        db.execute((ROOT / "infra/self-hosted/db/business-compat.sql").read_text(), prepare=False)
        db.execute("NOTIFY pgrst,'reload schema'")
    return len(files), len(pending)


def bootstrap_admin(db, key):
    db.execute("SELECT pg_advisory_lock(hashtext('shopro:selfhost:bootstrap'))")
    try:
        with db.transaction():
            db.execute("CREATE SCHEMA IF NOT EXISTS shopro_selfhost")
            db.execute("REVOKE ALL ON SCHEMA shopro_selfhost FROM PUBLIC,anon,authenticated")
            db.execute("""CREATE TABLE IF NOT EXISTS shopro_selfhost.bootstrap(
                name text PRIMARY KEY, user_id uuid NOT NULL, nonce uuid NOT NULL,
                completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())""")
            record = db.execute("SELECT * FROM shopro_selfhost.bootstrap WHERE name='initial-admin'").fetchone()
            if record and record["completed_at"]:
                # 不改密码、禁用状态、角色、套餐或余额；管理操作始终优先于初始化。
                return str(record["user_id"]), False
            identity = read_initial_admin()
            if not record:
                collision = db.execute("SELECT id FROM auth.users WHERE lower(email)=lower(%s)",
                                       (identity["email"],)).fetchone()
                if collision:
                    raise BootstrapError("保留管理员邮箱已存在，拒绝接管")
                record = db.execute("""INSERT INTO shopro_selfhost.bootstrap(name,user_id,nonce)
                    VALUES('initial-admin',%s,%s) RETURNING *""", (uuid.uuid4(), uuid.uuid4())).fetchone()
        user_id, nonce = str(record["user_id"]), str(record["nonce"])
        user = auth_api("/admin/users/" + user_id, key)
        if user is None:
            user = auth_api("/admin/users", key, {
                "id": user_id, "email": identity["email"], "password": identity["password"],
                "email_confirm": True,
                "app_metadata": {"role": "admin", "self_hosted_bootstrap": nonce},
                "user_metadata": {"username": identity["username"]},
            })
        if (user.get("id") != user_id or user.get("email") != identity["email"]
                or user.get("app_metadata", {}).get("self_hosted_bootstrap") != nonce):
            raise BootstrapError("Auth返回身份与初始化回执不符")
        with db.transaction():
            db.execute("SET LOCAL request.jwt.claim.role = 'service_role'")
            db.execute("""SET LOCAL request.jwt.claims = '{"role":"service_role"}'""")
            account = db.execute("SELECT raw_app_meta_data FROM auth.users WHERE id=%s FOR UPDATE", (user_id,)).fetchone()
            if account["raw_app_meta_data"].get("self_hosted_bootstrap") != nonce:
                raise BootstrapError("管理员元数据已变化")
            db.execute("UPDATE public.profiles SET username=%s,role='admin' WHERE id=%s",
                       (identity["username"], user_id))
            # 自托管运维账号有真实、可审计的企业权益；仍经过所有业务权限/余额检查。
            plan = db.execute("""INSERT INTO public.plans(name,level,price,credits,features,limits)
                VALUES('自托管管理员',3,0,1000000,
                    '["全部工作台入口","企业功能","运营与模型管理"]'::jsonb,'{}'::jsonb)
                RETURNING id""").fetchone()
            balance = db.execute("""UPDATE public.user_plans SET plan_id=%s,status='active',
                expires_at=NULL,credits_total=credits_total+1000000
                WHERE user_id=%s RETURNING credits_total-credits_used AS balance""", (plan["id"], user_id)).fetchone()
            if not balance:
                raise BootstrapError("注册触发器未创建套餐")
            db.execute("""INSERT INTO public.credit_logs(user_id,amount,type,action,description,credits_after,balance_after)
                VALUES(%s,1000000,'bonus','self_hosted_admin_bootstrap',
                    '自托管管理员初始化权益',%s,%s)""", (user_id, balance["balance"], balance["balance"]))
            db.execute("UPDATE shopro_selfhost.bootstrap SET completed_at=now() WHERE name='initial-admin'")
        return user_id, True
    finally:
        db.execute("SELECT pg_advisory_unlock(hashtext('shopro:selfhost:bootstrap'))")

def sync_initial_email(db, key):
    """Explicit owner-requested email change; never recreate or reset the account."""
    identity = read_initial_admin()
    db.execute("SELECT pg_advisory_lock(hashtext('shopro:selfhost:bootstrap'))")
    try:
        record = db.execute("SELECT * FROM shopro_selfhost.bootstrap WHERE name='initial-admin'").fetchone()
        if not record or not record["completed_at"]:
            raise BootstrapError("管理员初始化尚未完成")
        user_id = str(record["user_id"])
        collision = db.execute("SELECT id FROM auth.users WHERE lower(email)=lower(%s) AND id<>%s",
                               (identity["email"], user_id)).fetchone()
        if collision:
            raise BootstrapError("目标邮箱已被使用，拒绝合并或接管账号")
        original = auth_api("/admin/users/" + user_id, key)
        email_changed = original["email"].lower() != identity["email"].lower()
        if email_changed:
            changed = auth_api("/admin/users/" + user_id, key, {
                "email": identity["email"], "email_confirm": True,
            }, method="PUT")
            if changed.get("id") != user_id or changed.get("email", "").lower() != identity["email"].lower():
                raise BootstrapError("管理员邮箱更新结果不匹配")
        with db.transaction():
            db.execute("SET LOCAL request.jwt.claim.role='service_role'")
            db.execute("""SET LOCAL request.jwt.claims='{"role":"service_role"}'""")
            db.execute("UPDATE public.profiles SET email=%s WHERE id=%s", (identity["email"], user_id))
        return email_changed
    finally:
        db.execute("SELECT pg_advisory_unlock(hashtext('shopro:selfhost:bootstrap'))")


def main():
    with psycopg.connect(host="db", dbname="postgres", user="supabase_admin",
                         password=os.environ["POSTGRES_PASSWORD"], autocommit=True, row_factory=dict_row) as db:
        # 防止多个迁移进程在预检和执行之间交错。
        db.execute("SELECT pg_advisory_lock(hashtext('shopro:selfhost:migrations'))")
        try:
            count, applied = apply_migrations(db)
        finally:
            db.execute("SELECT pg_advisory_unlock(hashtext('shopro:selfhost:migrations'))")
        user_id, created = bootstrap_admin(db, os.environ["SERVICE_ROLE_KEY"])
        email_updated = (sync_initial_email(db, os.environ["SERVICE_ROLE_KEY"])
                         if os.environ.get("SELF_HOSTED_SYNC_INITIAL_EMAIL") == "true" else False)
        print(json.dumps({"migrations": count, "applied": applied, "admin_recorded": bool(user_id),
                          "admin_email_updated": email_updated,
                          "admin_created": created, "bootstrap_ready": True}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"bootstrap_ready": False, "error": str(error) if isinstance(error, BootstrapError)
                          else type(error).__name__}), file=sys.stderr)
        sys.exit(1)
