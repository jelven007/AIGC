"""旧通用模型代理退役，客户端统一使用已认证的业务 Edge Functions。"""
async def app(scope, receive, send):
    if scope["type"] != "http":
        return
    await send({"type": "http.response.start", "status": 410,
                "headers": [(b"content-type", b"application/json")]})
    await send({"type": "http.response.body",
                "body": b'{"error":"Use authenticated BaaS Edge Functions"}'})
