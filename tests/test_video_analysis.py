"""隔离数据库验证真实分析流水、阶段分工及退款；不连接线上。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance
sql = finance.sql


class AnalysisTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    production_event = finance.FinanceTest.production_event

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        finance.FinanceTest.setUp(self)
        for slot in ("text.primary", "audio.asr"):
            prior = sql(f"SELECT current_version_id FROM model_configs WHERE slot='{slot}'").stdout.strip()
            self.versions[slot] = sql(self.as_service(f"""SELECT save_model_config('{slot}',
              {"'"+prior+"'" if prior else "NULL"},'{{"name":"测试","model":"test"}}',true,'cipher','{self.other}',true)""")).stdout.strip()
        self.input = {"mode": "live", "title": "商品演示", "source_url": f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/source.mp4",
                      "confirmed_credit_cost": 6, "asr_version": self.versions["audio.asr"]}
        self.prepared = {"duration": 20.0, "source_hash": "a" * 64, "has_audio": True,
                         "frames": [{"time": 0, "url": "https://db.example/frame.jpg"}]}

    def create(self, key=None, payload=None):
        encoded = json.dumps(payload or self.input, ensure_ascii=False).replace("'", "''")
        return self.as_service(f"""SELECT create_production_job('{self.user}','{key or uuid.uuid4()}','analysis',
          '{encoded}',NULL,'{self.versions["text.primary"]}')""")

    def claim(self, kind="analysis"):
        output = sql(self.as_service(f"""SELECT claim_production_job('{kind}',
          (SELECT id FROM production_jobs WHERE user_id='{self.user}' ORDER BY created_at LIMIT 1))""")).stdout.strip()
        return json.loads(output) if output else None

    def test_concurrent_request_and_price_change_are_atomic(self):
        statement = self.create()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            jobs = list(pool.map(lambda _: json.loads(sql(statement).stdout), range(4)))
        self.assertEqual(len({job["id"] for job in jobs}), 1)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "6")
        self.assertNotEqual(sql(self.create(payload={**self.input, "confirmed_credit_cost": 5}), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_user("SELECT " + statement.split("SELECT ", 1)[1]), fail=False).returncode, 0)
        sql("UPDATE model_configs SET enabled=false WHERE slot='text.primary'")
        self.assertEqual(json.loads(sql(statement).stdout)["id"], jobs[0]["id"])

    def test_preprocess_and_model_workers_do_not_claim_wrong_stage(self):
        sql(self.create())
        self.assertIsNone(self.claim())
        local = self.claim("analysis_prepare")
        self.assertIsNone(self.claim("analysis_prepare"))
        sql(self.production_event(local, "prepared", self.prepared))
        self.assertIsNone(self.claim("analysis_prepare"))
        model = self.claim()
        self.assertEqual(model["id"], local["id"])
        self.assertEqual(model["evidence"]["source_hash"], "a" * 64)
        self.assertNotEqual(sql(self.production_event(local, "failed", {"error": "旧租约"}), fail=False).returncode, 0)

    def test_expired_model_submission_never_resubmits_and_failure_refunds_once(self):
        sql(self.create())
        local = self.claim("analysis_prepare")
        sql(self.production_event(local, "prepared", self.prepared))
        job = self.claim()
        sql(self.production_event(job, "executing"))
        sql(f"UPDATE production_jobs SET lease_until=now()-interval '1 second' WHERE id='{job['id']}'")
        self.assertIsNone(self.claim())
        self.assertEqual(sql(f"SELECT status FROM production_jobs WHERE id='{job['id']}'").stdout.strip(), "unknown")
        sql(self.as_service(f"SELECT reconcile_production_job('{job['id']}',NULL,'供应商核对记录确认分析结果无法交付')"))
        recovered = self.claim()
        for _ in range(3):
            sql(self.production_event(recovered, "failed", recovered["resolution"]["data"]))
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE original_charge_id='{job['charge_id']}'").stdout.strip(), "1")

    def test_quota_and_changed_input_cannot_duplicate_charge(self):
        statement = self.create()
        first = json.loads(sql(statement).stdout)
        sql(self.create()); sql(self.create())
        self.assertNotEqual(sql(self.create(), fail=False).returncode, 0)
        self.assertEqual(json.loads(sql(statement).stdout)["id"], first["id"])
        self.assertNotEqual(sql(self.create(key=first["request_key"], payload={**self.input, "title": "其他素材"}), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "18")

    def test_style_completion_is_private_and_archived_once(self):
        sql(self.create(payload={**self.input, "mode": "style"}))
        local = self.claim("analysis_prepare")
        sql(self.production_event(local, "prepared", self.prepared))
        job = self.claim()
        result = {**self.prepared, "duration": 20, "mode": "style", "source_url": self.input["source_url"],
                  "model_versions": {"text": self.versions["text.primary"], "asr": self.versions["audio.asr"]},
                  "report": {"rhythm": "口播", "pacing": "单镜头", "transitions": ["无"], "subtitle_style": "可见白字", "color_tone": "暖色"}}
        self.assertNotEqual(sql(self.production_event(job, "completed", {**result, "source_hash": "b" * 64}), fail=False).returncode, 0)
        sql(self.production_event(job, "resolution", {"event": "completed", "data": result}))
        for _ in range(3):
            sql(self.production_event(job, "completed", result))
        self.assertEqual(sql(self.as_user(f"SELECT count(*) FROM style_analyses WHERE id='{job['id']}'")).stdout.strip(), "1")
        self.assertEqual(sql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{self.other}'; SELECT count(*) FROM style_analyses WHERE id='{job['id']}'").stdout.strip(), "0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
