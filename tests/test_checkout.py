"""真实 PostgreSQL 收银请求：并发、金额、归属、旧快照与资金入账。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class CheckoutTest(unittest.TestCase):
    setUpClass = classmethod(finance.FinanceTest.setUpClass.__func__)
    setUp = finance.FinanceTest.setUp
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    finalize = finance.FinanceTest.finalize

    def begin(self, key=None, actor=None, channel="alipay", amount="10.00", plan=None, credits=100):
        return self.as_service(
            f"SELECT row_to_json(begin_checkout_order('{actor or self.user}',"
            f"'{key or uuid.uuid4()}','{channel}','{plan or self.plan}',{amount},{credits}));")

    def test_concurrent_original_request_and_provider_order_number(self):
        key = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            rows = list(pool.map(lambda _: json.loads(sql(self.begin(key)).stdout), range(6)))
        self.assertEqual(len({row["id"] for row in rows}), 1)
        self.assertEqual(len(rows[0]["order_no"]), 32)
        self.assertEqual(rows[0]["plan_snapshot"]["credits"], 100)
        self.assertEqual(rows[0]["checkout_request_key"], key)
        sql(self.finalize(rows[0]["order_no"]))
        self.assertEqual(json.loads(sql(self.begin(key)).stdout)["status"], "paid")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE order_id='{rows[0]['id']}'").stdout.strip(), "1")

    def test_amount_conflict_and_snapshot_survives_catalog_changes(self):
        key = str(uuid.uuid4())
        row = json.loads(sql(self.begin(key)).stdout)
        for statement in (self.begin(key, amount="9"), self.begin(key, channel="wechat"),
                          self.begin(key, plan=self.booster), self.begin(key, credits=200)):
            self.assertNotEqual(sql(statement, fail=False).returncode, 0)
        sql(f"UPDATE plans SET credits=200 WHERE id='{self.plan}'")
        self.assertNotEqual(sql(self.begin(), fail=False).returncode, 0)
        sql(f"UPDATE plans SET name='新名称',price=15,credits=900 WHERE id='{self.plan}'")
        self.assertEqual(json.loads(sql(self.begin(key)).stdout)["plan_snapshot"]["credits"], 100)
        self.assertNotEqual(sql(self.begin(), fail=False).returncode, 0)
        self.assertEqual(json.loads(sql(self.begin(amount="15", credits=900)).stdout)["plan_snapshot"]["credits"], 900)
        sql(self.finalize(row["order_no"]))
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "100")

    def test_accounts_and_browser_boundaries(self):
        key = str(uuid.uuid4())
        mine = json.loads(sql(self.begin(key)).stdout)
        other = json.loads(sql(self.begin(key, actor=self.other)).stdout)
        self.assertNotEqual(mine["id"], other["id"])
        self.assertNotEqual(mine["order_no"], other["order_no"])
        statement = f"SELECT begin_checkout_order('{self.other}','{uuid.uuid4()}','alipay','{self.plan}',10,100)"
        self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)
        self.assertEqual(sql(self.as_user(f"SELECT count(*) FROM orders WHERE id='{other['id']}'")).stdout.strip(), "0")
        sql(f"UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='{self.user}'")
        self.assertNotEqual(sql(self.begin(key), fail=False).returncode, 0)

    def test_pending_cap_is_atomic_and_old_request_remains_available(self):
        first = str(uuid.uuid4())
        sql(self.begin(first))
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: sql(self.begin(), fail=False), range(16)))
        self.assertEqual(sum(result.returncode == 0 for result in results), 9)
        self.assertEqual(sql(f"SELECT count(*) FROM orders WHERE user_id='{self.user}'").stdout.strip(), "10")
        self.assertEqual(json.loads(sql(self.begin(first)).stdout)["status"], "pending")
        for amount in ("0", "-1", "10.001", "'NaN'", "'Infinity'", "NULL"):
            self.assertNotEqual(sql(self.begin(amount=amount), fail=False).returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
