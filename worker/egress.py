"""仅可信HTTPS来源；DNS校验绑定实际socket，保留原TLS域名。"""
import ipaddress
import re
import socket
from urllib.parse import urlsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPSConnection
from urllib3.connectionpool import HTTPSConnectionPool
from urllib3.exceptions import NewConnectionError
from render import RenderError


def parsed_https(value):
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.port not in (None, 443) or parsed.fragment):
            raise ValueError()
        return parsed
    except ValueError:
        raise RenderError("Worker地址必须为无凭据的HTTPS") from None


class PublicConnection(HTTPSConnection):
    def _new_conn(self):
        try:
            entries = socket.getaddrinfo(self.host, self.port or 443, type=socket.SOCK_STREAM)
        except OSError:
            raise NewConnectionError(self, "公网DNS暂时不可用") from None
        addresses = list(dict.fromkeys(entry[4][0] for entry in entries))
        def public(value):
            address = ipaddress.ip_address(value)
            return address.is_global and getattr(address, "ipv4_mapped", None) is None
        if not addresses or not all(public(value) for value in addresses):
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


class EgressClient:
    def __init__(self, backend, media_hosts=""):
        parsed = parsed_https(backend)
        if parsed.path not in ("", "/") or parsed.query:
            raise RenderError("Worker后端应为项目HTTPS根地址")
        self.backend = parsed.hostname.lower()
        self.media_hosts = {self.backend}
        for host in filter(None, (part.strip().lower() for part in media_hosts.split(","))):
            if (len(host) > 253 or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host)
                    or "." not in host or ".." in host or re.fullmatch(r"[\d.]+", host)):
                raise RenderError("可信素材域名须逐项填写完整域名")
            self.media_hosts.add(host)
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.mount("https://", PublicAdapter(max_retries=0))

    def validate_media(self, url):
        if parsed_https(url).hostname.lower() not in self.media_hosts:
            raise RenderError("素材来源未列入Worker可信域名")
        return url

    def validate_upload(self, url):
        if parsed_https(url).hostname.lower() != self.backend:
            raise RenderError("Worker上传及租约仅允许原项目域名")
        return url

    def request(self, method, url, **kwargs):
        (self.validate_media if method == "GET" else self.validate_upload)(url)
        if kwargs.get("verify", True) is not True or kwargs.get("allow_redirects", False) or kwargs.get("proxies"):
            raise RenderError("Worker连接要求TLS校验、禁止代理和跳转")
        return self.session.request(method, url, **{**kwargs, "verify": True, "allow_redirects": False, "proxies": {}})

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def put(self, url, **kwargs):
        return self.request("PUT", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def close(self):
        self.session.close()
