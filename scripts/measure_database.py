#!/usr/bin/env python3
"""真实 PG16 隔离容量测量；仅创建并删除本工具的容器，零目标环境访问。"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
USER = "70000000-0000-4000-8000-000000000001"
VERSION = "71000000-0000-4000-8000-000000000001"
QUERY = "ARRAY(SELECT (1+sin(n*0.031))::float8 FROM generate_series(1,1536) n)"


class Database:
    def __init__(self):
        self.name = f"shoproai-capacity-{uuid.uuid4().hex[:10]}"
        self.started = False

    def command(self):
        return ["docker", "exec", "-i", self.name, "psql", "-U", "postgres", "-d", "postgres",
                "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]

    def sql(self, statement, timeout=60):
        result = subprocess.run(self.command(), input=f"SET statement_timeout='50s';\n{statement}",
                                text=True, capture_output=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    def start(self, through):
        subprocess.run(["docker", "run", "-d", "--name", self.name,
                        "--label", "shoproai.purpose=capacity-test", "--memory", "2g", "--cpus", "2",
                        "-e", "POSTGRES_PASSWORD=isolated_capacity_only", "postgres:16"],
                       check=True, capture_output=True, timeout=60)
        self.started = True
        for _ in range(60):
            if subprocess.run(["docker", "exec", self.name, "pg_isready", "-h", "127.0.0.1", "-t", "1"],
                              capture_output=True, timeout=5).returncode == 0:
                break
            time.sleep(0.25)
        else:
            raise RuntimeError("隔离数据库未就绪")
        self.sql((ROOT / "tests/db/bootstrap.sql").read_text())
        applied = []
        for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            if migration.name.startswith(("00018_", "00019_")) or int(migration.name[:5]) > through:
                continue
            self.sql("BEGIN;\n" + migration.read_text() + "\nCOMMIT;")
            applied.append({"name": migration.name, "sha256": hashlib.sha256(migration.read_bytes()).hexdigest()})
        self.sql(f"""
          INSERT INTO plans(name,price,credits,level) VALUES('容量夹具免费',0,100000,0);
          INSERT INTO model_configs(slot) VALUES('embedding.primary') ON CONFLICT DO NOTHING;
          INSERT INTO model_config_versions(id,slot,settings,key_ciphertext)
            VALUES('{VERSION}','embedding.primary','{{"model":"capacity-fixture"}}','isolated_not_a_key');
          UPDATE model_configs SET current_version_id='{VERSION}',enabled=true WHERE slot='embedding.primary';
        """)
        return applied

    def add_owner(self, number):
        owner = f"70000000-0000-4000-8000-{number:012d}"
        job = f"72000000-0000-4000-8000-{number:012d}"
        started = time.monotonic()
        self.sql(f"""
          INSERT INTO auth.users(id,email) VALUES('{owner}','capacity-{number}@fixture.example');
          INSERT INTO products(id,user_id,name,category,created_at,original_price)
          SELECT md5('{owner}-product-'||n)::uuid,'{owner}','固定商品'||n,'家居用品',
            '2026-01-01'::timestamptz+(n/20)*interval '1 second',n%100
          FROM generate_series(1,2000) n;
          INSERT INTO knowledge_entries(id,user_id,title,content,source_type)
          SELECT md5('{owner}-entry-'||n)::uuid,'{owner}','固定知识'||n,
            jsonb_build_object('text',repeat('事实材料',100)),'prompt_edit'
          FROM generate_series(1,200) n;
          INSERT INTO production_jobs(id,user_id,request_key,kind,payload,status,model_config_version_id)
            VALUES('{job}','{owner}',md5('{owner}-request')::uuid,'knowledge_index','{{}}','completed','{VERSION}');
          INSERT INTO knowledge_chunks(entry_id,user_id,content_hash,version_id,ordinal,content,embedding,job_id)
          SELECT e.id,e.user_id,e.content_hash,'{VERSION}',o,'固定分块 '||o,
            ARRAY(SELECT (1+sin(n*0.031+o*0.017+ascii(left(e.id::text,1))*0.001))::float8
                  FROM generate_series(1,1536) n),'{job}'
          FROM knowledge_entries e CROSS JOIN generate_series(0,23) o WHERE e.user_id='{owner}';
        """)
        return round(time.monotonic() - started, 3)

    def explain(self, statement):
        return json.loads(self.sql(f"EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) {statement}"))[0]

    def measure(self, statement, repeats, budget=None):
        first = self.explain(statement)
        plans = [self.explain(statement) for _ in range(repeats)]
        samples = sorted(p["Execution Time"] for p in plans)
        p95 = samples[math.ceil(len(samples) * 0.95) - 1]
        return {"first_execution_ms": first["Execution Time"], "samples_ms": samples,
                "p50_ms": samples[len(samples) // 2], "p95_ms": p95, "budget_ms": budget,
                "within_budget": budget is None or p95 <= budget, "plan": plans[-1]}

    def function_graph(self):
        rows = json.loads(self.sql("""
          SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'signature',p.oid::regprocedure::text,
            'security_definer',p.prosecdef,'acl',p.proacl::text,'config',p.proconfig,'body',p.prosrc)), '[]')
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          JOIN pg_language l ON l.oid=p.prolang
          WHERE n.nspname='public' AND l.lanname IN ('sql','plpgsql');
        """))
        names = {row["name"] for row in rows}
        for row in rows:
            body = row.pop("body")
            row["calls"] = sorted(names.intersection(re.findall(r"\b([a-z_][a-z_0-9]*)\s*\(", body.lower())))
            row["lock_statements"] = [
                part.strip() for part in body.split(";")
                if re.search(r"FOR\s+(?:UPDATE|SHARE)|pg_advisory", part, re.IGNORECASE)]
        return {"scope": "pg_proc SQL静态调用/语句顺序，分支可达性和动态SQL需结合真实并发回归", "functions": rows}

    def lock_sample(self):
        holder = subprocess.Popen(self.command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        waiter = None
        try:
            holder.stdin.write(f"BEGIN; SELECT 1 FROM user_plans WHERE user_id='{USER}' FOR UPDATE;\n")
            holder.stdin.flush()
            if holder.stdout.readline().strip() != "1":
                raise RuntimeError("套餐锁未取得")
            waiter = subprocess.Popen(self.command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True)
            waiter.stdin.write(f"""SET application_name='capacity-lock-waiter'; SET lock_timeout='5s';
              SET statement_timeout='10s'; SET request.jwt.claim.role='service_role';
              SELECT deduct_credits('{USER}',1,'capacity-lock-fixture');\n""")
            waiter.stdin.close()
            snapshot = []
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline:
                snapshot = json.loads(self.sql("""SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'wait_event_type',wait_event_type,'wait_event',wait_event,'blockers',pg_blocking_pids(pid))), '[]')
                  FROM pg_stat_activity WHERE application_name='capacity-lock-waiter'
                  AND cardinality(pg_blocking_pids(pid))>0;"""))
                if snapshot:
                    break
            holder.stdin.write("ROLLBACK;\n")
            holder.stdin.close()
            holder.wait(timeout=10)
            waiter.wait(timeout=15)
            output, errors = waiter.stdout.read(), waiter.stderr.read()
            if not snapshot or waiter.returncode or not json.loads(output).get("charge_id"):
                raise RuntimeError(f"真实锁等待/释放扣费失败: {errors}")
            return {"blocked": snapshot, "after_release": "同一原入口完成一笔扣费"}
        finally:
            for process in (waiter, holder):
                if process and process.poll() is None:
                    process.kill()
                    process.wait(timeout=10)

    def close(self):
        if self.started:
            subprocess.run(["docker", "rm", "-f", self.name], check=True, capture_output=True, timeout=30)


def run(args):
    output = Path(args.output).resolve()
    if not output.parent.is_dir() or output.exists():
        raise ValueError("输出目录必须已存在，不能覆盖已有测量证据")
    db = Database()
    report = {"schema": 1, "fixture": "capacity-v1", "through": args.through,
              "limits": {"products_per_owner": 2000, "entries_per_owner": 200,
                         "chunks_per_entry": 24, "dimensions": 1536},
              "repeats": args.repeats, "scales": [], "boundary": "2CPU/2GiB PG16，固定本地数据/温缓存SQL耗时；不是生产P95或API耗时"}
    try:
        report["migrations"] = db.start(args.through)
        report["postgres"] = db.sql("SELECT version();")
        report["image_id"] = subprocess.run(["docker", "inspect", "--format", "{{.Image}}", db.name],
                                            text=True, capture_output=True, check=True, timeout=10).stdout.strip()
        report["function_graph"] = db.function_graph()
        owner = 0
        for scale in args.scales:
            writes = []
            while owner < scale:
                owner += 1
                writes.append(db.add_owner(owner))
            db.sql("ANALYZE products; ANALYZE knowledge_entries; ANALYZE knowledge_chunks; ANALYZE production_jobs;")
            deep = f"SELECT * FROM products WHERE user_id='{USER}' ORDER BY created_at DESC,id LIMIT 100 OFFSET 1900"
            cursor = json.loads(db.sql(f"""SELECT to_jsonb(p) FROM (
              SELECT created_at,id FROM products WHERE user_id='{USER}'
              ORDER BY created_at DESC,id LIMIT 1 OFFSET 1899) p;"""))
            cursor_query = f"""SELECT * FROM products WHERE user_id='{USER}' AND (
              created_at<'{cursor['created_at']}' OR created_at='{cursor['created_at']}' AND id>'{cursor['id']}')
              ORDER BY created_at DESC,id LIMIT 100"""
            entry_scores = f"""
              SELECT c.entry_id,
                (SELECT sum(a*b)/sqrt(sum(a*a)*sum(b*b)) FROM unnest(c.embedding,{QUERY}) v(a,b)) similarity
              FROM knowledge_chunks c JOIN knowledge_entries e
                ON e.id=c.entry_id AND e.user_id=c.user_id AND e.content_hash=c.content_hash
              WHERE c.user_id='{USER}' AND c.version_id='{VERSION}' AND cardinality(c.embedding)=1536
            """
            queries = {
                "products_first": (f"SELECT * FROM products WHERE user_id='{USER}' ORDER BY created_at DESC,id LIMIT 100", 200),
                "products_deep": (deep, 200),
                "products_cursor": (cursor_query, 200),
                "products_contains": (f"SELECT * FROM products WHERE user_id='{USER}' AND name ILIKE '%商品19%' ORDER BY created_at DESC,id LIMIT 100", 200),
                "products_count": (f"SELECT count(*) FROM products WHERE user_id='{USER}'", 200),
                "knowledge_catalog": (f"SELECT read_knowledge_catalog('{USER}')", 200),
                "knowledge_search": (f"SELECT search_knowledge_vectors('{USER}','{VERSION}',{QUERY},5)", 500),
                "knowledge_score_scan": (f"SELECT sum(similarity) FROM ({entry_scores}) s", None),
            }
            item = {"owners": scale, "new_owner_write_seconds": writes,
                    "counts": json.loads(db.sql("""SELECT jsonb_build_object('products',(SELECT count(*) FROM products),
                      'entries',(SELECT count(*) FROM knowledge_entries),'chunks',(SELECT count(*) FROM knowledge_chunks));""")),
                    "sizes": json.loads(db.sql("""SELECT jsonb_object_agg(relname,pg_total_relation_size(oid))
                      FROM pg_class WHERE relname IN ('products','knowledge_entries','knowledge_chunks');""")),
                    "queries": {}}
            if item["counts"] != {"products": scale * 2000, "entries": scale * 200, "chunks": scale * 4800}:
                raise RuntimeError("容量数据与真实约束不一致")
            for name, (query, budget) in queries.items():
                item["queries"][name] = db.measure(query, args.repeats, budget)
                print(f"{scale}x {name}: p95={item['queries'][name]['p95_ms']:.3f}ms", flush=True)
            report["scales"].append(item)
        report["lock_sample"] = db.lock_sample()
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(f"已保存: {output}", flush=True)
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--through", type=int, default=65)
    parser.add_argument("--repeats", type=int, choices=range(3, 31), default=7)
    parser.add_argument("--scales", type=int, nargs="+", default=[1, 5, 10])
    options = parser.parse_args()
    if options.scales != sorted(set(options.scales)) or any(n not in (1, 5, 10) for n in options.scales):
        parser.error("scales须为递增的1/5/10")
    run(options)
