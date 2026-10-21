"""从真实 SDK 导出工具协议；--check 检测静态目录漂移。"""
import argparse
import asyncio
import json
from pathlib import Path
from mcp_shopro_server import mcp


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    tools = await mcp.list_tools()
    document = {"tools": [tool.model_dump(mode="json", exclude_none=True) for tool in tools]}
    path = Path(__file__).with_name("tools.json")
    if args.check:
        if json.loads(path.read_text()) != document:
            raise SystemExit("MCP tools.json 与 SDK 定义不同，请运行 python mcp/export_tools.py")
        print(f"PASS MCP 工具目录与 SDK 一致：{len(tools)} 个工具")
    else:
        path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n")
        print(f"已导出 {len(tools)} 个工具")


if __name__ == "__main__":
    asyncio.run(main())
