"""隔离 PostgreSQL 验证多规格导出事务、并发幂等、队列容量与独立结案。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class RenderExportsTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    production_claim = finance.FinanceTest.production_claim
    production_event = finance.FinanceTest.production_event

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        finance.FinanceTest.setUp(self)
        self.source = str(uuid.uuid4())
        self.url = f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/source.mp4"
        sql(f"""INSERT INTO video_projects(id,user_id,title,status,duration,video_url)
          VALUES('{self.source}','{self.user}','源成片','completed',2,'{self.url}');""")
        self.request = {"source_project_id": self.source, "formats": [
            {"ratio": "4:5", "height": 720}, {"ratio": "9:16", "height": 1080}]}

    def statement(self, key=None, request=None, user=None, expected=None):
        payload = json.dumps(request or self.request)
        return self.as_service(f"""SELECT create_render_export('{user or self.user}','{key or uuid.uuid4()}',
          '{payload}','{expected or self.url}','{self.url}');""")

    def jobs(self, group):
        return [json.loads(line) for line in sql(
            f"SELECT to_jsonb(j) FROM production_jobs j WHERE export_id='{group}' ORDER BY created_at,id").stdout.splitlines()]

    def test_all_projects_jobs_and_audit_are_atomic_on_mid_batch_failure(self):
        sql("""ALTER TABLE production_jobs ADD CONSTRAINT test_export_failure
          CHECK(payload->>'ratio'<>'9:16') NOT VALID;""")
        try:
            self.assertNotEqual(sql(self.statement(), fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT count(*) FROM render_exports WHERE user_id='{self.user}'").stdout.strip(), "0")
            self.assertEqual(sql(f"SELECT count(*) FROM video_projects WHERE user_id='{self.user}'").stdout.strip(), "1")
            self.assertEqual(sql(f"SELECT count(*) FROM production_jobs WHERE user_id='{self.user}'").stdout.strip(), "0")
        finally:
            sql("ALTER TABLE production_jobs DROP CONSTRAINT test_export_failure")
        group = sql(self.statement()).stdout.strip()
        jobs = self.jobs(group)
        self.assertEqual(len(jobs), 2)
        self.assertEqual(len({job["project_id"] for job in jobs}), 2)
        self.assertEqual({job["payload"]["ratio"] for job in jobs}, {"4:5", "9:16"})
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM audit_logs WHERE record_id='{group}'").stdout.strip(), "1")

    def test_parallel_receipt_recovery_works_after_source_deleted(self):
        statement = self.statement()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            groups = list(pool.map(lambda _: sql(statement).stdout.strip(), range(4)))
        self.assertEqual(len(set(groups)), 1)
        sql(self.as_user(f"DELETE FROM video_projects WHERE id='{self.source}'"))
        self.assertEqual(sql(statement).stdout.strip(), groups[0])
        self.assertEqual(sql(f"SELECT count(*) FROM production_jobs WHERE user_id='{self.user}'").stdout.strip(), "2")
        changed = json.dumps({**self.request, "formats": [{"ratio": "1:1", "height": 720}]})
        self.assertNotEqual(sql(statement.replace(json.dumps(self.request), changed), fail=False).returncode, 0)

    def test_source_owner_and_changed_source_cannot_create_outputs(self):
        for statement in (self.statement(user=self.other), self.statement(expected="https://wrong.example/video"),
                          self.statement(request={**self.request, "formats": [{"ratio": "7:1", "height": 720}]}),
                          self.statement(request={**self.request, "formats": [self.request["formats"][0]] * 2})):
            self.assertNotEqual(sql(statement, fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM render_exports WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertNotEqual(sql(self.as_user("SELECT * FROM render_exports"), fail=False).returncode, 0)
        call = self.statement().split("SELECT create_render_export", 1)[1]
        self.assertNotEqual(sql(self.as_user("SELECT create_render_export" + call), fail=False).returncode, 0)

    def test_export_capacity_and_other_render_entry_share_same_quota(self):
        request = {"source_project_id": self.source, "formats": [
            {"ratio": ratio, "height": height} for ratio in ("9:16", "16:9", "1:1", "4:3", "3:4", "4:5")
            for height in (720, 1080, 2160)]}
        first = sql(self.statement(request=request)).stdout.strip()
        sql(self.statement(request={**request, "formats": request["formats"][:6]}))
        self.assertNotEqual(sql(self.statement(), fail=False).returncode, 0)
        project = str(uuid.uuid4())
        sql(f"INSERT INTO video_projects(id,user_id,title) VALUES('{project}','{self.user}','新的剪辑');")
        self.assertNotEqual(sql(self.as_service(f"""SELECT create_production_job('{self.user}','{uuid.uuid4()}',
          'render','{{"title":"新增"}}','{project}',NULL)"""), fail=False).returncode, 0)
        self.assertEqual(len(self.jobs(first)), 18)
        self.assertEqual(sql(f"SELECT count(*) FROM production_jobs WHERE user_id='{self.user}'").stdout.strip(), "24")

    def test_independent_success_failure_archives_exact_output_once(self):
        group = sql(self.statement()).stdout.strip()
        jobs = [self.production_claim(job) for job in self.jobs(group)]
        failed, completed = jobs
        sql(self.production_event(failed, "failed", {"error": "源格式无法编码"}))
        result = {"url": f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/render.mp4",
                  "duration": 2, "resolution": "720x900", "size": 200}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: sql(self.production_event(completed, "completed", result)), range(4)))
        self.assertEqual({job["status"] for job in self.jobs(group)}, {"failed", "completed"})
        self.assertEqual(sql(f"SELECT count(*) FROM materials WHERE user_id='{self.user}' AND type='video'").stdout.strip(), "1")
        self.assertEqual(sql(f"SELECT resolution FROM video_projects WHERE id='{completed['project_id']}'").stdout.strip(), "720x900")


if __name__ == "__main__":
    unittest.main(verbosity=2)
