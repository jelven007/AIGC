"""真实数据库并发配额、租约及能力预检，不调用供应商。"""
import concurrent.futures
import json
import unittest
import test_finance as finance

sql = finance.sql


class WorkerFairnessTest(unittest.TestCase):
    setUp = finance.FinanceTest.setUp
    as_user = finance.FinanceTest.as_user
    as_service = finance.FinanceTest.as_service

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def claim(self, excluded="[]"):
        value = sql(self.as_service(f"SELECT claim_worker_dispatch('{excluded}');")).stdout.strip()
        return json.loads(value) if value else None

    def release(self, item):
        return sql(self.as_service(f"SELECT finish_worker_dispatch('{item['lease_token']}');"))

    def test_parallel_global_cap_reserves_two_finance_opportunities(self):
        sql("DELETE FROM worker_dispatches; UPDATE worker_queue_budgets SET virtual_finish=0;")
        excluded = json.dumps(["cash_refund", "wechat_order", "wechat_refund"])
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            rows = list(pool.map(lambda _: self.claim(excluded), range(12)))
        active = [row for row in rows if row]
        self.assertEqual(len(active), 6)
        self.assertEqual(sql("SELECT count(*) FROM worker_dispatches WHERE lease_until>now();").stdout.strip(), "6")
        for _ in range(2):
            item = self.claim()
            self.assertIn(item["lane"], ["cash_refund", "wechat_order", "wechat_refund"])
        self.assertIsNone(self.claim())
        for item in active:
            self.release(item)
        sql("DELETE FROM worker_dispatches;")

    def test_persistent_weighted_budget_bounds_oldest_lane_wait(self):
        sql("DELETE FROM worker_dispatches; UPDATE worker_queue_budgets SET virtual_finish=0;")
        received = {}
        maximum_gap = {}
        for step in range(150):
            item = self.claim()
            lane = item["lane"]
            maximum_gap[lane] = max(maximum_gap.get(lane, 0), step - received.get(lane, -1))
            received[lane] = step
            self.release(item)
        self.assertEqual(len(received), 20)
        self.assertLessEqual(max(maximum_gap.values()), 23)
        # 新调用者共享数据库预算，不依赖本机时间起点或进程内状态。
        self.assertGreater(int(sql("SELECT sum(dispatch_count) FROM worker_queue_budgets;").stdout), 150)

    def test_expired_quota_recovery_and_old_token_fencing(self):
        sql("DELETE FROM worker_dispatches;")
        item = self.claim()
        sql(f"UPDATE worker_dispatches SET lease_until=now()-interval '1 second' WHERE lease_token='{item['lease_token']}';")
        next_item = self.claim()
        self.assertNotEqual(item["lease_token"], next_item["lease_token"])
        self.assertEqual(self.release(item).stdout.strip(), "f")
        self.assertEqual(self.release(next_item).stdout.strip(), "t")
        self.assertNotEqual(sql(self.as_user("SELECT claim_worker_dispatch('[]');"), fail=False).returncode, 0)

    def test_capability_probe_reports_missing_columns_prices_and_functions(self):
        baseline = json.loads(sql(self.as_service("SELECT worker_capabilities();")).stdout)
        self.assertTrue(baseline["ready"])
        self.assertEqual(baseline["required_migration"], "00068")
        sql("ALTER TABLE notifications RENAME COLUMN event_key TO test_event_key;")
        try:
            missing = json.loads(sql(self.as_service("SELECT worker_capabilities();")).stdout)
            self.assertFalse(missing["ready"])
            self.assertIn("notifications", missing["missing"])
            self.assertEqual(sql(self.as_service("SELECT worker_runtime_ready();")).stdout.strip(), "t")
        finally:
            sql("ALTER TABLE notifications RENAME COLUMN test_event_key TO event_key;")
        sql("UPDATE credit_costs SET cost=-1 WHERE action='generate_tts';")
        try:
            missing = json.loads(sql(self.as_service("SELECT worker_capabilities();")).stdout)
            self.assertFalse(missing["ready"])
            self.assertIn("credit_costs", missing["missing"])
        finally:
            sql("UPDATE credit_costs SET cost=10 WHERE action='generate_tts';")

    def test_maintenance_lease_backoff_and_production_are_independent(self):
        sql("UPDATE worker_maintenance_state SET next_run_at=now(),lease_token=NULL,lease_until=NULL;")
        value = json.loads(sql(self.as_service("SELECT claim_worker_maintenance();")).stdout)
        self.assertIsNotNone(value)
        sql(self.as_service(f"SELECT finish_worker_maintenance('{value['lease_token']}',false);"))
        self.assertEqual(sql(f"SELECT failures FROM worker_maintenance_state WHERE task='{value['task']}';").stdout.strip(), "1")
        self.assertIsNotNone(self.claim())
        self.assertNotEqual(sql(self.as_user("SELECT claim_worker_maintenance();"), fail=False).returncode, 0)

    def test_empty_queue_snapshot_is_read_only_and_unknown_generation_is_excluded(self):
        self.assertEqual(json.loads(sql(self.as_service("SELECT worker_due_lanes();")).stdout), [])
        sql(f"""INSERT INTO production_jobs(user_id,request_key,kind,payload,status)
          VALUES('{self.user}',gen_random_uuid(),'image','{{}}','unknown');""")
        self.assertEqual(json.loads(sql(self.as_service("SELECT worker_due_lanes();")).stdout), [])
        sql(f"UPDATE production_jobs SET status='pending' WHERE user_id='{self.user}';")
        self.assertEqual(json.loads(sql(self.as_service("SELECT worker_due_lanes();")).stdout), ["image"])
        sql(f"DELETE FROM production_jobs WHERE user_id='{self.user}';")


if __name__ == "__main__":
    unittest.main(verbosity=2)
