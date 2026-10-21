"""真实 PostgreSQL 批次事务、并发领取、暂停、取消及原始流水退款回归。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class BatchVideoTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    claim_job = finance.FinanceTest.claim_job
    job_event_sql = finance.FinanceTest.job_event_sql

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        finance.FinanceTest.setUp(self)
        sql(f"UPDATE user_plans SET plan_id='{self.plan}' WHERE user_id='{self.user}'")
        self.products = [str(uuid.uuid4()), str(uuid.uuid4())]
        sql(f"""INSERT INTO products(id,user_id,name,category) VALUES
          ('{self.products[0]}','{self.user}','商品甲','测试'),('{self.products[1]}','{self.user}','商品乙','测试');""")

    def create_sql(self, key=None, budget=20, cost=10, foreign=False):
        request = json.dumps({"product_ids": self.products, "budget": budget})
        items = [{"product_id": product, "input": {"prompt": "商品展示", "duration": 5, "ratio": "16:9", "resolution": "720P"}}
                 for product in self.products]
        if foreign:
            items[1]["product_id"] = str(uuid.uuid4())
        return self.as_service(f"""SELECT create_batch_video_jobs('{self.user}','{key or uuid.uuid4()}',
          '批次','SeedanceMini','{request}','{json.dumps(items)}','{self.versions["SeedanceMini"]}',{cost},{budget});""")

    def create(self):
        return json.loads(sql(self.create_sql()).stdout)

    def control(self, batch, action, fail=True, user=None):
        return sql(self.as_service(f"SELECT control_batch_video('{user or self.user}','{batch['id']}','{action}');"), fail=fail)

    def jobs(self, batch):
        return [json.loads(sql(f"SELECT to_jsonb(v) FROM video_jobs v WHERE id='{item['video_job_id']}'").stdout)
                for item in batch["items"]]

    def snapshot(self, batch):
        return json.loads(sql(self.as_service(f"SELECT batch_video_snapshot('{self.user}','{batch['id']}');")).stdout)

    def test_creation_atomic_budget_price_and_owner_validation(self):
        for statement in (self.create_sql(budget=10), self.create_sql(cost=1), self.create_sql(foreign=True)):
            self.assertNotEqual(sql(statement, fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT count(*) FROM batch_jobs WHERE user_id='{self.user}'").stdout.strip(), "0")
            self.assertEqual(sql(f"SELECT count(*) FROM video_jobs WHERE user_id='{self.user}'").stdout.strip(), "0")
            self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        batch = self.create()
        self.assertEqual(batch["reserved_credits"], 20)
        self.assertEqual(batch["queued_count"], 2)
        self.assertEqual(sql(f"SELECT count(DISTINCT charge_id) FROM video_jobs WHERE user_id='{self.user}'").stdout.strip(), "2")

    def test_server_entitlement_and_full_balance_before_reservation(self):
        sql(f"UPDATE user_plans SET plan_id='{self.free}' WHERE user_id='{self.user}'")
        self.assertNotEqual(sql(self.create_sql(), fail=False).returncode, 0)
        sql(f"UPDATE user_plans SET plan_id='{self.plan}',expires_at=now()-interval '1 day' WHERE user_id='{self.user}'")
        self.assertNotEqual(sql(self.create_sql(), fail=False).returncode, 0)
        sql(f"UPDATE user_plans SET expires_at=NULL,credits_total=10 WHERE user_id='{self.user}'")
        self.assertNotEqual(sql(self.create_sql(), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{self.user}' AND action='generate_video'").stdout.strip(), "0")

    def test_concurrent_creation_idempotence_and_recovery_after_config_change(self):
        key = str(uuid.uuid4())
        statement = self.create_sql(key)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            batches = list(pool.map(lambda _: json.loads(sql(statement).stdout), range(4)))
        self.assertEqual(len({batch["id"] for batch in batches}), 1)
        sql("UPDATE model_configs SET enabled=false WHERE slot='video.SeedanceMini'")
        sql(f"DELETE FROM products WHERE user_id='{self.user}'")
        recovered = json.loads(sql(statement).stdout)
        self.assertEqual(recovered["id"], batches[0]["id"])
        self.assertNotEqual(sql(self.create_sql(key, budget=30), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "20")

    def test_pause_blocks_new_submission_but_not_accepted_result_and_cancel_refunds_only_queued(self):
        batch = self.create()
        jobs = self.jobs(batch)
        claimed = self.claim_job(jobs[0])
        sql(self.job_event_sql(claimed, "accepted", task="'accepted-upstream'"))
        self.control(batch, "pause")
        self.assertIsNone(self.claim_job(jobs[1]))
        accepted = self.claim_job(jobs[0])
        self.assertIsNotNone(accepted)
        cancelled = json.loads(self.control(batch, "cancel").stdout)
        self.assertEqual(cancelled["status"], "cancelling")
        self.assertEqual(cancelled["refunded_credits"], 10)
        self.assertEqual(cancelled["reserved_credits"], 10)
        self.assertIsNone(self.claim_job(jobs[1]))
        sql(self.job_event_sql(accepted, "completed", video="'https://db.example/completed.mp4'"))
        settled = self.snapshot(batch)
        self.assertEqual(settled["status"], "partial")
        self.assertEqual(settled["settled_credits"], 10)
        self.assertEqual(settled["cancelled_count"], 1)
        self.assertEqual(settled["progress"], 100)

    def test_cancel_refund_failure_rolls_back_then_parallel_retry_once(self):
        batch = self.create()
        sql("ALTER TABLE credit_logs ADD CONSTRAINT test_batch_refund_outage CHECK(type<>'refund') NOT VALID")
        try:
            self.assertNotEqual(self.control(batch, "cancel", fail=False).returncode, 0)
            self.assertEqual(self.snapshot(batch)["reserved_credits"], 20)
            self.assertEqual(self.snapshot(batch)["status"], "processing")
        finally:
            sql("ALTER TABLE credit_logs DROP CONSTRAINT test_batch_refund_outage")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: self.control(batch, "cancel"), range(4)))
        result = self.snapshot(batch)
        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(result["refunded_credits"], 20)
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{self.user}' AND type='refund'").stdout.strip(), "2")

    def test_unknown_submission_cannot_cancel_refund_and_resume_is_rejected(self):
        batch = self.create()
        job = self.claim_job(self.jobs(batch)[0])
        sql(self.job_event_sql(job, "submit_unknown"))
        self.control(batch, "cancel")
        result = self.snapshot(batch)
        self.assertEqual(result["attention_count"], 1)
        self.assertEqual(result["reserved_credits"], 10)
        self.assertNotEqual(self.control(batch, "resume", fail=False).returncode, 0)
        sql(self.as_service(f"SELECT reconcile_video_submission('{job['id']}',NULL,'上游账单与客服核对确认未受理');"))
        self.assertEqual(self.snapshot(batch)["status"], "failed")
        self.assertEqual(self.snapshot(batch)["refunded_credits"], 20)

    def test_resume_and_cross_user_permission(self):
        batch = self.create()
        self.control(batch, "pause")
        self.assertIsNone(self.claim_job(self.jobs(batch)[0]))
        self.control(batch, "resume")
        self.assertIsNotNone(self.claim_job(self.jobs(batch)[0]))
        self.assertNotEqual(self.control(batch, "cancel", user=self.other, fail=False).returncode, 0)
        for statement in ("UPDATE batch_jobs SET status='completed'", "DELETE FROM batch_job_items",
                          f"SELECT control_batch_video('{self.user}','{batch['id']}','cancel')"):
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)
        self.assertEqual(sql(self.as_service(f"SELECT batch_video_snapshot('{self.other}','{batch['id']}')")).stdout.strip(), "")

    def test_concurrent_claim_and_cancel_never_refunds_a_claimed_submission(self):
        batch = self.create()
        job = self.jobs(batch)[0]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            claimed = pool.submit(self.claim_job, job)
            cancelled = pool.submit(self.control, batch, "cancel")
            lease = claimed.result()
            cancelled.result()
        status = self.jobs(batch)[0]
        if lease:
            self.assertEqual(status["submission_state"], "submitting")
            self.assertEqual(status["billing_state"], "reserved")
        else:
            self.assertEqual(status["status"], "cancelled")
            self.assertEqual(status["billing_state"], "refunded")


if __name__ == "__main__":
    unittest.main(verbosity=2)
