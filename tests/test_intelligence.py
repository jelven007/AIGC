"""真实PostgreSQL情报任务、计划预算、采集来源与原流水退款。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance
sql = finance.sql


class IntelligenceTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        finance.FinanceTest.setUp(self)
        previous = sql("SELECT current_version_id FROM model_configs WHERE slot='intelligence.ebay'").stdout.strip()
        self.version = sql(self.as_service(f"""SELECT save_model_config('intelligence.ebay',
          {"'"+previous+"'" if previous else "NULL"},'{{"protocol":"ebay-browse"}}',true,'isolated','{self.other}',true)""")).stdout.strip()
        self.target = json.loads(sql(self.as_service(f"""SELECT save_intelligence_target('{self.user}','{uuid.uuid4()}',
          '真实商品搜索','intelligence_products','intelligence.ebay','{{"query":"cup","market":"US"}}')""")).stdout)["id"]

    def create(self, key=None, target=None, cost=2, fail=True):
        return sql(self.as_service(f"""SELECT create_intelligence_job('{self.user}','{key or uuid.uuid4()}',
          '{target or self.target}',{cost},'{self.version}')"""), fail)

    def claim(self, job):
        return json.loads(sql(self.as_service(f"SELECT claim_production_job('intelligence_products','{job}')")).stdout)

    def complete(self, job, lease, version=None, fail=True):
        body = json.dumps({"source": {"slot": "intelligence.ebay", "version_id": version or self.version,
                            "observed_at": "2026-10-21T00:00:00Z", "name": "eBay", "definition": "Best Match"},
                           "params": {"query": "cup", "market": "US"}, "items": [
                               {"id": "v1|1|0", "title": "真实杯子", "url": "https://www.ebay.com/itm/1",
                                "price": "12.90", "currency": "USD", "sold_7d": None}]}).replace("'", "''")
        return sql(self.as_service(f"SELECT update_production_job('{job}','{lease}','completed','{body}')"), fail)

    def schedule(self, runs=3, budget=6, key=None, cost=2, fail=True):
        return sql(self.as_service(f"""SELECT schedule_intelligence_target('{self.user}','{self.target}',
          '{key or uuid.uuid4()}',{runs},{budget},{cost},'{self.version}')"""), fail)

    def test_parallel_same_key_charges_once_and_rejects_changed_request(self):
        key = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            jobs = [json.loads(result.stdout) for result in pool.map(lambda _: self.create(key), range(5))]
        self.assertEqual(len({job["id"] for job in jobs}), 1)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "2")
        self.assertNotEqual(self.create(key, cost=3, fail=False).returncode, 0)
        self.assertNotEqual(self.create(fail=False).returncode, 0)
        sql("UPDATE model_configs SET enabled=false WHERE slot='intelligence.ebay'")
        self.assertEqual(json.loads(self.create(key).stdout)["id"], jobs[0]["id"])

    def test_wrong_owner_price_and_source_version_do_not_charge(self):
        for result in (self.create(target=str(uuid.uuid4()), fail=False), self.create(cost=0, fail=False)):
            self.assertNotEqual(result.returncode, 0)
        sql("UPDATE model_configs SET enabled=false WHERE slot='intelligence.ebay'")
        self.assertNotEqual(self.create(fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")

    def test_completion_atomic_history_and_import_replay(self):
        job = json.loads(self.create().stdout)["id"]; claimed = self.claim(job); lease = claimed["lease_token"]
        self.assertNotEqual(self.complete(job, lease, str(uuid.uuid4()), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM intelligence_samples WHERE job_id='{job}'").stdout.strip(), "0")
        self.complete(job, lease); self.complete(job, lease)
        self.assertEqual(sql(f"SELECT count(*) FROM intelligence_samples WHERE job_id='{job}'").stdout.strip(), "1")
        catalog = json.loads(sql(self.as_service(f"SELECT read_intelligence_catalog('{self.user}','intelligence_products')")).stdout)
        self.assertIsNone(catalog[0]["latest"]["data"]["items"][0]["sold_7d"])
        statement = self.as_service(f"SELECT import_intelligence_product('{self.user}','{job}','v1|1|0')")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            ids = [result.stdout.strip() for result in pool.map(lambda _: sql(statement), range(4))]
        self.assertEqual(len(set(ids)), 1)
        self.assertEqual(sql(f"SELECT selling_points::text FROM products WHERE id='{ids[0]}'").stdout.strip(), "{}")
        self.assertNotEqual(sql(self.as_service(f"SELECT import_intelligence_product('{self.other}','{job}','v1|1|0')"), False).returncode, 0)

    def test_failure_refunds_once_and_third_read_retry_releases(self):
        job = json.loads(self.create().stdout)["id"]
        for attempt in range(3):
            claimed = self.claim(job)
            sql(self.as_service(f"""SELECT update_production_job('{job}','{claimed["lease_token"]}','retry','{{"error":"HTTP 503"}}')"""))
            sql(f"UPDATE production_jobs SET next_run_at=now() WHERE id='{job}'")
        self.assertEqual(sql(f"SELECT status FROM production_jobs WHERE id='{job}'").stdout.strip(), "failed")
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{self.user}' AND original_charge_id IS NOT NULL").stdout.strip(), "1")
        sql(self.as_service(f"""SELECT update_production_job('{job}','{claimed["lease_token"]}','failed','{{"error":"重复"}}')"""))
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{self.user}' AND original_charge_id IS NOT NULL").stdout.strip(), "1")

    def test_schedule_budget_parallel_enqueue_and_original_receipt_does_not_reset(self):
        key = str(uuid.uuid4()); self.schedule(key=key)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(lambda _: sql(self.as_service("SELECT enqueue_intelligence_schedule()")), range(3)))
        self.assertEqual(sql(f"SELECT count(*) FROM production_jobs WHERE user_id='{self.user}'").stdout.strip(), "1")
        remaining = sql(f"SELECT remaining_runs||':'||remaining_budget FROM intelligence_targets WHERE id='{self.target}'").stdout.strip()
        self.assertEqual(remaining, "2:4")
        self.schedule(runs=0, budget=0)
        self.schedule(key=key)  # 旧启动请求在新的停止请求之后重放，不能重新启动
        self.assertEqual(sql(f"SELECT monitoring FROM intelligence_targets WHERE id='{self.target}'").stdout.strip(), "f")
        self.assertNotEqual(self.schedule(key=key, budget=8, fail=False).returncode, 0)

    def test_schedule_version_or_balance_failure_stops_without_overdraw(self):
        self.assertNotEqual(self.schedule(budget=5, fail=False).returncode, 0)
        self.schedule()
        sql("UPDATE model_configs SET enabled=false WHERE slot='intelligence.ebay'")
        sql(self.as_service("SELECT enqueue_intelligence_schedule()"))
        self.assertEqual(sql(f"SELECT monitoring FROM intelligence_targets WHERE id='{self.target}'").stdout.strip(), "f")
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")

    def test_snapshot_permissions_and_active_delete(self):
        for command in ("INSERT INTO intelligence_samples(job_id,target_id,user_id,data) VALUES(gen_random_uuid(),gen_random_uuid(),auth.uid(),'{}')",
                        "UPDATE intelligence_targets SET remaining_budget=999",
                        f"SELECT create_intelligence_job('{self.other}','{uuid.uuid4()}','{self.target}',0,'{self.version}')",
                        "SELECT * FROM intelligence_schedule_receipts", "DELETE FROM competitor_accounts"):
            self.assertNotEqual(sql(self.as_user(command), False).returncode, 0)
        job = json.loads(self.create().stdout)["id"]
        self.assertNotEqual(sql(self.as_service(f"SELECT delete_intelligence_target('{self.user}','{self.target}')"), False).returncode, 0)
        claimed = self.claim(job); self.complete(job, claimed["lease_token"])
        self.assertEqual(sql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{self.other}'; SELECT count(*) FROM intelligence_samples WHERE job_id='{job}'").stdout.strip(), "0")
        sql(self.as_service(f"SELECT delete_intelligence_target('{self.user}','{self.target}')"))
        self.assertEqual(sql(f"SELECT count(*) FROM intelligence_samples WHERE job_id='{job}'").stdout.strip(), "0")
        self.assertEqual(json.loads(sql(f"SELECT result FROM production_jobs WHERE id='{job}'").stdout), {"deleted": True})

    def test_insufficient_balance_stops_schedule_and_retention_scrubs_all_copies(self):
        self.schedule()
        sql(self.as_service(f"SELECT deduct_credits('{self.user}',20,'balance-test')"))
        sql(self.as_service("SELECT enqueue_intelligence_schedule()"))
        self.assertEqual(sql(f"SELECT monitoring FROM intelligence_targets WHERE id='{self.target}'").stdout.strip(), "f")
        self.assertEqual(sql(f"SELECT count(*) FROM production_jobs WHERE user_id='{self.user}'").stdout.strip(), "0")
        sql(self.as_service(f"SELECT add_credits('{self.user}',10,'test-balance')"))
        job = json.loads(self.create().stdout)["id"]; claimed = self.claim(job)
        self.complete(job, claimed["lease_token"])
        sql(f"UPDATE intelligence_samples SET collected_at=now()-interval '31 days' WHERE job_id='{job}'")
        sql(f"UPDATE production_jobs SET completed_at=now()-interval '31 days' WHERE id='{job}'")
        sql(self.as_service("SELECT prune_intelligence_data()"))
        self.assertEqual(sql(f"SELECT count(*) FROM intelligence_samples WHERE job_id='{job}'").stdout.strip(), "0")
        data = json.loads(sql(f"SELECT to_jsonb(j) FROM production_jobs j WHERE id='{job}'").stdout)
        self.assertEqual(data["result"], {"expired": True})
        self.assertNotIn("params", data["payload"])
        self.assertIsNone(data["evidence"]); self.assertIsNone(data["resolution"])
        self.assertEqual(data["status"], "completed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
