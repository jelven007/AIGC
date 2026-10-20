"""兼容旧启动路径，统一复用业务 API 工具。"""
from mcp_shopro_server import mcp, logger

if __name__ == "__main__":
    from http_server import app
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8080)
