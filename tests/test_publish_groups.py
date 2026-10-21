"""真实 PostgreSQL 验证多账号发布的事务、并发恢复、权限和独立执行。"""
import concurrent.futures
import copy
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class PublishGroupsTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    production_claim = finance.FinanceTest.production_claim
    production_event = finance.FinanceTest.production_event

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)
        sql("""INSERT INTO platform_apps(platform,client_key,secret_ciphertext,redirect_uri,scopes,enabled)
          VALUES('tiktok','local','cipher','https://local.example/callback',ARRAY['video.publish'],true),
          ('douyin','local','cipher','https://local.example/callback',ARRAY['video.create'],true)
          ON CONFLICT(platform) DO UPDATE SET enabled=true;""")

    def setUp(self):
        finance.FinanceTest.setUp(self)
        self.source, self.key = str(uuid.uuid4()), str(uuid.uuid4())
        self.url = f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/source.mp4"
        sql(f"""INSERT INTO video_projects(id,user_id,title,status,duration,video_url)
          VALUES('{self.source}','{self.user}','确认的成片','completed',2,'{self.url}');""")
        self.accounts = [str(uuid.uuid4()) for _ in range(10)]
        for index, account in enumerate(self.accounts):
            sql(f"""INSERT INTO platform_connections(id,user_id,platform,open_id,display_name,token_ciphertext,
              scopes,expires_at,app_snapshot) VALUES('{account}','{self.user}',
              '{"tiktok" if index % 2 == 0 else "douyin"}','{account}','账号{index}','cipher',
              ARRAY['video.publish'],now()+interval '1 day','{{}}');""")
        self.options = {"consent": True, "privacy_level": "SELF_ONLY", "disable_comment": True,
                        "disable_duet": True, "disable_stitch": True, "brand_content_toggle": False,
                        "brand_organic_toggle": False, "is_aigc": True}
        self.payload = {"project_id": self.source, "source_url": self.url, "duration": 2,
                        "title": "确认的标题", "description": "", "tags": [], "scheduled_at": None,
                        "targets": [{"connection_id": account, "options": self.options} for account in self.accounts[:2]]}

    def statement(self, payload=None, key=None, user=None, source=None):
        encoded = json.dumps(self.payload if payload is None else payload).replace("'", "''")
        return self.as_service(f"""SELECT create_publish_group('{user or self.user}','{key or self.key}',
          '{encoded}','{source or self.url}',2)""")

    def count(self, table):
        return int(sql(f"SELECT count(*) FROM {table} WHERE user_id='{self.user}'").stdout.strip())

    def jobs(self):
        return [json.loads(line) for line in sql(
            f"SELECT to_jsonb(j) FROM production_jobs j WHERE user_id='{self.user}' ORDER BY created_at,id").stdout.splitlines()]

    def test_atomic_rollback_when_second_account_is_invalid(self):
        # 排序后的第二账号拒绝，以验证第一任务已创建后也会被整笔回滚。
        second = sorted(self.accounts[:2])[1]
        sql(f"UPDATE platform_connections SET status='revoked' WHERE id='{second}'")
        self.assertNotEqual(sql(self.statement(), fail=False).returncode, 0)
        self.assertEqual(self.count("publish_groups"), 0)
        self.assertEqual(self.count("publish_tasks"), 0)
        self.assertEqual(self.count("production_jobs"), 0)
        sql(f"UPDATE platform_connections SET status='active' WHERE id='{second}'")
        group = sql(self.statement()).stdout.strip()
        self.assertEqual(self.count("publish_groups"), 1)
        self.assertEqual(self.count("publish_tasks"), 2)
        self.assertEqual(self.count("production_jobs"), 2)
        self.assertEqual(sql(f"SELECT count(*) FROM audit_logs WHERE record_id='{group}'").stdout.strip(), "1")
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual({job["payload"]["source_url"] for job in self.jobs()}, {self.url})

    def test_parallel_idempotency_order_insensitive_recovery_after_disconnect(self):
        statement = self.statement()
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            groups = list(pool.map(lambda _: sql(statement).stdout.strip(), range(5)))
        self.assertEqual(len(set(groups)), 1)
        self.assertEqual(self.count("production_jobs"), 2)
        sql(f"UPDATE platform_connections SET status='revoked' WHERE user_id='{self.user}'")
        reversed_payload = {**self.payload, "targets": self.payload["targets"][::-1]}
        self.assertEqual(sql(self.statement(reversed_payload)).stdout.strip(), groups[0])
        changed = {**self.payload, "title": "未确认的新内容"}
        self.assertNotEqual(sql(self.statement(changed), fail=False).returncode, 0)
        self.assertEqual(self.count("publish_tasks"), 2)

    def test_owner_source_schedule_duplicate_and_confirmation_boundaries(self):
        variants = []
        for field, value in [("source_url", "https://different.example/video.mp4"), ("duration", 3),
                             ("scheduled_at", "2000-01-01T00:00:00Z"),
                             ("targets", [self.payload["targets"][0]] * 2)]:
            variants.append({**self.payload, field: value})
        missing_consent = copy.deepcopy(self.payload)
        missing_consent["targets"][1]["options"]["consent"] = False
        variants.append(missing_consent)
        for payload in variants:
            self.assertNotEqual(sql(self.statement(payload), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.statement(user=self.other), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.statement(source="https://stale.example/video.mp4"), fail=False).returncode, 0)
        self.assertEqual(self.count("publish_groups"), 0)
        for statement in ["SELECT * FROM publish_groups", self.statement().split("; ", 1)[1]]:
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)

    def test_single_and_group_share_capacity_and_unknown_keeps_slot(self):
        many = {**self.payload, "targets": [{"connection_id": account, "options": self.options} for account in self.accounts]}
        sql(self.statement(many))
        sql(self.statement(many, key=str(uuid.uuid4())))
        sql(self.statement({**many, "targets": many["targets"][:4]}, key=str(uuid.uuid4())))
        self.assertEqual(self.count("production_jobs"), 24)
        self.assertNotEqual(sql(self.statement(key=str(uuid.uuid4())), fail=False).returncode, 0)
        single = self.as_service(f"""SELECT create_platform_publish('{self.user}','{uuid.uuid4()}','{self.source}',
          '{self.accounts[0]}','标题','',ARRAY[]::text[],'{json.dumps(self.options)}',NULL)""")
        self.assertNotEqual(sql(single, fail=False).returncode, 0)
        first = self.jobs()[0]
        sql(f"UPDATE production_jobs SET status='unknown' WHERE id='{first['id']}'")
        self.assertNotEqual(sql(single, fail=False).returncode, 0)
        sql(f"UPDATE production_jobs SET status='failed' WHERE id='{first['id']}'")
        self.assertEqual(sql(single).returncode, 0)
        self.assertEqual(self.count("production_jobs"), 25)

    def test_independent_failure_cancellation_and_worker_claims(self):
        sql(self.statement())
        jobs = self.jobs()
        task = sql(f"SELECT id FROM publish_tasks WHERE job_id='{jobs[0]['id']}'").stdout.strip()
        sql(self.as_service(f"SELECT cancel_platform_publish('{self.user}','{task}')"))
        second = self.production_claim(jobs[1])
        sql(self.production_event(second, "failed", {"error": "平台确定拒绝"}))
        statuses = sql(f"SELECT status FROM publish_tasks WHERE user_id='{self.user}' ORDER BY status").stdout.splitlines()
        self.assertEqual(statuses, ["cancelled", "failed"])
        self.assertNotEqual(sql(self.as_service(
            f"SELECT cancel_platform_publish('{self.other}','{task}')"), fail=False).returncode, 0)
        self.assertEqual(sql(self.statement()).returncode, 0)
        self.assertEqual(self.count("production_jobs"), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
