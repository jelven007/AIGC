"""100个真实普通账号的自托管容量验收；凭据只保存在私有夹具文件。"""
import argparse
import asyncio
from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
import secrets
import ssl
import time
import uuid

import httpx


def save(path, value):
    temporary = path.with_suffix(".new")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
    os.replace(temporary, path)


def distribution(samples):
    ordered = sorted(samples)
    return {f"p{p}_ms": round(ordered[min(len(ordered)-1, int(len(ordered)*p/100))] * 1000, 2)
            for p in (50, 95, 99)} if ordered else {}


class Load:
    def __init__(self, args):
        self.args = args
        self.base = os.environ["SUPABASE_URL"].rstrip("/")
        self.anon, self.service = os.environ["SUPABASE_ANON_KEY"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        tls = ssl.create_default_context(cafile=os.environ.get("SELF_HOSTED_CA_FILE", "/certs/ca.crt"))
        self.client = httpx.AsyncClient(base_url=self.base, verify=tls, trust_env=False,
            follow_redirects=False, timeout=90, limits=httpx.Limits(max_connections=256, max_keepalive_connections=128))
        self.events = defaultdict(list)
        self.failures = []
        self.fixture = json.loads(args.fixture.read_text()) if args.fixture.exists() else {
            "run": "capacity-" + uuid.uuid4().hex[:12], "users": []}

    async def request(self, label, path, token=None, body=None, method=None, expected=(200, 201, 202),
                      raw=False, extra_headers=None):
        started = time.monotonic()
        headers = {"apikey": self.anon, "Authorization": "Bearer " + (token or self.anon)}
        status = 0
        try:
            response = await self.client.request(method or ("POST" if body is not None else "GET"), path,
                headers={**headers, **({"Content-Type": "video/mp4"} if isinstance(body, bytes) else {}),
                         **(extra_headers or {})},
                **({"content": body} if isinstance(body, bytes) else {"json": body} if body is not None else {}))
            status = response.status_code
            if status not in expected:
                # 只保留错误类别，不输出JWT、URL签名、用户或供应商凭据。
                try:
                    payload = response.json()
                    message = str(payload.get("error", payload.get("msg", "")))[:160]
                except ValueError:
                    message = "non-json response"
                raise RuntimeError(f"{label}: HTTP {status} {message}")
            return response.content if raw else response.json() if response.content else None
        except Exception as error:
            self.failures.append({"operation": label, "status": status, "type": type(error).__name__,
                                  "message": str(error) if isinstance(error, RuntimeError) else type(error).__name__})
            raise
        finally:
            self.events[label].append((time.monotonic() - started, status, status in expected))

    async def prepare(self):
        if self.fixture["users"]:
            raise RuntimeError("夹具已存在；使用已有夹具开展负载测试")
        # 只有建普通测试用户/套餐及清理使用service_role；所有业务用各自登录JWT。
        for index in range(self.args.users):
            email = f'{self.fixture["run"]}-{index}@example.com'
            password = secrets.token_urlsafe(24)
            user = await self.request("fixture-user", "/auth/v1/admin/users", self.service,
                {"email": email, "password": password, "email_confirm": True,
                 "user_metadata": {"username": f"capacity-{index}"}})
            self.fixture["users"].append({"id": user["id"], "email": email, "password": password})
            save(self.args.fixture, self.fixture)
        plans = await self.request("fixture-plan", "/rest/v1/plans?level=gte.3&select=id&limit=1", self.service)
        for user in self.fixture["users"]:
            await self.request("fixture-entitlement", "/rest/v1/user_plans?user_id=eq." + user["id"],
                self.service, {"plan_id": plans[0]["id"], "status": "active", "expires_at": None,
                               "credits_total": 100000, "credits_used": 0}, method="PATCH", expected=(204,))
        await self.logins()
        await self.seed()

    async def seed(self):
        async def product(user):
            result = await self.edge(user, "product-management", {"action": "save", "request_key": str(uuid.uuid4()),
                "items": [{"draft": {"name": self.fixture["run"], "category": "其他",
                    "currency": "CNY", "original_price": 20, "sale_price": 15, "stock": 2}}]}, "fixture-product")
            user["product"] = result["products"][0]
        await asyncio.gather(*(product(u) for u in self.fixture["users"]))
        save(self.args.fixture, self.fixture)

    async def refresh(self):
        async def product(user):
            result = await self.edge(user, "product-management", {"action": "list", "limit": 100}, "refresh-product")
            user["product"] = next(p for p in result["products"] if p["id"] == user["product"]["id"])
        await asyncio.gather(*(product(u) for u in self.fixture["users"]))
        save(self.args.fixture, self.fixture)

    async def logins(self):
        concurrency = asyncio.Semaphore(self.args.login_concurrency)
        async def login(user):
            async with concurrency:
                session = await self.request("login", "/auth/v1/token?grant_type=password",
                    body={"email": user["email"], "password": user["password"]})
            if session["user"]["id"] != user["id"] or session["user"].get("app_metadata", {}).get("role") == "admin":
                raise RuntimeError("普通账号真实身份不匹配")
            user["token"] = session["access_token"]
        results = await asyncio.gather(*(login(u) for u in self.fixture["users"]), return_exceptions=True)
        save(self.args.fixture, self.fixture)
        if any(isinstance(result, Exception) for result in results):
            raise RuntimeError("真实登录未全部成功")

    async def edge(self, user, name, body, label=None, expected=(200, 201, 202)):
        return await self.request(label or name + ":" + body["action"], "/functions/v1/" + name,
                                  user["token"], body, expected=expected)

    async def workload(self):
        users, stop_at = self.fixture["users"], time.monotonic() + self.args.seconds
        started = time.monotonic()
        async def person(index, user):
            await asyncio.sleep(index / len(users))
            turn = 0
            while time.monotonic() < stop_at:
                tick = time.monotonic()
                try:
                    action = turn % 8
                    if action == 0:
                        value = await self.edge(user, "product-management", {"action": "list", "limit": 20})
                        if any(p["user_id"] != user["id"] for p in value["products"]):
                            raise RuntimeError("商品跨用户数据泄漏")
                    elif action == 1:
                        await self.edge(user, "production-jobs", {"action": "list"})
                    elif action == 2:
                        value = await self.request("profile", "/rest/v1/profiles?select=id,username,role", user["token"])
                        if any(p["id"] != user["id"] for p in value):
                            raise RuntimeError("档案跨用户数据泄漏")
                    elif action == 3:
                        await self.edge(user, "model-settings", {"action": "catalog"})
                    elif action == 4:
                        product = user["product"]
                        value = await self.edge(user, "product-management", {"action": "save",
                            "request_key": str(uuid.uuid4()), "items": [{"id": product["id"],
                            "expected_updated_at": product["updated_at"],
                            "draft": {"name": self.fixture["run"], "category": "其他",
                                      "currency": "CNY", "sale_price": 15, "stock": turn}}]})
                        user["product"] = value["products"][0]
                    elif action == 5:
                        await self.request("balance", "/rest/v1/user_plans?select=user_id,credits_total,credits_used", user["token"])
                    elif action == 6:
                        await self.edge(user, "material-assets", {"action": "list"})
                    else:
                        await self.request("works", "/rest/v1/video_projects?select=id,user_id,title&limit=20", user["token"])
                except Exception as error:
                    if isinstance(error, RuntimeError) and "泄漏" in str(error):
                        self.failures.append({"operation": "isolation", "type": "AssertionError"})
                        raise
                turn += 1
                await asyncio.sleep(max(0, self.args.interval - (time.monotonic() - tick)))
        await asyncio.gather(*(person(i, u) for i, u in enumerate(users)))
        self.elapsed = time.monotonic() - started
        save(self.args.fixture, self.fixture)

    async def burst(self):
        source = self.args.media.read_bytes()
        if len(source) > 1024**2:
            raise RuntimeError("并行上传夹具须不超过1MiB，生成较小素材后再填充到精确1MiB")
        if len(source) < 1024**2:
            source += bytes(1024**2 - len(source))
        async def submit(user):
            uid = user["id"]
            path = f'{uid}/uploads/{self.fixture["run"]}.mp4'
            await self.request("upload-1MiB", "/storage/v1/object/materials/" + path, user["token"], source)
            user["media"] = path
            user["project"] = str(uuid.uuid4())
            await self.request("project-create", "/rest/v1/video_projects", user["token"], {
                "id": user["project"], "user_id": uid, "title": self.fixture["run"], "status": "draft", "duration": 10})
            body = {"action": "create", "kind": "render", "project_id": user["project"],
                "request_key": str(uuid.uuid4()), "input": {"version": 1, "title": self.fixture["run"],
                    "duration": 10, "height": 720, "fps": 30, "ratio": "16:9", "tracks": [
                        {"id": "source", "type": "video", "start": 0, "duration": 10,
                         "url": self.base + "/storage/v1/object/authenticated/materials/" + path},
                        {"id": "subtitle", "type": "text", "start": 0, "duration": 10,
                         "text": "100人并行业务真实合成", "fontSize": 40, "fontColor": "#ffffff"}]}}
            first = await self.edge(user, "production-jobs", body, "render-submit")
            repeated = await self.edge(user, "production-jobs", body, "render-repeat")
            if first["job"]["id"] != repeated["job"]["id"]:
                raise RuntimeError("任务提交不幂等")
            user["job"] = first["job"]["id"]
        started = time.monotonic()
        if self.args.action == "burst-check":
            if not all(u.get("job") and u.get("media") for u in self.fixture["users"]):
                raise RuntimeError("恢复核验要求每个账号都有已提交任务和素材")
        else:
            if any(u.get("job") for u in self.fixture["users"]):
                raise RuntimeError("已有提交任务，请使用burst-check继续核验")
            rows = await self.request("credit-before", "/rest/v1/user_plans?user_id=in.(" +
                ",".join(u["id"] for u in self.fixture["users"]) + ")&select=user_id,credits_used", self.service)
            logs = await self.request("credit-logs-before", "/rest/v1/credit_logs?user_id=in.(" +
                ",".join(u["id"] for u in self.fixture["users"]) + ")&select=user_id,amount,type", self.service)
            self.fixture["credit_before"] = {"balances": rows, "logs": logs}
            save(self.args.fixture, self.fixture)
            await asyncio.gather(*(submit(u) for u in self.fixture["users"]))
            self.burst_submit_seconds = round(time.monotonic() - started, 2)
            self.fixture["burst_submit_seconds"] = self.burst_submit_seconds
            save(self.args.fixture, self.fixture)
        self.burst_submit_seconds = self.fixture.get("burst_submit_seconds")
        # 持续API负载覆盖真实媒体执行期间。
        workload = asyncio.create_task(self.workload())
        remaining = {u["job"]: u for u in self.fixture["users"]}
        self.completed = []
        expected_costs = {}
        deadline = time.monotonic() + 600
        self.peak_running = 0
        while remaining and time.monotonic() < deadline:
            await asyncio.sleep(2)
            jobs = await self.request("queue-observe", "/rest/v1/production_jobs?user_id=in.(" +
                ",".join(u["id"] for u in self.fixture["users"]) + ")&select=id,status,created_at,completed_at,result,attempts,credit_cost", self.service)
            self.peak_running = max(self.peak_running, sum(j["status"] == "running" for j in jobs))
            for job in jobs:
                if job["status"] in ("failed", "cancelled", "unknown"):
                    raise RuntimeError("真实渲染未完成：" + job["status"])
                if job["status"] == "completed" and job["id"] in remaining:
                    user = remaining.pop(job["id"])
                    expected_costs[user["id"]] = job["credit_cost"]
                    result = await self.edge(user, "production-jobs", {"action": "query", "job_id": job["id"]}, "render-query")
                    output = result["job"]["result"]
                    # 真实签名读取成片，由原普通用户获取地址；存储路径/签名不写公开报告。
                    url = output.get("video_url") or output.get("url")
                    if not url:
                        raise RuntimeError("缺少真实成片地址")
                    data = await self.request("output-read", url, user["token"], raw=True)
                    if len(data) < 1000 or b"ftyp" not in data[:32]:
                        raise RuntimeError("成片不是实际MP4")
                    self.completed.append({"id": job["id"], "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                        "attempts": job["attempts"], "created_at": job["created_at"], "completed_at": job["completed_at"],
                        "duration": output["duration"], "resolution": output["resolution"]})
        self.render_total_seconds = round(time.monotonic() - started, 2)
        await workload
        if remaining:
            raise RuntimeError("媒体积压未在600秒内排空")
        # 两两检查产品/档案/私有素材和作品不能跨账号读取。
        for index, user in enumerate(self.fixture["users"]):
            other = self.fixture["users"][(index + 1) % len(self.fixture["users"])]
            rows = await self.request("rls-product", "/rest/v1/products?id=eq." + user["product"]["id"], other["token"])
            if rows:
                raise RuntimeError("跨账号商品可见")
            await self.request("rls-media", "/storage/v1/object/authenticated/materials/" + user["media"],
                               other["token"], expected=(400, 403, 404))
        self.isolation_pairs = len(self.fixture["users"])
        balances = await self.request("credit-observe", "/rest/v1/user_plans?user_id=in.(" +
            ",".join(u["id"] for u in self.fixture["users"]) + ")&select=user_id,credits_used", self.service)
        logs = await self.request("credit-logs", "/rest/v1/credit_logs?user_id=in.(" +
            ",".join(u["id"] for u in self.fixture["users"]) + ")&select=user_id,amount,type", self.service)
        self.credit_evidence = {"balances": balances, "logs": logs}
        used = {v["user_id"]: v["credits_used"] for v in balances}
        before = self.fixture.get("credit_before", {"balances": [], "logs": []})
        prior_used = {v["user_id"]: v["credits_used"] for v in before["balances"]}
        totals = defaultdict(int)
        prior_totals = defaultdict(int)
        for row in logs:
            if row["type"] == "deduct":
                totals[row["user_id"]] += abs(row["amount"])
        for row in before["logs"]:
            if row["type"] == "deduct":
                prior_totals[row["user_id"]] += abs(row["amount"])
        if any(used[u["id"]] - prior_used.get(u["id"], 0) != totals[u["id"]] - prior_totals[u["id"]]
               or used[u["id"]] - prior_used.get(u["id"], 0) != expected_costs[u["id"]]
               or sum(row["type"] == "deduct" and row["user_id"] == u["id"] for row in logs)
               - sum(row["type"] == "deduct" and row["user_id"] == u["id"] for row in before["logs"])
               != int(expected_costs[u["id"]] > 0)
               for u in self.fixture["users"]):
            raise RuntimeError("积分余额和消费流水不一致")
        self.credit_idempotent = True
        self.credit_expected_total = sum(expected_costs.values())

    async def cleanup(self):
        for user in self.fixture["users"]:
            jobs = await self.request("cleanup-jobs-observe",
                "/rest/v1/production_jobs?user_id=eq." + user["id"] + "&select=status", self.service)
            if any(job["status"] not in ("completed", "failed", "cancelled") for job in jobs):
                raise RuntimeError("临时账号仍有未结案任务，禁止清理")
            for bucket in ("materials", "videos", "thumbnails"):
                # 只删除当前夹具uid的文件，不扫描或删除原有账号素材。
                async def walk(prefix):
                    rows = await self.request("cleanup-list", f"/storage/v1/object/list/{bucket}", self.service,
                        {"prefix": prefix, "limit": 1000})
                    paths = []
                    for row in rows:
                        name = prefix + "/" + row["name"]
                        if row.get("id"):
                            paths.append(name)
                        else:
                            paths.extend(await walk(name))
                    return paths
                paths = await walk(user["id"])
                if paths:
                    await self.request("cleanup-media", f"/storage/v1/object/{bucket}", self.service,
                        {"prefixes": paths}, method="DELETE", expected=(200, 404))
            await self.request("cleanup-jobs", "/rest/v1/production_jobs?user_id=eq." + user["id"],
                self.service, method="DELETE", expected=(204,))
            await self.request("cleanup-projects", "/rest/v1/video_projects?user_id=eq." + user["id"],
                self.service, method="DELETE", expected=(204,))
            await self.request("cleanup-user", "/auth/v1/admin/users/" + user["id"], self.service,
                               method="DELETE", expected=(200, 204, 404))
        self.fixture["cleaned"] = True
        save(self.args.fixture, self.fixture)

    async def mcp(self):
        async def call(user, method, params=None):
            raw = await self.request("mcp:" + method, "/mcp", user["token"],
                {"jsonrpc": "2.0", "id": 1, "method": method, **({"params": params} if params else {})},
                raw=True, extra_headers={"Accept": "application/json, text/event-stream"})
            events = [json.loads(line[6:]) for line in raw.decode().splitlines() if line.startswith("data: ")]
            result = events[-1] if events else json.loads(raw)
            if result.get("error") or result.get("result", {}).get("isError"):
                raise RuntimeError("MCP协议或业务调用失败")
            return result
        users = self.fixture["users"]
        await asyncio.gather(*(call(u, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
            "clientInfo": {"name": "capacity100", "version": "1"}}) for u in users))
        tools = await asyncio.gather(*(call(u, "tools/list") for u in users))
        if any(len(r["result"]["tools"]) != 59 for r in tools):
            raise RuntimeError("MCP工具目录不完整")
        await asyncio.gather(*(call(u, "tools/call", {"name": "list_production_jobs", "arguments": {}}) for u in users))

    async def guard(self):
        user = self.fixture["users"][0]
        await asyncio.gather(*(self.request("per-credential-guard", "/functions/v1/model-settings",
            user["token"], {"action": "catalog"}, raw=True, expected=(200, 429)) for _ in range(50)))
        self.guard_rejected = sum(code == 429 for _, code, _ in self.events["per-credential-guard"])
        if not self.guard_rejected:
            raise RuntimeError("同凭据突发50请求未触发限流")

    def summary(self, passed):
        operations = {k: {"requests": len(v), "errors": sum(not ok for _, _, ok in v),
            **distribution([s for s, _, _ in v]), "statuses": {
                str(status): sum(code == status for _, code, _ in v) for status in {code for _, code, _ in v}}}
            for k, v in self.events.items()}
        business = [v for k, samples in self.events.items()
                    if k in ("profile", "balance", "works") or k.startswith(("product-management:", "production-jobs:", "model-settings:", "material-assets:"))
                    for v in samples]
        return {"passed": passed, "phase": self.args.action, "origin": self.base,
            "measurement_location": "ECS HTTPS gateway", "users": len(self.fixture["users"]),
            "elapsed_seconds": round(getattr(self, "elapsed", 0), 2), "operations": operations,
            "business": {"requests": len(business), "errors": sum(not ok for _, _, ok in business),
                         **distribution([s for s, _, _ in business])},
            "failures": self.failures[:20], "peak_running": getattr(self, "peak_running", None),
            "render_completed": getattr(self, "completed", []),
            "burst_submit_seconds": getattr(self, "burst_submit_seconds", None),
            "render_total_seconds": getattr(self, "render_total_seconds", None),
            "credit_idempotent": getattr(self, "credit_idempotent", None),
            "credit_expected_total": getattr(self, "credit_expected_total", None),
            "guard_rejected": getattr(self, "guard_rejected", None),
            "isolation_pairs": getattr(self, "isolation_pairs", 0)}


async def main(args):
    load = Load(args)
    passed = False
    try:
        await getattr(load, {"load": "workload", "burst-check": "burst"}.get(args.action, args.action))()
        passed = not load.failures
        if args.action in ("load", "burst", "burst-check"):
            result = load.summary(passed)
            business = result["business"]
            passed = passed and business["requests"] > 0 and business["errors"] / business["requests"] < .01 and business["p95_ms"] <= 2000
    finally:
        pending = [task for task in asyncio.all_tasks() if task is not asyncio.current_task()]
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        await load.client.aclose()
        save(args.output, load.summary(passed))
        print(json.dumps(load.summary(passed), ensure_ascii=False), flush=True)
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "seed", "refresh", "load", "burst", "burst-check", "cleanup", "logins", "mcp", "guard"))
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--users", type=int, default=100)
    parser.add_argument("--login-concurrency", type=int, default=100)
    parser.add_argument("--seconds", type=int, default=180)
    parser.add_argument("--interval", type=float, default=1)
    parser.add_argument("--media", type=Path)
    asyncio.run(main(parser.parse_args()))
