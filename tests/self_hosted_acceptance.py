"""真实自托管集成接受；使用真实Auth、原SQL/RLS、Storage与生产Edge。"""
import hashlib
import json
import os
from pathlib import Path
import ssl
import sys
import urllib.error
import urllib.request
import uuid

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from deploy_volcengine import migration_files


class AcceptanceError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise AcceptanceError(message)


BASE = os.environ["SUPABASE_URL"]
ANON = os.environ["SUPABASE_ANON_KEY"]
SERVICE = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
TLS = ssl.create_default_context()
TLS.load_verify_locations("/run/tls/ca.crt")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect,
                                     urllib.request.HTTPSHandler(context=TLS))


def api(path, *, body=None, method=None, token=None, headers=None, expected=(200, 201), binary=False):
    request = urllib.request.Request(BASE + path,
        data=body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None,
        method=method or ("POST" if body is not None else "GET"),
        headers={"apikey": ANON, "Authorization": "Bearer " + (token or ANON),
                 "Content-Type": "application/json", **(headers or {})})
    try:
        with OPENER.open(request, timeout=160) as response:
            raw = response.read(2 * 1024 * 1024)
            status = response.status
    except urllib.error.HTTPError as error:
        raw, status = error.read(2 * 1024 * 1024), error.code
    require(status in expected, f"{request.method} {path.split('?')[0]} HTTP {status}")
    if binary:
        return raw
    return json.loads(raw) if raw else None


def login(email, password):
    value = api("/auth/v1/token?grant_type=password", body={"email": email, "password": password})
    require(value.get("access_token") and value.get("user"), "真实Auth未建立会话")
    return value


