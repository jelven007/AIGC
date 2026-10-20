"""兼容旧代理路径；MCP 在 ECS 上运行常驻 ASGI 服务。"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mcp"))
from http_server import app
