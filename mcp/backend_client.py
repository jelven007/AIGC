"""只调用业务 API；用户 JWT/有权限的 API Key 按请求隔离，不重发写请求。"""
import base64
from contextvars import ContextVar
import json
import os
from urllib.parse import urlparse
import httpx

request_token = ContextVar("shopro_user_token", default=None)
BUSINESS_FUNCTIONS = frozenset({
    "text-generation", "video-jobs", "production-jobs", "batch-video-jobs",
    "platform-accounts", "platform-publish", "knowledge-base", "market-intelligence", "product-management",
})
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class BackendError(RuntimeError):
    def __init__(self, status, request_key=None):
        self.status = status
        self.request_key = request_key
        message = {
            400: "业务参数或素材无效", 401: "用户凭据过期或无效", 402: "积分不足",
            403: "缺少业务权限", 404: "当前用户的对象不存在",
            409: "参数、价格或配置冲突，请核对原请求",
            410: "旧接口已停用", 424: "所需模型或供应商未启用",
            429: "请求频率或队列超过限额",
        }.get(status, "业务结果待确认，请查询原请求；不要更换请求标识")
        super().__init__(f"{message}（HTTP {status}）"
                         + (f"；request_key={request_key}" if request_key else ""))


def validate_user_token(token):
    if not isinstance(token, str) or not token or len(token) > 16384 or any(c.isspace() for c in token):
        raise ValueError("需要用户 JWT 或有权限的业务 API Key")
    # 这里只拒绝明显的特权凭据，签名、撤销、用户状态和 scopes 仍由业务 API 验证。
    if token.count(".") == 2:
        try:
            payload = token.split(".")[1]
            role = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))).get("role")
        except (ValueError, TypeError, AttributeError):
            role = None
        if role in ("service_role", "supabase_admin", "anon"):
            raise ValueError("MCP 必须使用业务用户凭据")
    return token


async def call_backend(function, body):
    if function not in BUSINESS_FUNCTIONS:
        raise ValueError("MCP 不接受该业务接口")
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_ANON_KEY", "")
    token = request_token.get()
    parsed = urlparse(url)
    if not key or parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
        raise RuntimeError("请配置 MCP 的 BaaS HTTPS 根地址与 anon key")
    if not token:
        raise RuntimeError("MCP 调用必须提供业务用户凭据")
    validate_user_token(token)
    if token == key:
        raise ValueError("anon key 不能作为业务用户凭据")
    request_key = body.get("request_key")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(150, connect=10), follow_redirects=False) as client:
            async with client.stream("POST", f"{url}/functions/v1/{function}",
                                     headers={"Authorization": f"Bearer {token}", "apikey": key},
                                     json=body) as response:
                if not response.is_success:
                    raise BackendError(response.status_code, request_key)
                chunks, size = [], 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise BackendError(502, request_key)
                    chunks.append(chunk)
                data = json.loads(b"".join(chunks))
        if not isinstance(data, dict):
            raise BackendError(502, request_key)
        if data.get("code", 0) != 0 or data.get("error"):
            raise BackendError(502, request_key)
        return data.get("data", data)
    except (httpx.HTTPError, ValueError):
        raise BackendError(503, request_key) from None
