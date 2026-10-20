"""隔离 PostgreSQL 回归：执行真实迁移与事务，不连接生产数据库。"""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = f"shoproai-finance-{uuid.uuid4().hex[:10]}"


def sql(statement, fail=True):
    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
         "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
        input=statement, text=True, capture_output=True, timeout=30,
    )
    if fail and result.returncode:
        raise AssertionError(result.stderr)
    return result


class FinanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run(
            ["docker", "run", "-d", "--name", CONTAINER, "--label", "shoproai.purpose=finance-test",
             "-e", "POSTGRES_PASSWORD=local_test_only", "postgres:16"],
            check=True, capture_output=True, timeout=60,
        )
        cls.addClassCleanup(lambda: subprocess.run(
            ["docker", "rm", "-f", CONTAINER], check=True, capture_output=True, timeout=30))
        # pg_isready 每次最多等待一秒，无长时间阻塞。
        for _ in range(60):
            ready = subprocess.run(["docker", "exec", CONTAINER, "pg_isready", "-h", "127.0.0.1", "-t", "1"],
                                   capture_output=True, timeout=5)
            if ready.returncode == 0:
                break
            time.sleep(0.25)
        else:
            raise AssertionError("测试 PostgreSQL 未就绪")
        sql((ROOT / "tests/db/bootstrap.sql").read_text())
        for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            # 样例数据引用线上固定 UID，不属于 schema；其余迁移均真实执行。
            if migration.name.startswith(("00018_", "00019_")):
                continue
            try:
                sql("BEGIN;\n" + migration.read_text() + "\nCOMMIT;")
            except AssertionError as exc:
                raise AssertionError(f"{migration.name}: {exc}") from exc

    def setUp(self):
        self.user = str(uuid.uuid4())
        self.other = str(uuid.uuid4())
        self.free = str(uuid.uuid4())
        self.plan = str(uuid.uuid4())
        self.booster = str(uuid.uuid4())
        sql(f"""
          INSERT INTO plans(id,name,price,credits,level) VALUES
          ('{self.free}','免费版',0,20,0), ('{self.plan}','专业版',10,100,1),
          ('{self.booster}','加油包',2,30,-1);
          INSERT INTO auth.users VALUES ('{self.user}','same@test.example'), ('{self.other}','same@other.example');
        """)

    def as_user(self, statement):
        return f"""SET ROLE authenticated;
          SET request.jwt.claim.sub = '{self.user}';
          SET request.jwt.claim.role = 'authenticated';
          {statement}"""

    def as_service(self, statement):
        return f"SET ROLE service_role; SET request.jwt.claim.role = 'service_role'; {statement}"

    def order(self, plan=None, amount=10, channel="alipay"):
        order_no = uuid.uuid4().hex
        sql(f"""INSERT INTO orders(order_no,user_id,plan_id,total_amount,pay_channel)
          VALUES ('{order_no}','{self.user}','{plan or self.plan}',{amount},'{channel}');""")
        return order_no

    def finalize(self, order_no, amount=10, channel="alipay"):
        return self.as_service(
            f"SELECT finalize_paid_order('{order_no}','{channel}','trade-{order_no}',{amount});")

    def charge(self, amount=10):
        response = sql(self.as_user(f"SELECT deduct_credits('{self.user}',{amount},'test');"))
        return json.loads(response.stdout)

    def test_registration_has_one_bonus_and_unique_profile(self):
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "20")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{self.user}'").stdout.strip(), "1")
        self.assertEqual(sql(f"SELECT count(*) FROM profiles WHERE id IN ('{self.user}','{self.other}')").stdout.strip(), "2")

    def test_rls_and_rpc_permissions(self):
        for table in ("orders", "credit_logs", "user_plans", "video_jobs", "activities", "user_activities",
                      "plans", "credit_costs", "llm_cache"):
            result = sql(self.as_user(f"DELETE FROM {table};"), fail=False)
            self.assertNotEqual(result.returncode, 0, table)
        for statement in (
            f"SELECT deduct_credits('{self.other}',10,'forged');",
            f"SELECT add_credits('{self.user}',100,'forged');",
            f"SELECT refund_credits('{self.user}',10,'forged');",
            f"SELECT refund_credit_charge('{self.user}','{uuid.uuid4()}','forged');",
            "SELECT finalize_paid_order('forged','alipay','x',10);",
        ):
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)
        self.assertEqual(sql(self.as_user("SELECT count(*) FROM user_plans;")).stdout.strip(), "1")
        self.assertNotEqual(sql(self.as_user(f"SELECT deduct_credits('{self.user}',-10,'negative')"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_user(f"SELECT deduct_credits('{self.user}',0,'zero')"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_service(f"SELECT add_credits('{self.user}',-10,'negative')"), fail=False).returncode, 0)
        self.assertNotEqual(sql(f"SET ROLE anon; SELECT deduct_credits('{self.user}',10,'anonymous')", fail=False).returncode, 0)

    def test_concurrent_charge_cannot_overdraw(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: sql(self.as_user(
                f"SELECT deduct_credits('{self.user}',10,'parallel');"), fail=False), range(6)))
        self.assertEqual(sum(result.returncode == 0 for result in results), 2)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "20")

    def test_refund_once_and_owner_check(self):
        charge = self.charge()["charge_id"]
        wrong = self.as_service(f"SELECT refund_credit_charge('{self.other}','{charge}','failed')")
        self.assertNotEqual(sql(wrong, fail=False).returncode, 0)
        refund = self.as_service(f"SELECT refund_credit_charge('{self.user}','{charge}','failed')")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: json.loads(sql(refund).stdout), range(4)))
        self.assertEqual(sum(result["refunded"] for result in results), 10)
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE original_charge_id='{charge}'").stdout.strip(), "1")

    def test_payment_snapshot_and_parallel_idempotency(self):
        order_no = self.order()
        sql(f"UPDATE plans SET credits=999,price=99 WHERE id='{self.plan}'")
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: json.loads(sql(self.finalize(order_no)).stdout), range(6)))
        self.assertEqual(sum(result["outcome"] == "granted" for result in results), 1)
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "100")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE order_id=(SELECT id FROM orders WHERE order_no='{order_no}')").stdout.strip(), "1")

    def test_wrong_amount_channel_and_trade_rejected(self):
        order_no = self.order()
        self.assertNotEqual(sql(self.finalize(order_no, amount=9), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.finalize(order_no, channel="wechat"), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT status FROM orders WHERE order_no='{order_no}'").stdout.strip(), "pending")
        sql(self.finalize(order_no))
        self.assertNotEqual(sql(self.as_service(
            f"SELECT finalize_paid_order('{order_no}','alipay','different-trade',10)"), fail=False).returncode, 0)
        second = self.order()
        self.assertNotEqual(sql(self.as_service(
            f"SELECT finalize_paid_order('{second}','alipay','trade-{order_no}',10)"), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT status FROM orders WHERE order_no='{second}'").stdout.strip(), "pending")

    def test_entitlement_failure_rolls_back_then_retry(self):
        order_no = self.order()
        sql("ALTER TABLE credit_logs ADD CONSTRAINT test_reject_purchase CHECK (action IS DISTINCT FROM 'plan_purchase') NOT VALID;")
        try:
            self.assertNotEqual(sql(self.finalize(order_no), fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT status FROM orders WHERE order_no='{order_no}'").stdout.strip(), "pending")
            self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "20")
        finally:
            sql("ALTER TABLE credit_logs DROP CONSTRAINT test_reject_purchase;")
        self.assertEqual(json.loads(sql(self.finalize(order_no)).stdout)["outcome"], "granted")

    def test_boosters_accumulate_and_preserve_plan_usage(self):
        self.charge()
        orders = [self.order(self.booster, amount=2, channel="wechat") for _ in range(4)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda order: sql(self.finalize(order, 2, "wechat")), orders))
        self.assertEqual(sql(f"SELECT credits_total,credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "140|10")

    def test_old_cycle_refund_does_not_erase_new_usage(self):
        charge = self.charge()["charge_id"]
        sql(self.finalize(self.order()))
        self.charge(15)
        sql(self.as_service(f"SELECT refund_credit_charge('{self.user}','{charge}','old cycle failure')"))
        self.assertEqual(sql(f"SELECT credits_total,credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "110|15")

    def test_activity_atomic_reward_and_server_evidence(self):
        activity = str(uuid.uuid4())
        sql(f"INSERT INTO activities(id,title,type,reward_credits) VALUES ('{activity}','首次登录','login_first',5)")
        claim = self.as_user(f"SELECT claim_activity_reward('{activity}');")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: sql(claim, fail=False), range(4)))
        self.assertEqual(sum(result.returncode == 0 for result in results), 1)
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "25")
        video_activity = str(uuid.uuid4())
        sql(f"INSERT INTO activities(id,title,type,reward_credits) VALUES ('{video_activity}','首次视频','video_first',5)")
        self.assertNotEqual(sql(self.as_user(f"SELECT claim_activity_reward('{video_activity}')"), fail=False).returncode, 0)

    def test_daily_checkin_is_once_per_utc_day(self):
        activity = str(uuid.uuid4())
        sql(f"INSERT INTO activities(id,title,type,reward_credits,max_times) VALUES ('{activity}','签到','daily_checkin',5,0)")
        claim = self.as_user(f"SELECT claim_activity_reward('{activity}');")
        sql(claim)
        self.assertNotEqual(sql(claim, fail=False).returncode, 0)
        sql(f"UPDATE user_activities SET last_claimed_at=now()-interval '1 day' WHERE user_id='{self.user}'")
        sql(claim)
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "30")

    def test_legacy_paid_order_requires_reconciliation(self):
        order_no = self.order()
        sql(f"UPDATE orders SET status='paid' WHERE order_no='{order_no}'")
        self.assertNotEqual(sql(self.finalize(order_no), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "20")


if __name__ == "__main__":
    unittest.main(verbosity=2)
