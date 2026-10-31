"""真实自托管业务接受：原Edge/数据库、MCP、队列及独立FFmpeg，无供应商假成功。"""
import json
import os
from pathlib import Path
import time
import uuid

from self_hosted_acceptance import api, login, require, BASE


import sys as _initial_sys
_initial_sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from initial_admin import read_initial_admin
INITIAL_IDENTITY = read_initial_admin()

def edge(name, token, body, expected=(200, 201, 202)):
    return api("/functions/v1/" + name, token=token, body=body, expected=expected)


def rpc(token, name, body=None):
    return api("/rest/v1/rpc/" + name, token=token, body=body or {})


def mcp(token, method, params=None, expected=(200,)):
    raw = api("/mcp", token=token, body={"jsonrpc": "2.0", "id": 1, "method": method,
              **({"params": params} if params is not None else {})},
              headers={"Accept": "application/json, text/event-stream"}, binary=True, expected=expected)
    values = [json.loads(line[6:]) for line in raw.decode().splitlines() if line.startswith("data: ")]
    return values[-1] if values else json.loads(raw)


def main():
    require(os.environ.get("SELF_HOSTED_ISOLATED_ACCEPTANCE") == "true",
            "业务写入测试只能显式用于新建隔离接受实例")
    session = login(INITIAL_IDENTITY["email"], INITIAL_IDENTITY["password"])
    token, uid = session["access_token"], session["user"]["id"]
    checks = {}
    catalog = edge("model-settings", token, {"action": "list"})
    require(catalog["admin"] is True and len(catalog["configs"]) == 20, "模型管理目录不完整")
    model = next(value for value in catalog["configs"] if value["slot"] == "text.primary")
    require(not model["enabled"] and model["version_id"] is None, "本测试需要未配置的新隔离实例")
    test_key = "selfhost-acceptance-" + uuid.uuid4().hex
    saved = edge("model-settings", token, {"action": "save", "slot": model["slot"], "enabled": False,
        "version_id": None, "settings": model["settings"], "api_key": test_key})
    configs = edge("model-settings", token, {"action": "list"})["configs"]
    require(next(value for value in configs if value["slot"] == model["slot"])["has_key"], "模型密钥未保存")
    require(test_key not in json.dumps(configs), "模型管理返回明文密钥")
    ciphertext = api("/rest/v1/model_config_versions?id=eq." + saved["version_id"] +
        "&select=key_ciphertext", token=os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    require(test_key not in json.dumps(ciphertext) and ciphertext[0]["key_ciphertext"], "模型密钥未加密")
    # 恢复未启用状态；历史加密版本按业务不可变审计契约保留。
    api("/rest/v1/model_configs?slot=eq." + model["slot"], method="PATCH",
        token=os.environ["SUPABASE_SERVICE_ROLE_KEY"], body={"current_version_id": None, "enabled": False}, expected=(204,))
    checks["model_catalog_encrypted_versioned_save"] = True

    access = edge("operations", token, {"action": "access"})
    require(access.get("permissions"), "默认管理员缺少运营权限")
    for domain in ("orders", "refunds", "customers", "jobs", "risk", "audit", "tickets",
                   "tenants", "costs", "cost_missing", "model_attempts", "alerts"):
        edge("operations", token, {"action": "list", "domain": domain})
    checks["operations_domains"] = 12
    for name, body in (
        ("material-assets", {"action": "list"}),
        ("team-space", {"action": "get"}),
        ("api-keys", {"action": "list"}),
        ("knowledge-base", {"action": "catalog"}),
        ("knowledge-base", {"action": "jobs"}),
        ("production-jobs", {"action": "list"}),
        ("production-jobs", {"action": "media-prices"}),
        ("production-jobs", {"action": "edit-prices"}),
        ("production-jobs", {"action": "analysis-price"}),
        ("production-jobs", {"action": "exports"}),
        ("video-jobs", {"action": "list"}),
        ("batch-video-jobs", {"action": "list"}),
        ("platform-accounts", {"action": "list"}),
        ("product-management", {"action": "imports"}),
        ("product-management", {"action": "translations"}),
    ):
        edge(name, token, body)
    checks["business_read_actions"] = 15

    name = "selfhost-business-" + uuid.uuid4().hex[:12]
    key = str(uuid.uuid4())
    body = {"action": "save", "request_key": key,
            "items": [{"draft": {"name": name, "category": "其他", "currency": "CNY",
                                "original_price": 20, "sale_price": 15, "stock": 2}}]}
    first = edge("product-management", token, body)
    second = edge("product-management", token, body)
    require(first["ids"] == second["ids"] and len(first["products"]) == 1, "商品重复提交不幂等")
    product = first["products"][0]
    changed = edge("product-management", token, {"action": "save", "request_key": str(uuid.uuid4()),
        "items": [{"id": product["id"], "expected_updated_at": product["updated_at"],
                   "draft": {**body["items"][0]["draft"], "name": name + "-updated"}}]})
    edge("product-management", token, {"action": "save", "request_key": str(uuid.uuid4()),
        "items": [{"id": product["id"], "expected_updated_at": product["updated_at"],
                   "draft": body["items"][0]["draft"]}]}, expected=(409,))
    product = changed["products"][0]
    edge("product-management", token, {"action": "delete", "request_key": str(uuid.uuid4()),
        "items": [{"id": product["id"], "expected_updated_at": product["updated_at"]}]})
    checks["product_create_retry_update_conflict_delete"] = True

    issued = edge("api-keys", token, {"action": "create", "name": name,
        "scopes": ["jobs:read"], "expires_in_days": 1})
    raw_key = issued["raw_key"]
    edge("production-jobs", raw_key, {"action": "list"})
    edge("product-management", raw_key, {"action": "list"}, expected=(403,))
    edge("api-keys", token, {"action": "revoke", "key_id": issued["key"]["id"]})
    edge("production-jobs", raw_key, {"action": "list"}, expected=(401,))
    checks["open_api_key_scopes_and_revocation"] = True
    initialized = mcp(token, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
        "clientInfo": {"name": "selfhost-real-acceptance", "version": "1"}})
    require(initialized.get("result", {}).get("protocolVersion"), "MCP真实握手失败")
    tools = mcp(token, "tools/list")["result"]["tools"]
    require(len(tools) == 59, "MCP工具清单不完整")
    result = mcp(token, "tools/call", {"name": "list_production_jobs", "arguments": {}})
    require(not result["result"].get("isError"), "MCP实际后端工具调用失败")
    checks["mcp_handshake_59_tools_real_business_call"] = True

    # 由实际FFmpeg生成的两段素材经真实Storage、Edge队列、租约、上传、结案处理。
    media = []
    for color in ("red", "blue"):
        path = f"{uid}/uploads/{name}-{color}.mp4"
        api("/storage/v1/object/materials/" + path, token=token,
            body=Path("/fixtures/" + color + ".mp4").read_bytes(),
            headers={"Content-Type": "video/mp4"})
        media.append(BASE + "/storage/v1/object/authenticated/materials/" + path)
    render_key = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    api("/rest/v1/video_projects", token=token, body={"id": project_id, "user_id": uid,
        "title": name, "status": "draft", "duration": 2})
    body = {"action": "create", "kind": "render", "request_key": render_key,
        "project_id": project_id,
        "input": {"version": 1, "title": name, "duration": 2, "height": 720, "fps": 30, "ratio": "16:9",
            "tracks": [{"id": "red", "type": "video", "start": 0, "duration": 1, "url": media[0]},
                       {"id": "blue", "type": "video", "start": 1, "duration": 1, "url": media[1]},
                       {"id": "text", "type": "text", "start": 0, "duration": 2,
                        "text": "自托管真实合成", "fontSize": 40, "fontColor": "#ffffff"}]}}
    created = edge("production-jobs", token, body)
    repeated = edge("production-jobs", token, body)
    require(created["job"]["id"] == repeated["job"]["id"], "渲染重复请求创建了第二任务")
    job = created["job"]
    deadline = time.monotonic() + 80
    while job["status"] not in ("completed", "failed", "cancelled") and time.monotonic() < deadline:
        time.sleep(1)
        job = edge("production-jobs", token, {"action": "query", "job_id": job["id"]})["job"]
    require(job["status"] == "completed", "真实FFmpeg任务未完成：" + json.dumps(job, ensure_ascii=False))
    checks["real_ffmpeg_queue"] = {"job_id": job["id"], "project_id": project_id, "status": job["status"],
        "result": {key: job["result"][key] for key in ("size", "duration", "resolution")}}
    print(json.dumps({"passed": True, "self_hosted_business_checks": checks}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"passed": False, "error": str(error)}), flush=True)
        raise
