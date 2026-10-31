"""常驻 MCP HTTP 服务，Bearer 为业务用户 JWT 或受限 API Key。"""
from contextlib import asynccontextmanager
import asyncio
import hashlib
import logging
import os
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
import uvicorn
from backend_client import request_token, validate_user_token
from mcp_shopro_server import mcp
from host_config import parse_allowed_hosts

hosts = parse_allowed_hosts(os.environ.get("MCP_ALLOWED_HOSTS", "localhost,localhost:8080,127.0.0.1,127.0.0.1:8080"))
max_concurrent = int(os.environ.get("MCP_MAX_CONCURRENT", "16"))
if not 1 <= max_concurrent <= 256:
    raise ValueError("MCP_MAX_CONCURRENT must be between 1 and 256")
mcp.settings.transport_security.enable_dns_rebinding_protection = True
mcp.settings.transport_security.allowed_hosts = hosts
protocol_app = mcp.streamable_http_app()


async def reject(send, status):
    await send({"type": "http.response.start", "status": status, "headers": [
        (b"content-type", b"application/json"), (b"cache-control", b"no-store")]})
    await send({"type": "http.response.body",
                "body": b'{"error":"request unavailable; retain original request_key and query its status"}'})


class ResourceLimitsMiddleware:
    def __init__(self, app, max_concurrent=16, max_per_user=4, max_body=256 * 1024,
                 body_timeout=10, request_timeout=165):
        self.app = app
        self.max_concurrent, self.max_per_user, self.max_body = max_concurrent, max_per_user, max_body
        self.body_timeout, self.request_timeout = body_timeout, request_timeout
        self.active = {}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        user = hashlib.sha256(request_token.get().encode()).hexdigest()
        if sum(self.active.values()) >= self.max_concurrent or self.active.get(user, 0) >= self.max_per_user:
            return await reject(send, 429)
        self.active[user] = self.active.get(user, 0) + 1
        started = False
        try:
            body, size = [], 0
            async with asyncio.timeout(self.body_timeout):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    chunk = message.get("body", b"")
                    size += len(chunk)
                    if size > self.max_body:
                        return await reject(send, 413)
                    body.append(chunk)
                    if not message.get("more_body"):
                        break

            consumed = False
            async def replay():
                nonlocal consumed
                if not consumed:
                    consumed = True
                    return {"type": "http.request", "body": b"".join(body), "more_body": False}
                return await receive()

            async def guarded_send(message):
                nonlocal started
                if message["type"] == "http.response.start":
                    started = True
                await send(message)

            try:
                async with asyncio.timeout(self.request_timeout):
                    await self.app(scope, replay, guarded_send)
            except Exception as cause:
                logging.getLogger("shopro-mcp").warning("MCP request interrupted: %s", type(cause).__name__)
                if not started:
                    await reject(send, 503)
                else:
                    await send({"type": "http.response.body", "body": b"", "more_body": False})
        except TimeoutError:
            await reject(send, 408)
        finally:
            self.active[user] -= 1
            if not self.active[user]:
                del self.active[user]


class UserTokenMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        auth = headers.get(b"authorization", b"").decode("latin-1")
        try:
            if not auth.lower().startswith("bearer "):
                raise ValueError("missing bearer")
            credential = validate_user_token(auth[7:].strip())
        except ValueError:
            await send({"type": "http.response.start", "status": 401,
                        "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")]})
            await send({"type": "http.response.body", "body": b'{"error":"business user credential required"}'})
            return
        token = request_token.set(credential)
        try:
            await self.app(scope, receive, send)
        finally:
            request_token.reset(token)


@asynccontextmanager
async def lifespan(app):
    async with mcp.session_manager.run():
        yield


async def health(_request):
    return JSONResponse({"ok": True, "scope": "process"}, headers={"Cache-Control": "no-store"})


app = Starlette(routes=[Route("/healthz", health),
                       Mount("/", app=UserTokenMiddleware(ResourceLimitsMiddleware(
                           protocol_app, max_concurrent=max_concurrent)))], lifespan=lifespan)
if __name__ == "__main__":
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8080")),
                limit_concurrency=max(64, max_concurrent * 2), backlog=max(64, max_concurrent * 2),
                timeout_keep_alive=5, timeout_graceful_shutdown=170,
                proxy_headers=False, access_log=False)
