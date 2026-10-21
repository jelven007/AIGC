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
          INSERT INTO auth.users(id,email) VALUES ('{self.user}','same@test.example'), ('{self.other}','same@other.example');
        """)
        sql(f"UPDATE auth.users SET raw_app_meta_data='{{\"role\":\"admin\"}}' WHERE id='{self.other}';")
        self.versions = {}
        for provider in ("SeedanceMini", "ArkSeedance"):
            previous = sql(f"SELECT current_version_id FROM model_configs WHERE slot='video.{provider}'").stdout.strip()
            expected = f"'{previous}'" if previous else "NULL"
            self.versions[provider] = sql(self.as_service(f"""SELECT save_model_config(
              'video.{provider}',{expected},'{{"name":"test","model":"test"}}',true,
              'isolated_cipher','{self.other}',true);""")).stdout.strip()

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

    def create_job_sql(self, key=None, prompt="商品特写"):
        return self.as_service(f"""SELECT create_video_job('{self.user}','{key or uuid.uuid4()}','SeedanceMini',
          '{{"prompt":"{prompt}","duration":5,"resolution":"720P","ratio":"16:9"}}',
          '{self.versions["SeedanceMini"]}');""")

    def create_job(self):
        return json.loads(sql(self.create_job_sql()).stdout)

    def claim_job(self, job):
        sql(f"UPDATE video_jobs SET next_poll_at=now()-interval '1 second' WHERE id='{job['id']}'")
        output = sql(self.as_service(f"SELECT claim_video_job('{job['id']}');")).stdout.strip()
        return json.loads(output) if output else None

    def job_event_sql(self, job, event, task="NULL", video="NULL"):
        return self.as_service(f"""SELECT record_video_job_event('{job['id']}','{job['lease_token']}',
          '{event}',{task},{video},'provider evidence',40);""")

    def submitted_job(self):
        job = self.claim_job(self.create_job())
        sql(self.job_event_sql(job, "accepted", task=f"'upstream-{uuid.uuid4()}'"))
        return self.claim_job(job)

    def test_model_versions_permissions_and_optimistic_update(self):
        version = self.versions["SeedanceMini"]
        for statement in (
            "SELECT * FROM model_config_versions;",
            "SELECT * FROM model_configs;",
            f"SELECT save_model_config('text.primary',NULL,'{{}}',false,NULL,'{self.user}',false);",
            f"SELECT create_video_job_without_config('{self.user}','{uuid.uuid4()}','MiniMax','{{}}');",
        ):
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_service(
            f"UPDATE model_config_versions SET key_ciphertext='forged' WHERE id='{version}'"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_service(
            f"SELECT save_model_config('text.primary',NULL,'{{}}',false,NULL,'{self.user}',false)"), fail=False).returncode, 0)
        statement = self.as_service(f"""SELECT save_model_config('video.SeedanceMini',
          '{version}','{{"name":"next","model":"next"}}',true,NULL,'{self.other}',false);""")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: sql(statement, fail=False), range(2)))
        self.assertEqual(sum(result.returncode == 0 for result in results), 1)
        self.assertEqual(sql(f"SELECT key_ciphertext FROM model_config_versions WHERE id='{version}'").stdout.strip(), "isolated_cipher")

    def test_config_change_keeps_old_job_and_rejects_new_charge(self):
        key = str(uuid.uuid4())
        job = json.loads(sql(self.create_job_sql(key)).stdout)
        version = self.versions["SeedanceMini"]
        sql(self.as_service(f"""SELECT save_model_config('video.SeedanceMini','{version}',
          '{{"name":"disabled","model":"next"}}',false,NULL,'{self.other}',false);"""))
        same = json.loads(sql(self.create_job_sql(key)).stdout)
        self.assertEqual(same["id"], job["id"])
        self.assertEqual(same["model_config_version_id"], version)
        self.assertNotEqual(sql(self.create_job_sql(), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "10")
        self.assertEqual(self.claim_job(job)["model_config_version_id"], version)

    def test_legacy_jobs_wait_for_explicit_config_binding(self):
        job = self.create_job()
        sql(f"UPDATE video_jobs SET model_config_version_id=NULL WHERE id='{job['id']}'")
        self.assertIsNone(self.claim_job(job))
        self.assertNotEqual(sql(self.as_service(f"""SELECT bind_legacy_video_config('{job['id']}',
          '{self.versions["ArkSeedance"]}','核对原供应商接口和账号一致');"""), fail=False).returncode, 0)
        sql(self.as_service(f"""SELECT bind_legacy_video_config('{job['id']}',
          '{self.versions["SeedanceMini"]}','核对原供应商接口和账号一致');"""))
        self.assertIsNotNone(self.claim_job(job))

    def test_video_concurrent_create_is_once_and_payload_bound(self):
        key = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            jobs = list(pool.map(lambda _: json.loads(sql(self.create_job_sql(key)).stdout), range(4)))
        self.assertEqual(len({job["id"] for job in jobs}), 1)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "10")
        self.assertNotEqual(sql(self.create_job_sql(key, prompt="不同商品"), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM video_projects WHERE user_id='{self.user}'").stdout.strip(), "1")

    def test_video_creation_failure_rolls_back_charge(self):
        sql("ALTER TABLE video_jobs ADD CONSTRAINT test_reject_new_job CHECK (request_key IS NULL) NOT VALID")
        try:
            self.assertNotEqual(sql(self.create_job_sql(), fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
            self.assertEqual(sql(f"SELECT count(*) FROM video_projects WHERE user_id='{self.user}'").stdout.strip(), "0")
        finally:
            sql("ALTER TABLE video_jobs DROP CONSTRAINT test_reject_new_job")

    def test_ark_task_uses_same_atomic_charge_and_refund(self):
        statement = self.create_job_sql().replace("'SeedanceMini'", "'ArkSeedance'").replace(
            self.versions["SeedanceMini"], self.versions["ArkSeedance"])
        job = json.loads(sql(statement).stdout)
        self.assertEqual(job["provider"], "ArkSeedance")
        self.assertEqual(job["billing_state"], "reserved")
        lease = self.claim_job(job)
        sql(self.job_event_sql(lease, "submit_rejected"))
        self.assertEqual(sql(f"SELECT status,billing_state FROM video_jobs WHERE id='{job['id']}'").stdout.strip(),
                         "failed|refunded")
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")

    def test_server_video_project_cannot_be_forged_or_deleted_in_flight(self):
        job = self.create_job()
        for statement in (
            f"UPDATE video_projects SET status='completed',video_url='https://fake.example/video.mp4' WHERE id='{job['project_id']}';",
            f"DELETE FROM video_projects WHERE id='{job['project_id']}';",
        ):
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)
        sql(self.as_user(f"UPDATE video_projects SET title='自定义标题' WHERE id='{job['project_id']}';"))
        lease = self.claim_job(job)
        sql(self.job_event_sql(lease, "submit_rejected"))
        sql(self.as_user(f"DELETE FROM video_projects WHERE id='{job['project_id']}';"))
        self.assertEqual(sql(f"SELECT status,billing_state FROM video_jobs WHERE id='{job['id']}'").stdout.strip(), "failed|refunded")

    def test_video_worker_claimed_once_and_browser_cannot_forge(self):
        job = self.create_job()
        statement = self.as_service(f"SELECT claim_video_job('{job['id']}')")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            outputs = list(pool.map(lambda _: sql(statement).stdout.strip(), range(4)))
            leases = [json.loads(output) if output else None for output in outputs]
        self.assertEqual(sum(lease is not None for lease in leases), 1)
        lease = next(lease for lease in leases if lease)
        for statement in (
            f"SELECT claim_video_job('{job['id']}');",
            f"SELECT create_video_job('{self.user}','{uuid.uuid4()}','MiniMax','{{}}',NULL);",
            f"SELECT checkpoint_video_job_result('{job['id']}','{lease['lease_token']}','submit_rejected');",
            f"SELECT record_video_job_event('{job['id']}','{lease['lease_token']}','failed');",
            f"SELECT reconcile_video_submission('{job['id']}',NULL,'fake upstream evidence');",
        ):
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)
        self.assertEqual(sql(self.as_user(f"SELECT count(*) FROM video_jobs WHERE user_id='{self.other}'")).stdout.strip(), "0")
        self.assertNotEqual(sql(self.job_event_sql(lease, "completed", video="'https://video.example/fake.mp4'"),
                                fail=False).returncode, 0)

    def test_video_failure_and_refund_are_atomic_and_once(self):
        job = self.submitted_job()
        sql("ALTER TABLE credit_logs ADD CONSTRAINT test_reject_video_refund CHECK (type <> 'refund') NOT VALID")
        try:
            self.assertNotEqual(sql(self.job_event_sql(job, "failed"), fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT status,billing_state FROM video_jobs WHERE id='{job['id']}'").stdout.strip(), "processing|reserved")
            self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "10")
        finally:
            sql("ALTER TABLE credit_logs DROP CONSTRAINT test_reject_video_refund")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: sql(self.job_event_sql(job, "failed")), range(4)))
        self.assertEqual(sql(f"SELECT status,billing_state FROM video_jobs WHERE id='{job['id']}'").stdout.strip(), "failed|refunded")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE original_charge_id='{job['charge_id']}'").stdout.strip(), "1")
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT status FROM video_projects WHERE id='{job['project_id']}'").stdout.strip(), "failed")

    def test_video_completion_settles_once_and_cannot_refund_later(self):
        job = self.submitted_job()
        sql(self.job_event_sql(job, "completed", video="'https://storage.example/video.mp4'"))
        sql(self.job_event_sql(job, "failed"))
        self.assertEqual(sql(f"SELECT status,billing_state,progress FROM video_jobs WHERE id='{job['id']}'").stdout.strip(), "completed|settled|100")
        self.assertEqual(sql(f"SELECT video_url FROM video_projects WHERE id='{job['project_id']}'").stdout.strip(), "https://storage.example/video.mp4")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE original_charge_id='{job['charge_id']}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "10")

    def test_video_timeout_does_not_resubmit_or_refund(self):
        job = self.claim_job(self.create_job())
        sql(f"UPDATE video_jobs SET lease_until=now()-interval '1 second' WHERE id='{job['id']}'")
        self.assertIsNone(self.claim_job(job))
        self.assertIsNone(self.claim_job(job))
        self.assertEqual(sql(f"SELECT submission_state,attempts,billing_state FROM video_jobs WHERE id='{job['id']}'").stdout.strip(), "unknown|1|reserved")
        self.assertNotEqual(sql(self.job_event_sql(job, "accepted", task="'late-task'"), fail=False).returncode, 0)
        sql(self.as_service(f"""SELECT reconcile_video_submission('{job['id']}','verified-task','在上游账单核对找到此任务标识');"""))
        lease = self.claim_job(job)
        self.assertEqual(lease["provider_task_id"], "verified-task")
        self.assertEqual(lease["attempts"], 1)
        sql(self.job_event_sql(lease, "failed"))

    def test_video_queries_backoff_and_expired_lease_can_retry(self):
        job = self.submitted_job()
        sql(self.job_event_sql(job, "query_error"))
        self.assertEqual(sql(f"SELECT status,billing_state,poll_errors FROM video_jobs WHERE id='{job['id']}'").stdout.strip(), "processing|reserved|1")
        lease = self.claim_job(job)
        sql(f"UPDATE video_jobs SET lease_until=now()-interval '1 second' WHERE id='{job['id']}'")
        new_lease = self.claim_job(job)
        self.assertNotEqual(lease["lease_token"], new_lease["lease_token"])
        self.assertNotEqual(sql(self.job_event_sql(lease, "failed"), fail=False).returncode, 0)
        sql(self.job_event_sql(new_lease, "pending"))
        self.assertEqual(sql(f"SELECT poll_errors FROM video_jobs WHERE id='{job['id']}'").stdout.strip(), "0")

    def test_video_old_cycle_failure_refunds_original_charge(self):
        job = self.submitted_job()
        sql(self.finalize(self.order()))
        self.charge(15)
        sql(self.job_event_sql(job, "failed"))
        self.assertEqual(sql(f"SELECT credits_total,credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "110|15")

    def test_video_refund_evidence_survives_failed_transaction_and_worker_restart(self):
        job = self.claim_job(self.create_job())
        sql(self.as_service(f"""SELECT checkpoint_video_job_result(
          '{job['id']}','{job['lease_token']}','submit_rejected',NULL,'provider rejected HTTP 422');"""))
        sql("ALTER TABLE credit_logs ADD CONSTRAINT test_refund_outage CHECK (type <> 'refund') NOT VALID")
        try:
            self.assertNotEqual(sql(self.job_event_sql(job, "submit_rejected"), fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT resolution_event->>'event' FROM video_jobs WHERE id='{job['id']}'").stdout.strip(), "submit_rejected")
        finally:
            sql("ALTER TABLE credit_logs DROP CONSTRAINT test_refund_outage")
        sql(f"UPDATE video_jobs SET lease_until=now()-interval '1 second' WHERE id='{job['id']}'")
        recovered = self.claim_job(job)
        self.assertEqual(recovered["submission_state"], "submitting")
        self.assertEqual(recovered["resolution_event"]["event"], "submit_rejected")
        sql(self.job_event_sql(recovered, "submit_rejected"))
        self.assertEqual(sql(f"SELECT status,billing_state,attempts FROM video_jobs WHERE id='{job['id']}'").stdout.strip(), "failed|refunded|1")

    def test_video_unknown_unaccepted_submission_reconciliation_is_audited(self):
        job = self.claim_job(self.create_job())
        sql(self.job_event_sql(job, "submit_unknown"))
        sql(self.as_service(f"""SELECT reconcile_video_submission('{job['id']}',NULL,'上游支持核对账单确认从未受理');"""))
        self.assertEqual(sql(f"SELECT status,billing_state FROM video_jobs WHERE id='{job['id']}'").stdout.strip(), "failed|refunded")
        self.assertEqual(sql(f"SELECT count(*) FROM audit_logs WHERE record_id='{job['id']}' AND action='reconcile_video_submission'").stdout.strip(), "1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
