"""真实PostgreSQL验证剪辑音轨队列、价格、模型版本、租约和原流水退款。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class EditJobTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    production_event = finance.FinanceTest.production_event

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        finance.FinanceTest.setUp(self)
        prior = sql("SELECT current_version_id FROM model_configs WHERE slot='audio.asr'").stdout.strip()
        self.version = sql(self.as_service(f"""SELECT save_model_config('audio.asr',
          {"'"+prior+"'" if prior else "NULL"},'{{"name":"字幕","model":"whisper-1","protocol":"openai-asr"}}',
          true,'cipher','{self.other}',true)""")).stdout.strip()
        self.source = {"id": "voice", "type": "audio", "start": 2, "duration": 4, "sourceStart": 1, "speed": 1.5,
                       "url": f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/voice.wav"}
        self.evidence = {"duration": 4, "source_hash": "a" * 64, "audio_url": self.source["url"]}

    def create(self, key=None, mode="subtitles", cost=None, source=None, project=None):
        body = json.dumps({"title": "裁剪音轨", "mode": mode, "source": source or self.source,
                           "confirmed_credit_cost": (3 if mode == "subtitles" else 0) if cost is None else cost})
        version = f"'{self.version}'" if mode == "subtitles" else "NULL"
        target = f"'{project}'" if project else "NULL"
        return self.as_service(f"SELECT create_production_job('{self.user}','{key or uuid.uuid4()}','edit_analysis','{body}',{target},{version})")

    def claim(self, job, kind="edit_prepare"):
        value = sql(self.as_service(f"SELECT claim_production_job('{kind}','{job['id']}')")).stdout.strip()
        return json.loads(value) if value else None

    def output(self):
        return {"mode": "subtitles", "source": self.source, "duration": 4, "source_hash": "a" * 64,
                "asr_version": self.version, "segments": [{"start": .2, "end": 1.3, "text": "实际台词"}]}

    def test_concurrent_original_request_price_and_model_recovery(self):
        statement = self.create()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            jobs = list(pool.map(lambda _: json.loads(sql(statement).stdout), range(4)))
        self.assertEqual(len({job["id"] for job in jobs}), 1)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "3")
        sql("UPDATE model_configs SET enabled=false WHERE slot='audio.asr'")
        self.assertEqual(json.loads(sql(statement).stdout)["id"], jobs[0]["id"])
        self.assertNotEqual(sql(self.create(key=jobs[0]["request_key"], source={**self.source, "speed": 2}), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.create(cost=1), fail=False).returncode, 0)

    def test_atomic_invalid_input_quota_and_permission(self):
        for source in ({**self.source, "duration": -1}, {**self.source, "start": 599},
                       {**self.source, "speed": True}, {**self.source, "type": "text"}):
            self.assertNotEqual(sql(self.create(source=source), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM production_jobs WHERE user_id='{self.user}'").stdout.strip(), "0")
        for _ in range(3):
            sql(self.create(mode="beats"))
        self.assertNotEqual(sql(self.create(), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_user(f"SELECT claim_production_job('edit_prepare',NULL)"), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")

    def test_project_owner_price_rejection_and_cross_user_rls(self):
        own, other = str(uuid.uuid4()), str(uuid.uuid4())
        sql(f"INSERT INTO video_projects(id,user_id,title) VALUES('{own}','{self.user}','本人工程'),('{other}','{self.other}','其他工程')")
        for statement in (self.create(project=other), self.create(project=str(uuid.uuid4())), self.create(cost=1, project=own)):
            self.assertNotEqual(sql(statement, fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        job = json.loads(sql(self.create(project=own)).stdout)
        self.assertEqual(job["project_id"], own)
        self.assertEqual(sql(self.as_user(f"SELECT count(*) FROM production_jobs WHERE id='{job['id']}'")).stdout.strip(), "1")
        self.assertEqual(sql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{self.other}'; SELECT count(*) FROM production_jobs WHERE id='{job['id']}'").stdout.strip(), "0")

    def test_phase_isolation_stale_lease_and_completion_idempotence(self):
        job = json.loads(sql(self.create()).stdout)
        self.assertIsNone(self.claim(job, "edit_analysis"))
        local = self.claim(job)
        sql(self.production_event(local, "prepared", self.evidence))
        self.assertIsNone(self.claim(job))
        model = self.claim(job, "edit_analysis")
        self.assertNotEqual(sql(self.production_event(local, "failed", {"error": "旧租约"}), fail=False).returncode, 0)
        for _ in range(3):
            sql(self.production_event(model, "completed", self.output()))
        self.assertEqual(sql(f"SELECT status FROM production_jobs WHERE id='{job['id']}'").stdout.strip(), "completed")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{self.user}' AND action='generate_edit_subtitles'").stdout.strip(), "1")

    def test_wrong_source_version_bounds_and_overlapping_subtitles_rejected(self):
        job = json.loads(sql(self.create()).stdout)
        local = self.claim(job)
        self.assertNotEqual(sql(self.production_event(local, "prepared", {**self.evidence, "duration": 5}), fail=False).returncode, 0)
        sql(self.production_event(local, "prepared", self.evidence))
        model = self.claim(job, "edit_analysis")
        for change in ({"source": {**self.source, "speed": 1}}, {"asr_version": str(uuid.uuid4())}, {"source_hash": "b" * 64},
                       {"segments": [{"start": 3, "end": 5, "text": "超出"}]},
                       {"segments": [{"start": 0, "end": 1, "text": "甲"}, {"start": .9, "end": 2, "text": "乙"}]}):
            self.assertNotEqual(sql(self.production_event(model, "completed", {**self.output(), **change}), fail=False).returncode, 0)
        sql(self.production_event(model, "failed", {"error": "无有效时间分段"}))
        sql(self.production_event(model, "failed", {"error": "无有效时间分段"}))
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE original_charge_id='{job['charge_id']}'").stdout.strip(), "1")

    def test_unknown_submission_expiration_never_reissues_or_refunds(self):
        job = json.loads(sql(self.create()).stdout)
        local = self.claim(job)
        sql(self.production_event(local, "prepared", self.evidence))
        model = self.claim(job, "edit_analysis")
        sql(self.production_event(model, "executing"))
        self.assertNotEqual(sql(self.production_event(model, "retry"), fail=False).returncode, 0)
        sql(f"UPDATE production_jobs SET lease_until=now()-interval '1 second' WHERE id='{job['id']}'")
        self.assertIsNone(self.claim(job, "edit_analysis"))
        self.assertEqual(sql(f"SELECT status FROM production_jobs WHERE id='{job['id']}'").stdout.strip(), "unknown")
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "3")

    def test_real_beats_can_be_empty_but_positions_and_bpm_are_bounded(self):
        job = json.loads(sql(self.create(mode="beats")).stdout)
        local = self.claim(job)
        result = {"mode": "beats", "source": self.source, "duration": 4, "source_hash": "a" * 64,
                  "algorithm": "spectral-flux-v1", "beats": [], "bpm": None, "confidence": 0}
        for change in ({"bpm": 120}, {"beats": [2, 1]}, {"beats": [-.1]}, {"beats": [4]},
                       {"algorithm": "random"}, {"source": {**self.source, "sourceStart": 0}}):
            self.assertNotEqual(sql(self.production_event(local, "completed", {**result, **change}), fail=False).returncode, 0)
        sql(self.production_event(local, "completed", result))
        self.assertEqual(sql(f"SELECT credit_cost FROM production_jobs WHERE id='{job['id']}'").stdout.strip(), "0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
