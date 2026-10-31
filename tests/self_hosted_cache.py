"""真实Auth/RPC验证缓存监控、清理及普通用户拒绝。"""
import json
import os
import uuid

from self_hosted_acceptance import api, login, require, SERVICE

require(os.environ.get("SELF_HOSTED_ISOLATED_ACCEPTANCE") == "true", "需要隔离实例")
token = login("admin@shopro.local", "<REDACTED_CREDENTIAL>")["access_token"]
name, identifier = uuid.uuid4().hex, str(uuid.uuid4())
ordinary = api("/auth/v1/admin/users", token=SERVICE, body={
    "email": "cache-" + name + "@example.com", "password": name, "email_confirm": True,
    "user_metadata": {"role": "admin"}})
try:
    api("/rest/v1/llm_cache", token=SERVICE, body={"id": identifier, "cache_key": name,
        "action": "generate_script", "response": {"text": "缓存真实接受"},
        "expires_at": "2020-01-01T00:00:00Z", "hit_count": 3})
    result = api("/rest/v1/rpc/manage_llm_cache", token=token, body={"p_action": "list"})
    require(any(item["id"] == identifier and item["hit_count"] == 3
                and "缓存真实接受" in item["response_text"] for item in result["entries"]), "缓存读取字段不匹配")
    user_token = login("cache-" + name + "@example.com", name)["access_token"]
    for action in ("list", "delete", "clear_expired"):
        api("/rest/v1/rpc/manage_llm_cache", token=user_token,
            body={"p_action": action, "p_id": identifier}, expected=(403,))
    result = api("/rest/v1/rpc/manage_llm_cache", token=token, body={"p_action": "clear_expired"})
    require(result["ok"] and result["changed"] >= 1, "缓存清理未确认")
    result = api("/rest/v1/rpc/manage_llm_cache", token=token, body={"p_action": "list"})
    require(all(item["id"] != identifier for item in result["entries"]), "缓存清理未持久化")
    print(json.dumps({"passed": True, "admin_cache_read_and_cleanup": True,
                      "ordinary_metadata_admin_denied": True, "actual_response_fields": True}))
finally:
    api("/rest/v1/llm_cache?id=eq." + identifier, token=SERVICE, method="DELETE", expected=(204,))
    api("/auth/v1/admin/users/" + ordinary["id"], token=SERVICE, method="DELETE", expected=(200,))
