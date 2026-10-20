"""MCP 仅携带用户 JWT 调用 BaaS，不持有模型或 service_role 密钥。"""
from contextvars import ContextVar
import os
from urllib.parse import urlparse
import httpx

request_token = ContextVar("shopro_user_token", default=None)


async def call_backend(function, body, query="", binary=False):
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_ANON_KEY", "")
    token = request_token.get()
    if not url or not key or urlparse(url).scheme != "https":
        raise RuntimeError("请配置 MCP 的火山 BaaS 地址与 anon key")
    if not token:
        raise RuntimeError("MCP 调用必须提供登录用户 JWT")
    async with httpx.AsyncClient(timeout=150) as client:
        response = await client.post(f"{url}/functions/v1/{function}{query}",
                                     headers={"Authorization": f"Bearer {token}", "apikey": key},
                                     json=body)
        if not response.is_success:
            raise RuntimeError(f"业务 API 返回 HTTP {response.status_code}")
        if binary:
            return response.content
        data = response.json()
        if data.get("code", 0) != 0 or data.get("error"):
            raise RuntimeError(data.get("message") or "业务请求失败")
        return data.get("data", data)
