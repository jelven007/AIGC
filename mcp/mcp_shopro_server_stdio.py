import os
from mcp_shopro_server import mcp, logger

if __name__ == "__main__":
    logger.info("Starting Shopro AI Full System MCP Server (stdio transport)")
    mcp.run(transport="stdio")
