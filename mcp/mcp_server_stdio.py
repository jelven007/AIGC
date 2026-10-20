import os
from mcp_server import mcp, logger
from backend_client import request_token

if __name__ == "__main__":
    token = os.environ.get("SUPABASE_USER_JWT")
    if not token:
        raise RuntimeError("请配置登录用户的 SUPABASE_USER_JWT")
    request_token.set(token)
    logger.info("Starting Shopro AI MCP Server (stdio transport)")
    mcp.run(transport="stdio")
