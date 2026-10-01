import os
from mcp_server import mcp, logger

if __name__ == "__main__":
    logger.info("Starting Shopro AI MCP Server (stdio transport)")
    mcp.run(transport="stdio")
