"""真实PostgreSQL：批次阶段预占、依赖启动、价格快照、租约、取消和退款。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class BatchPipelineTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    production_event = finance.FinanceTest.production_event
    claim_job = finance.FinanceTest.claim_job
    job_event_sql = finance.FinanceTest.job_event_sql

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        finance.FinanceTest.setUp(self)
        sql(f"UPDATE user_plans SET plan_id='{self.plan}',credits_total=1000 WHERE user_id='{self.user}'")
        self.product = str(uuid.uuid4())
        sql(f"INSERT INTO products(id,user_id,name,category) VALUES('{self.product}','{self.user}','测试商品','测试')")
        self.configs = {"video.SeedanceMini": self.versions["SeedanceMini"]}
        for slot, settings in (("audio.tts", {"model": "tts-1", "protocol": "openai-tts"}),
                               ("audio.asr", {"model": "whisper-1", "protocol": "openai-asr"})):
            prior = sql(f"SELECT current_version_id FROM model_configs WHERE slot='{slot}'").stdout.strip()
            self.configs[slot] = sql(self.as_service(f"""SELECT save_model_config('{slot}',
              {"'"+prior+"'" if prior else "NULL"},'{json.dumps(settings)}',true,'cipher','{self.other}',true)""")).stdout.strip()
        self.tts_cost = int(sql("SELECT cost FROM credit_costs WHERE action='generate_tts'").stdout)
        self.unit = 20 + self.tts_cost + 3
        self.request = {"name": "实际流水编排", "provider": "SeedanceMini", "product_ids": [self.product],
                        "settings": {"duration": 5, "ratio": "9:16", "resolution": "720P", "language": "zh"},
                        "pipeline": {"shots": ["特写", "展示"], "voice": "alloy", "subtitles": True,
                                     "transition": "none", "delivery": "publish"},
                        "expected_unit_cost": self.unit, "budget": self.unit}
        shot = {"title": "镜头", "prompt": "商品展示", "duration": 5, "ratio": "9:16", "resolution": "720P"}
        self.items = [{"product_id": self.product, "shots": [shot, shot], "narration": "已经确认的台词"}]

    def create_sql(self, key=None, request=None):
        return self.as_service(f"""SELECT create_batch_pipeline('{self.user}','{key or uuid.uuid4()}',
          '{json.dumps(request or self.request)}','{json.dumps(self.items)}','{json.dumps(self.configs)}')""")

    def create(self):
        return json.loads(sql(self.create_sql()).stdout)

    def stages(self, batch):
        return json.loads(sql(self.as_service(f"""SELECT jsonb_agg(to_jsonb(s) ORDER BY position)
          FROM batch_pipeline_state s WHERE batch_id='{batch["id"]}'""")).stdout)

    def advance(self, batch):
        return json.loads(sql(self.as_service(f"SELECT advance_batch_pipeline('{batch['id']}')")).stdout)

    def start(self, stage, payload=None):
        return sql(self.as_service(f"""SELECT start_batch_pipeline_stage('{stage['id']}',
          '{json.dumps(payload or {})}')""")).stdout.strip()

    def claim(self, stage, kind=None):
        value = sql(self.as_service(f"SELECT claim_production_job('{kind or stage['kind']}','{stage['production_job_id']}')")).stdout.strip()
        return json.loads(value) if value else None

    def snapshot(self, batch):
        return json.loads(sql(self.as_service(f"SELECT batch_video_snapshot('{self.user}','{batch['id']}')")).stdout)

    def test_atomic_prices_budget_and_concurrent_original_request(self):
        for request in ({**self.request, "budget": 1}, {**self.request, "expected_unit_cost": 1}):
            self.assertNotEqual(sql(self.create_sql(request=request), fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        statement = self.create_sql()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            batches = list(pool.map(lambda _: json.loads(sql(statement).stdout), range(4)))
        self.assertEqual(len({b["id"] for b in batches}), 1)
        self.assertEqual(batches[0]["reserved_credits"], self.unit)
        stages = self.stages(batches[0])
        self.assertEqual([s["kind"] for s in stages], ["video", "video", "tts", "subtitles", "render", "publish"])
        self.assertEqual(len({s["request_key"] for s in stages}), 6)
        self.assertEqual(sql(f"SELECT count(*) FROM production_jobs WHERE user_id='{self.user}'").stdout.strip(), "0")
        sql("UPDATE model_configs SET enabled=false")
        sql(f"DELETE FROM products WHERE id='{self.product}'")
        self.assertEqual(json.loads(sql(statement).stdout)["id"], batches[0]["id"])

    def test_launch_uses_original_charge_version_and_queue_quota(self):
        batch = self.create()
        tts = next(s for s in self.advance(batch) if s["kind"] == "tts")
        sql(f"""INSERT INTO production_jobs(user_id,request_key,kind,payload)
          SELECT '{self.user}',gen_random_uuid(),'tts','{{}}'::jsonb FROM generate_series(1,10)""")
        self.assertEqual(self.advance(batch), [])
        self.assertEqual(self.start(tts), "f")
        sql(f"DELETE FROM production_jobs WHERE user_id='{self.user}' AND payload='{{}}'::jsonb")
        sql("UPDATE credit_costs SET cost=99 WHERE action='generate_tts'; UPDATE model_configs SET enabled=false")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.start(tts), range(4)))
        self.assertEqual(results.count("t"), 1)
        current = next(s for s in self.stages(batch) if s["kind"] == "tts")
        job = self.claim(current)
        self.assertEqual(job["charge_id"], tts["charge_id"])
        self.assertEqual(job["model_config_version_id"], tts["model_version"])
        self.assertEqual(job["credit_cost"], self.tts_cost)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), str(self.unit))

    def test_pause_all_mirrors_unknown_no_repost_cancel_only_unsubmitted(self):
        batch = self.create()
        stages = self.stages(batch)
        tts = next(s for s in self.advance(batch) if s["kind"] == "tts")
        self.start(tts)
        tts = next(s for s in self.stages(batch) if s["kind"] == "tts")
        job = self.claim(tts)
        sql(self.production_event(job, "executing"))
        sql(self.as_service(f"SELECT control_batch_video('{self.user}','{batch['id']}','pause')"))
        for stage in stages[:2]:
            self.assertIsNone(self.claim_job({"id": stage["video_job_id"]}))
        sql(f"UPDATE production_jobs SET lease_until=now()-interval '1 second' WHERE id='{job['id']}'")
        self.assertIsNone(self.claim(tts))
        self.assertEqual(self.snapshot(batch)["attention_count"], 1)
        result = json.loads(sql(self.as_service(f"SELECT control_batch_video('{self.user}','{batch['id']}','cancel')")).stdout)
        self.assertEqual(result["reserved_credits"], self.tts_cost)
        self.assertEqual(result["refunded_credits"], 23)
        self.assertEqual(self.advance(batch), [])
        self.assertEqual(self.snapshot(batch)["status"], "cancelling")

    def test_cancel_refund_failure_rolls_back_and_retries_once(self):
        batch = self.create()
        statement = self.as_service(f"SELECT control_batch_video('{self.user}','{batch['id']}','cancel')")
        sql("ALTER TABLE credit_logs ADD CONSTRAINT pipeline_refund_outage CHECK(type<>'refund') NOT VALID")
        try:
            self.assertNotEqual(sql(statement, fail=False).returncode, 0)
            self.assertEqual(self.snapshot(batch)["reserved_credits"], self.unit)
        finally:
            sql("ALTER TABLE credit_logs DROP CONSTRAINT pipeline_refund_outage")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: json.loads(sql(statement).stdout), range(4)))
        self.assertEqual(results[-1]["refunded_credits"], self.unit)
        self.assertEqual(results[-1]["status"], "cancelled")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{self.user}' AND type='refund'").stdout.strip(), "4")

    def test_dependency_failure_releases_only_waiting_descendants_and_permissions(self):
        batch = self.create()
        tts = next(s for s in self.advance(batch) if s["kind"] == "tts")
        sql(self.as_service(f"SELECT fail_batch_pipeline_stage('{tts['id']}','配音输入非法')"))
        for _ in range(3):
            self.advance(batch)
        stages = self.stages(batch)
        self.assertEqual([s["status"] for s in stages[2:]], ["failed"] * 4)
        self.assertEqual(self.snapshot(batch)["refunded_credits"], self.tts_cost + 3)
        for statement in ("SELECT * FROM batch_pipeline_stages", "SELECT advance_batch_pipeline(NULL)",
                          f"DELETE FROM video_projects WHERE id='{batch['items'][0]['project_id']}'"):
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)
        self.assertEqual(sql(self.as_service(f"SELECT batch_video_snapshot('{self.other}','{batch['id']}')")).stdout.strip(), "")

    def test_audio_measurement_subtitles_render_and_confirmed_publish(self):
        batch = self.create()
        stages = self.stages(batch)
        for stage in stages[:2]:
            video = self.claim_job({"id": stage["video_job_id"]})
            sql(self.job_event_sql(video, "accepted", task=f"'{stage['id']}'"))
            video = self.claim_job({"id": stage["video_job_id"]})
            sql(self.job_event_sql(video, "completed", video="'https://db.example/shot.mp4'"))
        tts = next(s for s in self.advance(batch) if s["kind"] == "tts")
        self.start(tts)
        tts = next(s for s in self.stages(batch) if s["kind"] == "tts")
        voice_url = f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/voice.mp3"
        voice = self.claim(tts)
        sql(self.production_event(voice, "completed", {"url": voice_url, "size": 1000, "format": "mp3"}))
        sub = next(s for s in self.advance(batch) if s["kind"] == "subtitles")
        source = {"id": tts["id"], "type": "audio", "url": voice_url, "start": 0, "duration": 10, "sourceStart": 0, "speed": 1}
        self.start(sub, {"mode": "subtitles", "title": "实际台词", "source": source,
                         "confirmed_credit_cost": 3, "pipeline_audio": True})
        sub = next(s for s in self.stages(batch) if s["kind"] == "subtitles")
        lease = self.claim(sub, "edit_prepare")
        prepared = {"duration": 6.3, "source_hash": "a" * 64, "audio_url": voice_url}
        invalid = {**prepared, "duration": 11}
        self.assertNotEqual(sql(self.production_event(lease, "prepared", invalid), fail=False).returncode, 0)
        sql(self.production_event(lease, "prepared", prepared))
        sql(self.as_service(f"SELECT control_batch_video('{self.user}','{batch['id']}','pause')"))
        self.assertIsNone(self.claim(sub, "edit_analysis"))
        sql(self.as_service(f"SELECT control_batch_video('{self.user}','{batch['id']}','resume')"))
        lease = self.claim(sub, "edit_analysis")
        self.assertEqual(lease["payload"]["source"]["duration"], 6.3)
        result = {**prepared, "mode": "subtitles", "source": {**source, "duration": 6.3},
                  "asr_version": self.configs["audio.asr"], "segments": [{"start": .2, "end": 3, "text": "实际字幕"}]}
        sql(self.production_event(lease, "completed", result))
        render_stage = next(s for s in self.advance(batch) if s["kind"] == "render")
        render_spec = {"version": 1, "title": "最终成片", "duration": 10, "height": 720, "ratio": "9:16", "fps": 30, "tracks": []}
        self.start(render_stage, render_spec)
        render_stage = next(s for s in self.stages(batch) if s["kind"] == "render")
        style = json.loads(sql(f"SELECT style_data FROM video_projects WHERE id='{batch['items'][0]['project_id']}'").stdout)
        self.assertEqual(style["editorAspect"], "aspect-[9/16]")
        self.assertEqual(style["tracks"], render_spec["tracks"])
        lease = self.claim(render_stage, "render")
        final_url = f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/final.mp4"
        sql(self.production_event(lease, "completed", {"url": final_url, "duration": 10, "size": 1000, "resolution": "720P"}))
        completed = self.snapshot(batch)
        self.assertEqual(completed["status"], "awaiting_publish")
        self.assertEqual(completed["items"][0]["video_url"], final_url)
        self.assertEqual(completed["settled_credits"], self.unit)
        sql("""INSERT INTO platform_apps(platform,client_key,secret_ciphertext,redirect_uri,scopes,enabled)
          VALUES('douyin','local','cipher','https://local.example/callback',ARRAY['video.create'],true)
          ON CONFLICT(platform) DO UPDATE SET enabled=true""")
        account = str(uuid.uuid4())
        sql(f"""INSERT INTO platform_connections(id,user_id,platform,open_id,display_name,token_ciphertext,scopes,expires_at,app_snapshot)
          VALUES('{account}','{self.user}','douyin','{account}','测试账号','cipher',ARRAY['video.create'],now()+interval '1 day','{{}}')""")
        publish = next(s for s in self.stages(batch) if s["kind"] == "publish")
        payload = {"project_id": completed["items"][0]["project_id"], "batch_item_id": completed["items"][0]["id"],
                   "source_url": final_url, "duration": 10, "title": "预览确认", "description": "", "tags": [],
                   "targets": [{"connection_id": account, "options": {"consent": True, "privacy_level": "1",
                    "disable_comment": True, "disable_duet": True, "disable_stitch": True,
                    "brand_content_toggle": False, "brand_organic_toggle": False, "is_aigc": True}}]}
        statement = lambda key: self.as_service(f"""SELECT create_publish_group('{self.user}','{key}',
          '{json.dumps(payload)}','{final_url}',10)""")
        self.assertNotEqual(sql(statement(str(uuid.uuid4())), fail=False).returncode, 0)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            groups = list(pool.map(lambda _: sql(statement(publish["request_key"])).stdout.strip(), range(3)))
        self.assertEqual(len(set(groups)), 1)
        job = json.loads(sql(f"SELECT to_jsonb(p) FROM production_jobs p WHERE kind='publish' AND user_id='{self.user}'").stdout)
        sql(self.as_service(f"SELECT control_batch_video('{self.user}','{batch['id']}','pause')"))
        self.assertIsNone(self.claim({"kind": "publish", "production_job_id": job["id"]}))
        sql(self.as_service(f"SELECT control_batch_video('{self.user}','{batch['id']}','cancel')"))
        self.assertEqual(self.snapshot(batch)["status"], "cancelled")
        self.assertEqual(self.snapshot(batch)["settled_credits"], self.unit)

    def test_foreign_controls_cannot_mutate_batch_or_refunds(self):
        batch = self.create()
        before = self.snapshot(batch)
        for action in ("pause", "resume", "cancel"):
            statement = self.as_service(f"SELECT control_batch_video('{self.other}','{batch['id']}','{action}')")
            self.assertNotEqual(sql(statement, fail=False).returncode, 0)
            self.assertEqual(self.snapshot(batch), before)
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{self.user}' AND type='refund'").stdout.strip(), "0")

    def test_without_subtitles_still_measures_audio_without_asr_charge(self):
        self.request["pipeline"]["subtitles"] = False
        self.request["expected_unit_cost"] = self.request["budget"] = 20 + self.tts_cost
        batch = self.create()
        tts = next(s for s in self.advance(batch) if s["kind"] == "tts")
        self.start(tts)
        tts = next(s for s in self.stages(batch) if s["kind"] == "tts")
        voice_url = f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/voice.mp3"
        sql(self.production_event(self.claim(tts), "completed", {"url": voice_url, "size": 1000, "format": "mp3"}))
        stage = next(s for s in self.advance(batch) if s["kind"] == "subtitles")
        self.assertEqual(stage["credit_cost"], 0)
        self.assertIsNone(stage["model_version"])
        source = {"id": tts["id"], "type": "audio", "url": voice_url, "start": 0, "duration": 10, "sourceStart": 0, "speed": 1}
        self.start(stage, {"mode": "beats", "title": "配音测量", "source": source, "confirmed_credit_cost": 0, "pipeline_audio": True})
        stage = next(s for s in self.stages(batch) if s["kind"] == "subtitles")
        job = self.claim(stage, "edit_prepare")
        result = {"mode": "beats", "source": {**source, "duration": 2.4}, "duration": 2.4,
                  "source_hash": "b" * 64, "algorithm": "spectral-flux-v1", "beats": [], "bpm": None, "confidence": 0}
        sql(self.production_event(job, "completed", result))
        measured = next(s for s in self.stages(batch) if s["kind"] == "subtitles")
        self.assertEqual(measured["result"]["duration"], 2.4)
        self.assertEqual(self.snapshot(batch)["settled_credits"], self.tts_cost)
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{self.user}' AND action='generate_edit_subtitles'").stdout.strip(), "0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
