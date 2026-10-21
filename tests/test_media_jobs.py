"""真实 PostgreSQL 验证音频/数字人并发计费、租约恢复、权限、配置版本及原子归档。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class MediaJobsTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    production_claim = finance.FinanceTest.production_claim
    production_event = finance.FinanceTest.production_event

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        finance.FinanceTest.setUp(self)
        for slot in ("audio.tts", "audio.asr", "audio.voice_clone", "avatar.photo", "avatar.lipsync"):
            old = sql(f"SELECT current_version_id FROM model_configs WHERE slot='{slot}'").stdout.strip()
            self.versions[slot] = sql(self.as_service(f"""SELECT save_model_config('{slot}',
              {"'"+old+"'" if old else "NULL"},'{{"name":"测试","model":"test"}}',true,'isolated','{self.other}',true)""")).stdout.strip()
        self.payload = {"input": "真实商品口播", "voice": "", "response_format": "mp3", "speed": 1, "instruction": ""}

    def statement(self, kind="tts", payload=None, key=None, user=None, version=None):
        slot = {"tts": "audio.tts", "asr": "audio.asr", "voice_clone": "audio.voice_clone",
                "avatar": "avatar.photo", "lipsync": "avatar.lipsync"}[kind]
        data = json.dumps(payload or self.payload, ensure_ascii=False).replace("'", "''")
        return self.as_service(f"""SELECT create_production_job('{user or self.user}','{key or uuid.uuid4()}',
          '{kind}','{data}',NULL,'{version or self.versions[slot]}')""")

    def test_concurrent_requests_charge_once_and_recover_when_disabled(self):
        statement = self.statement()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            jobs = list(pool.map(lambda _: json.loads(sql(statement).stdout), range(4)))
        self.assertEqual(len({job["id"] for job in jobs}), 1)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "2")
        sql("UPDATE model_configs SET enabled=false WHERE slot='audio.tts'")
        self.assertEqual(json.loads(sql(statement).stdout)["id"], jobs[0]["id"])
        self.assertNotEqual(sql(self.statement(), fail=False).returncode, 0)
        call = "SELECT " + statement.split("SELECT ", 1)[1]
        self.assertNotEqual(sql(self.as_user(call), fail=False).returncode, 0)

    def test_quota_is_shared_and_original_receipt_bypasses_full_queue(self):
        first = self.statement()
        job = json.loads(sql(first).stdout)
        for _ in range(9):
            sql(self.statement())
        self.assertNotEqual(sql(self.statement(), fail=False).returncode, 0)
        self.assertEqual(json.loads(sql(first).stdout)["id"], job["id"])
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "20")

    def test_changed_price_rejects_before_any_charge_or_project(self):
        payload = {**self.payload, "confirmed_credit_cost": 2}
        statement = self.statement(payload=payload)
        sql("UPDATE credit_costs SET cost=3 WHERE action='generate_tts'")
        try:
            self.assertNotEqual(sql(statement, fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
            self.assertEqual(sql(f"SELECT count(*) FROM production_jobs WHERE user_id='{self.user}'").stdout.strip(), "0")
        finally:
            sql("UPDATE credit_costs SET cost=2 WHERE action='generate_tts'")

    def test_crashed_submission_never_reposts_and_audited_rejection_refunds(self):
        job = self.production_claim(json.loads(sql(self.statement()).stdout))
        sql(self.production_event(job, "executing"))
        sql(f"UPDATE production_jobs SET lease_until=now()-interval '1 second' WHERE id='{job['id']}'")
        self.assertIsNone(self.production_claim(job))
        self.assertEqual(sql(f"SELECT status FROM production_jobs WHERE id='{job['id']}'").stdout.strip(), "unknown")
        call = f"SELECT reconcile_production_job('{job['id']}',NULL,'供应商账单及请求日志已确认未曾受理');"
        self.assertNotEqual(sql(self.as_user(call), fail=False).returncode, 0)
        sql(self.as_service(call))
        recovered = self.production_claim(job)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(lambda _: sql(self.production_event(recovered, "failed", recovered["resolution"]["data"])), range(3)))
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE original_charge_id='{job['charge_id']}'").stdout.strip(), "1")

    def test_audio_archive_failure_and_restart_are_atomic(self):
        job = self.production_claim(json.loads(sql(self.statement()).stdout))
        result = {"url": f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/audio.mp3", "size": 120}
        sql(self.production_event(job, "resolution", {"event": "completed", "data": result}))
        sql("ALTER TABLE materials ADD CONSTRAINT test_audio_outage CHECK(type<>'audio') NOT VALID")
        try:
            self.assertNotEqual(sql(self.production_event(job, "completed", result), fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT status FROM production_jobs WHERE id='{job['id']}'").stdout.strip(), "running")
        finally:
            sql("ALTER TABLE materials DROP CONSTRAINT test_audio_outage")
        sql(f"UPDATE production_jobs SET lease_until=now()-interval '1 second' WHERE id='{job['id']}'")
        recovered = self.production_claim(job)
        for _ in range(3):
            sql(self.production_event(recovered, "completed", result))
        self.assertEqual(sql(f"SELECT count(*) FROM materials WHERE user_id='{self.user}' AND type='audio'").stdout.strip(), "1")

    def test_voice_clone_is_private_and_tts_binds_original_version(self):
        payload = {"name": "我的声音", "audio_url": "https://audio.example/sample.wav", "filename": "sample.wav", "consent": True}
        job = self.production_claim(json.loads(sql(self.statement("voice_clone", payload)).stdout))
        result = {"voice_id": "provider-private-id", "requires_verification": False}
        data = json.loads(sql(self.production_event(job, "completed", result)).stdout)
        self.assertNotIn("voice_id", data["result"])
        clone_id = data["result"]["voice_clone_id"]
        self.assertNotEqual(sql(self.as_user("SELECT provider_voice_id FROM voice_clones"), fail=False).returncode, 0)
        self.assertEqual(sql(self.as_user("SELECT count(id) FROM voice_clones")).stdout.strip(), "1")
        sql(self.as_service(f"""SELECT save_model_config('audio.voice_clone','{self.versions["audio.voice_clone"]}',
          '{{"name":"新的克隆配置","model":"updated"}}',true,'new-credential','{self.other}',true)"""))
        tts = {**self.payload, "voice_clone_id": clone_id}
        saved = json.loads(sql(self.statement("tts", tts, version=self.versions["audio.voice_clone"])).stdout)
        self.assertEqual(saved["model_config_version_id"], self.versions["audio.voice_clone"])
        self.assertNotEqual(sql(self.statement("tts", tts, user=self.other, version=self.versions["audio.voice_clone"]), fail=False).returncode, 0)
        sql(f"UPDATE voice_clones SET requires_verification=true WHERE id='{clone_id}'")
        self.assertNotEqual(sql(self.statement("tts", tts, version=self.versions["audio.voice_clone"]), fail=False).returncode, 0)

    def test_avatar_project_and_output_cannot_be_forged(self):
        payload = {"title": "数字人口播", "audio_url": "https://audio.example/voice.mp3",
                   "image_url": "https://image.example/person.png", "consent": True}
        job = json.loads(sql(self.statement("avatar", payload)).stdout)
        self.assertIsNotNone(job["project_id"])
        self.assertNotEqual(sql(self.as_user(f"UPDATE video_projects SET status='completed' WHERE id='{job['project_id']}'"), fail=False).returncode, 0)
        lease = self.production_claim(job)
        sql(self.production_event(lease, "completed", {
            "url": f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/avatar.mp4", "size": 200}))
        self.assertEqual(sql(f"SELECT status,duration FROM video_projects WHERE id='{job['project_id']}'").stdout.strip(), "completed|")


if __name__ == "__main__":
    unittest.main(verbosity=2)
