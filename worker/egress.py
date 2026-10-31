"""仅可信HTTPS来源；DNS校验绑定实际socket，保留原TLS域名。"""
import ipaddress
import os
from pathlib import Path
import re
import socket
from urllib.parse import urlsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPSConnection
from urllib3.connectionpool import HTTPSConnectionPool
from urllib3.exceptions import NewConnectionError
from render import RenderError


def parsed_https(value, *, port=443):
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or (parsed.port or 443) != port or parsed.fragment):
            raise ValueError()
        return parsed
    except ValueError:
        raise RenderError("Worker地址必须为无凭据的HTTPS") from None


class PublicConnection(HTTPSConnection):
    def allowed_address(self, value):
        address = ipaddress.ip_address(value)
        return address.is_global and getattr(address, "ipv4_mapped", None) is None

    def _new_conn(self):
        try:
            entries = socket.getaddrinfo(self.host, self.port or 443, type=socket.SOCK_STREAM)
        except OSError:
            raise NewConnectionError(self, "公网DNS暂时不可用") from None
        addresses = list(dict.fromkeys(entry[4][0] for entry in entries))
        if not addresses or not all(self.allowed_address(value) for value in addresses):
            raise RenderError("Worker连接不能指向内网或保留地址")
        for address in addresses:
            try:
                # 数字地址不会重新解析原域名；urllib3随后使用self.host完成证书/SNI校验。
                return socket.create_connection((address, self.port or 443), self.timeout,
                                                source_address=self.source_address)
            except OSError:
                continue
        raise NewConnectionError(self, "公网连接暂时不可用") from None


class PublicPool(HTTPSConnectionPool):
    ConnectionCls = PublicConnection


class PublicAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        super().init_poolmanager(*args, **kwargs)
        self.poolmanager.pool_classes_by_scheme = {"https": PublicPool}


def backend_policy(backend):
    """部署方仅授予一个精确 origin、端口和地址集合；不信任响应内的地址。"""
    origin = os.environ.get("SELF_HOSTED_BACKEND_ORIGIN", "").rstrip("/")
    if not origin or backend.rstrip("/") != origin:
        return None
    try:
        parsed = urlsplit(origin)
        parsed = parsed_https(origin, port=parsed.port or 443)
        if parsed.path or parsed.query:
            raise ValueError()
        addresses = frozenset(str(ipaddress.ip_address(part.strip())) for part in
                              os.environ.get("SELF_HOSTED_BACKEND_IPS", "").split(",") if part.strip())
        if not addresses or any(ipaddress.ip_address(value).is_loopback
                                or ipaddress.ip_address(value).is_link_local
                                or ipaddress.ip_address(value).is_multicast
                                or ipaddress.ip_address(value).is_unspecified
                                or getattr(ipaddress.ip_address(value), "ipv4_mapped", None)
                                for value in addresses):
            raise ValueError()
        ca = os.environ.get("SELF_HOSTED_CA_FILE", "")
        if ca and (not Path(ca).is_file() or Path(ca).is_symlink()):
            raise ValueError()
        return parsed, addresses, ca or True
    except (ValueError, OSError):
        raise RenderError("自托管HTTPS地址、固定IP或CA配置无效") from None


def backend_adapter(host, port, addresses):
    class BackendConnection(PublicConnection):
        def allowed_address(self, value):
            return (self.host.lower() == host and (self.port or 443) == port
                    and str(ipaddress.ip_address(value)) in addresses)

    class BackendPool(HTTPSConnectionPool):
        ConnectionCls = BackendConnection

    class BackendAdapter(HTTPAdapter):
        def init_poolmanager(self, *args, **kwargs):
            super().init_poolmanager(*args, **kwargs)
            self.poolmanager.pool_classes_by_scheme = {"https": BackendPool}

    return BackendAdapter(max_retries=0)


class EgressClient:
    def __init__(self, backend, media_hosts=""):
        policy = backend_policy(backend)
        parsed = policy[0] if policy else parsed_https(backend)
        if parsed.path not in ("", "/") or parsed.query:
            raise RenderError("Worker后端应为项目HTTPS根地址")
        self.backend = parsed.hostname.lower()
        self.port = parsed.port or 443
        self.backend_origin = f"https://{parsed.netloc.lower()}"
        self.ca = policy[2] if policy else True
        self.media_hosts = {self.backend}
        for host in filter(None, (part.strip().lower() for part in media_hosts.split(","))):
            if (len(host) > 253 or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host)
                    or "." not in host or ".." in host or re.fullmatch(r"[\d.]+", host)):
                raise RenderError("可信素材域名须逐项填写完整域名")
            self.media_hosts.add(host)
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.mount("https://", PublicAdapter(max_retries=0))
        if policy:
            # 请求先校验精确origin；根地址探针和带路径请求共用同一个连接池。
            self.session.mount(self.backend_origin, backend_adapter(self.backend, self.port, policy[1]))

    def is_backend(self, url):
        parsed = parsed_https(url, port=self.port)
        return f"https://{parsed.netloc.lower()}" == self.backend_origin

    def validate_media(self, url):
        if self.is_backend_candidate(url):
            self.validate_upload(url)
            return url
        if parsed_https(url).hostname.lower() not in self.media_hosts:
            raise RenderError("素材来源未列入Worker可信域名")
        return url

    def validate_upload(self, url):
        if not self.is_backend(url):
            raise RenderError("Worker上传及租约仅允许原项目域名")
        return url

    def is_backend_candidate(self, url):
        try:
            return urlsplit(url).hostname.lower() == self.backend
        except (ValueError, AttributeError):
            return False

    def request(self, method, url, **kwargs):
        (self.validate_media if method == "GET" else self.validate_upload)(url)
        if kwargs.get("verify", True) is not True or kwargs.get("allow_redirects", False) or kwargs.get("proxies"):
            raise RenderError("Worker连接要求TLS校验、禁止代理和跳转")
        verify = self.ca if self.is_backend_candidate(url) else True
        return self.session.request(method, url, **{**kwargs, "verify": verify, "allow_redirects": False, "proxies": {}})

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def put(self, url, **kwargs):
        return self.request("PUT", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def close(self):
        self.session.close()