def run_checks(session):
    checks = {}
    with psycopg.connect(host="db", dbname="postgres", user="supabase_admin",
                         password=os.environ["POSTGRES_PASSWORD"], row_factory=dict_row) as db:
        rows = db.execute("SELECT version,sha256 FROM shopro_deploy.schema_migrations ORDER BY version").fetchall()
        expected = [(path.name.split("_")[0], hashlib.sha256(path.read_bytes()).hexdigest()) for path in migration_files()]
        require([(row["version"], row["sha256"]) for row in rows] == expected, "66份原生产迁移摘要不匹配")
        checks["database_migrations"] = len(rows)
    token, admin_id = session["access_token"], session["user"]["id"]
    require(session["user"]["app_metadata"].get("role") == "admin", "Auth缺少可信管理员角色")
    profile = api("/rest/v1/profiles?id=eq." + admin_id + "&select=username,role", token=token)
    require(len(profile) == 1 and profile[0]["role"] == "admin"
            and (os.environ.get("SELF_HOSTED_INITIAL_CHECK") != "true" or profile[0]["username"] == "admin"),
            "管理员档案不匹配")
    plan = api("/rest/v1/user_plans?user_id=eq." + admin_id + "&select=*,plans(level)", token=token)
    require(len(plan) == 1 and plan[0]["status"] == "active" and plan[0]["plans"]["level"] >= 3
            and plan[0]["credits_total"] > plan[0]["credits_used"], "管理员企业权益不可用")
    checks["admin_auth_profile_entitlement"] = True
    probe = api("/functions/v1/production-worker", body={"action": "probe"},
                token=os.environ["VIDEO_WORKER_SECRET"])
    contract = json.loads((ROOT / "scripts/runtime-contract.json").read_text())
    require(probe.get("ready") is True and probe.get("missing") == []
            and all(probe.get(key) == value for key, value in contract.items()), "完整Worker迁移/协议探针不匹配")
    checks["worker_contract"] = probe
    functions = json.loads((ROOT / "deploy/volcengine/manifest.json").read_text())["functions"]
    for function in functions:
        result = api("/functions/v1/" + function["name"], method="OPTIONS",
                     headers={"x-shopro-function-probe": os.environ["VIDEO_WORKER_SECRET"]})
        require(result == {"loaded": function["name"]}, "业务函数实际加载失败")
    checks["edge_functions_loaded"] = len(functions)
    name = "selfhost-acceptance-" + uuid.uuid4().hex
    ordinary = api("/auth/v1/admin/users", token=SERVICE,
        body={"email": name + "@example.com", "password": uuid.uuid4().hex, "email_confirm": True,
              "user_metadata": {"role": "admin"}})
    ordinary_id = ordinary["id"]
    product_id, object_path = str(uuid.uuid4()), f"{admin_id}/{name}.txt"
    try:
        require(ordinary.get("app_metadata", {}).get("role") != "admin", "客户端metadata可以升权")
        ordinary_token = api("/auth/v1/admin/generate_link", token=SERVICE,
                             body={"type": "magiclink", "email": name + "@example.com"})
        # 使用真实一次性令牌换取普通用户会话，不依赖SMTP。
        verified = api("/auth/v1/verify", body={"type": "magiclink", "token_hash": ordinary_token["hashed_token"]})
        user_token = verified["access_token"]
        created = api("/functions/v1/product-management", token=token, body={"action": "save",
            "request_key": str(uuid.uuid4()), "items": [{"draft": {"name": name, "category": "其他"}}]})
        product_id = created["products"][0]["id"]
        require(api("/rest/v1/products?id=eq." + product_id, token=user_token) == [], "普通用户能读取他人商品")
        api("/rest/v1/user_plans?user_id=eq." + ordinary_id, token=user_token,
            method="PATCH", body={"credits_total": 999999}, expected=(401, 403))
        # 保留桶必须私有；真实签名可以读，匿名和另一用户不能读取。
        raw = b"Shopro real private storage acceptance"
        api("/storage/v1/object/materials/" + object_path, token=token, body=raw,
            headers={"Content-Type": "text/plain"})
        signed = api("/storage/v1/object/sign/materials/" + object_path, token=token, body={"expiresIn": 60})
        signed_path = signed.get("signedURL") or signed.get("signedUrl")
        require(isinstance(signed_path, str), "Storage未返回签名")
        if not signed_path.startswith("/storage/v1"):
            signed_path = "/storage/v1" + signed_path
        require(api(signed_path, binary=True) == raw, "真实签名素材内容不匹配")
        api("/storage/v1/object/public/materials/" + object_path, expected=(400, 403, 404))
        api("/storage/v1/object/authenticated/materials/" + object_path, token=user_token, expected=(400, 403, 404))
        checks["ordinary_user_rls_private_storage"] = True
    finally:
        api("/rest/v1/products?id=eq." + product_id, method="DELETE", token=SERVICE, expected=(204,))
        api("/storage/v1/object/materials", method="DELETE", body={"prefixes": [object_path]},
            token=SERVICE, expected=(200, 404))
        api("/auth/v1/admin/users/" + ordinary_id, method="DELETE", token=SERVICE, expected=(200, 204))
    runtime = api("/runtime-config.js", binary=True)
    require(b'admin@shopro.local' in runtime and SERVICE.encode() not in runtime, "公开运行配置不匹配")
    checks["frontend_runtime_config"] = True
    print(json.dumps({"self_hosted_technical_checks": checks, "passed": True,
                      "live_provider_accepted": False, "origin": BASE}))

def main():
    if os.environ.get("SELF_HOSTED_INITIAL_CHECK") == "true":
        return run_checks(login("admin@shopro.local", "<REDACTED_CREDENTIAL>"))
    # 常规部署检查使用临时测试身份；管理员改密、禁用或撤权后仍不重置原身份。
    email = "selfhost-check-" + uuid.uuid4().hex + "@example.com"
    password = uuid.uuid4().hex
    user = api("/auth/v1/admin/users", token=SERVICE, body={"email": email, "password": password,
        "email_confirm": True, "app_metadata": {"role": "admin"},
        "user_metadata": {"username": email.split("@")[0]}})
    try:
        with psycopg.connect(host="db", dbname="postgres", user="supabase_admin",
                             password=os.environ["POSTGRES_PASSWORD"], row_factory=dict_row) as db:
            db.execute("UPDATE public.profiles SET role='admin' WHERE id=%s", (user["id"],))
            db.execute("""UPDATE public.user_plans SET plan_id=(SELECT id FROM public.plans
                WHERE level>=3 ORDER BY created_at DESC LIMIT 1),status='active',
                expires_at=NULL,credits_total=1000000 WHERE user_id=%s""", (user["id"],))
        run_checks(login(email, password))
    finally:
        api("/auth/v1/admin/users/" + user["id"], method="DELETE", token=SERVICE, expected=(200, 204))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"passed": False, "error": str(error) if isinstance(error, AcceptanceError)
                          else type(error).__name__}), file=sys.stderr)
        sys.exit(1)
