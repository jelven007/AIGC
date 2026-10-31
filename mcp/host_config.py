"""HTTP Host白名单仅接受精确名称和端口，不接受URL或通配符。"""
import re


def parse_allowed_hosts(value):
    hosts = [host.strip().lower() for host in value.split(",")]
    for host in hosts:
        match = re.fullmatch(r"([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?", host)
        if not match or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label)
                            or len(label) > 63 for label in match[1].split(".")):
            raise ValueError("MCP_ALLOWED_HOSTS必须为精确Host，禁止空值、URL和通配符")
        if len(match[1]) > 253 or match[2] and not 1 <= int(match[2]) <= 65535:
            raise ValueError("MCP_ALLOWED_HOSTS的主机名或端口无效")
    if len(hosts) > 32 or len(set(hosts)) != len(hosts):
        raise ValueError("MCP_ALLOWED_HOSTS最多32项且不能重复")
    return hosts
