"""开发脚本与独立调度镜像使用同一个第一方TLS实现。"""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mcp"))
from backend_tls import backend_opener, backend_policy, backend_ssl_context, pinned_connection
