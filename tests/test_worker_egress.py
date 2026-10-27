"""Worker可信来源与实际连接地址绑定；不访问外网。"""
import importlib.util
import http.server
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))


class EgressTest(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(importlib.util.find_spec("egress"), "Worker缺少可信来源和连接绑定")
        import egress
        return egress

    def test_unlisted_media_and_foreign_upload_rejected_before_network(self):
        egress = self.module()
        client = egress.EgressClient("https://db.example", "media.example,cdn.example")
        self.addCleanup(client.close)
        with patch.object(client.session, "request") as request:
            for method, url in ((client.get, "https://other.example/a?private=secret"),
                                (client.put, "https://media.example/output"),
                                (client.post, "https://other.example/functions/v1/production-worker"),
                                (client.get, "https://db.example@other.example/input"),
                                (client.get, "https://db.example:444/input")):
                with self.assertRaises(egress.RenderError) as caught:
                    method(url)
                self.assertNotIn("secret", str(caught.exception))
            request.assert_not_called()
        self.assertFalse(client.session.trust_env)
        client.validate_media("https://media.example/a?token=original")
        client.validate_upload("https://db.example/storage/v1/object/upload/sign/videos/u/output?token=original")

    def test_connection_uses_validated_numeric_address_with_original_tls_hostname(self):
        egress = self.module()
        entries = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        connection = egress.PublicConnection("media.example", timeout=10)
        with patch.object(egress.socket, "getaddrinfo", return_value=entries) as resolve, \
                patch.object(egress.socket, "create_connection", return_value="connected-socket") as connect:
            self.assertEqual(connection._new_conn(), "connected-socket")
        self.assertEqual(resolve.call_count, 1)
        self.assertEqual(connect.call_args.args[0], ("93.184.216.34", 443))
        self.assertEqual(connection.host, "media.example", "TLS/Host保留原域名")

    def test_any_private_empty_or_mapped_dns_answer_stops_connection(self):
        egress = self.module()
        for addresses in ([], ["93.184.216.34", "127.0.0.1"], ["169.254.169.254"],
                          ["::ffff:127.0.0.1"], ["10.0.0.1"], ["100.64.0.1"], ["192.0.2.1"]):
            entries = [(socket.AF_INET6 if ":" in address else socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))
                       for address in addresses]
            with patch.object(egress.socket, "getaddrinfo", return_value=entries), \
                    patch.object(egress.socket, "create_connection") as connect:
                with self.assertRaises(egress.RenderError):
                    egress.PublicConnection("media.example", timeout=10)._new_conn()
                connect.assert_not_called()

    def test_explicit_https_policy_no_proxy_redirect_or_disabled_tls(self):
        egress = self.module()
        client = egress.EgressClient("https://db.example")
        self.addCleanup(client.close)
        with patch.object(client.session, "request", return_value="response") as request:
            self.assertEqual(client.get("https://db.example/input", stream=True), "response")
            self.assertFalse(request.call_args.kwargs["allow_redirects"])
            self.assertTrue(request.call_args.kwargs["verify"])
            self.assertEqual(request.call_args.kwargs["proxies"], {})
            with self.assertRaises(egress.RenderError):
                client.get("https://db.example/input", verify=False)
        for base, hosts in (("http://127.0.0.1", ""), ("https://db.example/path", ""),
                            ("https://db.example", "*.example"), ("https://db.example", "127.0.0.1")):
            with self.assertRaises(egress.RenderError):
                egress.EgressClient(base, hosts)

    def test_real_tls_host_sni_verification_and_redirect_rejection(self):
        egress = self.module()
        with tempfile.TemporaryDirectory() as directory:
            certificate, key = Path(directory) / "cert.pem", Path(directory) / "key.pem"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                            "-subj", "/CN=media.example", "-addext", "subjectAltName=DNS:media.example",
                            "-keyout", str(key), "-out", str(certificate)], check=True, capture_output=True, timeout=10)
            observed, sni = [], []
            class Handler(http.server.BaseHTTPRequestHandler):
                def log_message(self, *_):
                    pass
                def do_GET(self):
                    observed.append((self.headers["Host"], self.path))
                    self.send_response(302 if self.path == "/redirect" else 200)
                    if self.path == "/redirect":
                        self.send_header("Location", "https://other.example/private")
                    self.end_headers()
                    self.wfile.write(b"actual tls media")
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(str(certificate), str(key))
            context.set_servername_callback(lambda _socket, name, _context: sni.append(name))
            server.socket = context.wrap_socket(server.socket, server_side=True)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
            client = egress.EgressClient("https://db.example", "media.example")
            self.addCleanup(client.close)
            approved = []
            def local_fixture(address, *args, **kwargs):
                approved.append(address)
                connection = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                connection.settimeout(3)
                connection.connect(("127.0.0.1", server.server_port))
                return connection
            entries = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
            with patch.object(egress.socket, "getaddrinfo", return_value=entries), \
                    patch.object(egress.socket, "create_connection", local_fixture), \
                    patch.object(egress.requests.adapters, "DEFAULT_CA_BUNDLE_PATH", str(certificate)):
                response = client.get("https://media.example/video", timeout=3)
                self.assertEqual(response.content, b"actual tls media")
                response.close()
                response = client.get("https://media.example/redirect", timeout=3)
                self.assertEqual(response.status_code, 302)
                response.close()
                with self.assertRaises(egress.requests.exceptions.SSLError):
                    client.get("https://db.example/video", timeout=3)
            self.assertEqual(observed, [("media.example", "/video"), ("media.example", "/redirect")])
            self.assertTrue(all(address == ("93.184.216.34", 443) for address in approved))
            self.assertIn("media.example", sni)
            self.assertIn("db.example", sni)


if __name__ == "__main__":
    unittest.main(verbosity=2)
