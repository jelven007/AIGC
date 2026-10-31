"""共享标准库第一方TLS策略；调度器绑定数字IP，MCP使用专用证书上下文。"""
import http.client
import ipaddress
import os
from pathlib import Path
import socket
import ssl
import urllib.request
from urllib.parse import urlsplit


def backend_policy(endpoint):
    origin = os.environ.get("SELF_HOSTED_BACKEND_ORIGIN", "")
    if not origin:
        return None
    try:
        backend, url = urlsplit(origin), urlsplit(endpoint)
        if (backend.scheme != "https" or backend.path or backend.query or backend.fragment
                or backend.username or backend.password or not backend.hostname
                or url.scheme != backend.scheme or url.netloc != backend.netloc
                or url.username or url.password or url.fragment):
            raise ValueError()
        addresses = frozenset(str(ipaddress.ip_address(value.strip())) for value in
                              os.environ.get("SELF_HOSTED_BACKEND_IPS", "").split(",") if value.strip())
        if not addresses or any(ipaddress.ip_address(value).is_loopback
            or ipaddress.ip_address(value).is_link_local or ipaddress.ip_address(value).is_unspecified
            or ipaddress.ip_address(value).is_multicast or getattr(ipaddress.ip_address(value), "ipv4_mapped", None)
            for value in addresses):
            raise ValueError()
        context = ssl.create_default_context()
        ca = os.environ.get("SELF_HOSTED_CA_FILE")
        if ca:
            if not Path(ca).is_file() or Path(ca).is_symlink():
                raise ValueError()
            context.load_verify_locations(ca)
        return backend.hostname.lower(), backend.port or 443, addresses, context
    except (ValueError, OSError):
        raise ValueError("第一方地址、固定IP或TLS证书配置无效") from None


def pinned_connection(host, port, addresses):
    class Connection(http.client.HTTPSConnection):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._create_connection = self.connect_pinned

        def connect_pinned(self, target, timeout=socket._GLOBAL_DEFAULT_TIMEOUT, source_address=None):
            if target != (host, port):
                raise OSError("第一方连接目标不匹配")
            resolved = list(dict.fromkeys(entry[4][0] for entry in
                            socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)))
            if not resolved or not all(value in addresses for value in resolved):
                raise OSError("第一方DNS与固定地址不匹配")
            for value in resolved:
                try:
                    return socket.create_connection((value, port), timeout, source_address=source_address)
                except OSError:
                    continue
            raise OSError("第一方连接暂不可用")
    return Connection


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def backend_opener(endpoint):
    policy = backend_policy(endpoint)
    handlers = [urllib.request.ProxyHandler({}), NoRedirect]
    if policy:
        host, port, addresses, context = policy
        connection = pinned_connection(host, port, addresses)
        class Handler(urllib.request.HTTPSHandler):
            def https_open(self, req):
                return self.do_open(connection, req, context=context)
        handlers.append(Handler(context=context))
    return urllib.request.build_opener(*handlers)


def backend_ssl_context(endpoint):
    policy = backend_policy(endpoint)
    if not policy:
        return True
    host, port, addresses, context = policy
    resolved = [entry[4][0] for entry in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)]
    if not resolved or any(value not in addresses for value in resolved):
        raise ValueError("第一方DNS与固定地址不匹配")
    return context
