"""常驻 MCP HTTP 服务，Bearer 为业务用户 JWT 或受限 API Key。"""
from contextlib import asynccontextmanager
import os
from starlette.applications import Starlette
from starlette.routing import Mount
import uvicorn
from backend_client import request_token, validate_user_token
from mcp_shopro_server import mcp

hosts = [host.strip() for host in os.environ.get("MCP_ALLOWED_HOSTS", "localhost:*,127.0.0.1:*").split(",")]
mcp.settings.transport_security.enable_dns_rebinding_protection = True
mcp.settings.transport_security.allowed_hosts = hosts
protocol_app = mcp.streamable_http_app()


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


app = Starlette(routes=[Mount("/", app=UserTokenMiddleware(protocol_app))], lifespan=lifespan)
if __name__ == "__main__":
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8080")))
