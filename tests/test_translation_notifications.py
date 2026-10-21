"""真实PG回归：翻译版本与扣费、竞品证据、通知去重和隔离。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql
encode = lambda value: json.dumps(value, ensure_ascii=False).replace("'", "''")


class TranslationNotificationsTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    production_claim = finance.FinanceTest.production_claim
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
        sql("UPDATE credit_costs SET cost=2 WHERE action='generate_product_translate'")
        self.product = sql(f"""INSERT INTO products(user_id,name,category,description,selling_points,specs)
          VALUES('{self.user}','杯子','家居用品','不锈钢杯',ARRAY['500ml容量'],'[{{"name":"颜色","value":"白色"}}]') RETURNING id""").stdout.strip()
        self.request = {"product_id": self.product, "expected_updated_at": self.product_row()["updated_at"],
                        "target_language": "en", "include_image": False, "confirmed_credit_cost": 2}

    def product_row(self):
        return json.loads(sql(f"SELECT to_jsonb(p) FROM products p WHERE id='{self.product}'").stdout)

    def create_sql(self, key=None, request=None, user=None):
        return self.as_service(f"SELECT create_product_translation('{user or self.user}','{key or uuid.uuid4()}',"
                               f"'{encode(request or self.request)}','{self.versions['text.primary']}')")

    def create(self, **kwargs):
        return json.loads(sql(self.create_sql(**kwargs)).stdout)

    def row(self, job):
        return json.loads(sql(f"SELECT to_jsonb(j) FROM production_jobs j WHERE id='{job['id']}'").stdout)

    def result(self, job):
        return {"product_id": self.product, "source_updated_at": self.request["expected_updated_at"],
                "source_hash": job["payload"]["source_hash"], "target_language": "en", "version_id": self.versions["text.primary"],
                "translation": {"name": "Cup", "description": "Stainless steel cup", "selling_points": ["500ml capacity"],
                                "specs": [{"name": "Color", "value": "White"}]}, "image_text": [], "image_hash": None}

    def feed(self):
        return json.loads(sql(self.as_user("SELECT read_notifications()")).stdout)

    def test_parallel_create_binds_source_charges_once_and_restores_after_delete(self):
        key = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            jobs = list(pool.map(lambda _: self.create(key=key), range(4)))
        self.assertEqual(len({job["id"] for job in jobs}), 1)
        job = jobs[0]
        self.assertEqual(job["payload"]["source"]["name"], "杯子")
        self.assertEqual(len(job["payload"]["source_hash"]), 64)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "2")
        sql(f"DELETE FROM products WHERE id='{self.product}'")
        sql("UPDATE model_configs SET enabled=false WHERE slot='text.primary'")
        sql("UPDATE credit_costs SET cost=9 WHERE action='generate_product_translate'")
        self.assertEqual(self.create(key=key)["id"], job["id"])
        self.assertNotEqual(sql(self.create_sql(key=key, request={**self.request, "target_language": "ja"}), False).returncode, 0)

    def test_owner_version_price_and_model_change_never_charge(self):
        for options in ({"user": self.other}, {"request": {**self.request, "expected_updated_at": "2020-01-01"}},
                        {"request": {**self.request, "confirmed_credit_cost": 1}},
                        {"request": {**self.request, "include_image": True}},
                        {"request": {**self.request, "target_language": "invalid"}}):
            self.assertNotEqual(sql(self.create_sql(**options), False).returncode, 0)
        sql("UPDATE model_configs SET enabled=false WHERE slot='text.primary'")
        self.assertNotEqual(sql(self.create_sql(), False).returncode, 0)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertNotEqual(sql(self.as_user("SELECT create_product_translation(NULL,NULL,'{}',NULL)"), False).returncode, 0)

    def test_insert_failure_rolls_back_charge(self):
        sql("ALTER TABLE production_jobs ADD CONSTRAINT test_translation_insert CHECK(kind<>'product_translate') NOT VALID")
        try:
            self.assertNotEqual(sql(self.create_sql(), False).returncode, 0)
            self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        finally:
            sql("ALTER TABLE production_jobs DROP CONSTRAINT test_translation_insert")

    def test_shared_capacity_counts_unknown_and_concurrent_imports(self):
        first = self.create()
        sql(f"UPDATE production_jobs SET status='unknown' WHERE id='{first['id']}'")
        sql(self.as_service(f"SELECT create_product_import('{self.user}','{uuid.uuid4()}','{{\"mode\":\"text\",\"content\":\"商品名称：杯子\"}}')"))
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            outcomes = list(pool.map(lambda _: sql(self.create_sql(), False), range(5)))
        self.assertEqual(sum(result.returncode == 0 for result in outcomes), 2)
        self.assertEqual(sql(f"SELECT count(*) FROM production_jobs WHERE user_id='{self.user}'").stdout.strip(), "4")
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "6")

    def test_expired_executing_never_reposts_and_resolutions_resume(self):
        job = self.production_claim(self.create())
        sql(self.production_event(job, "executing"))
        self.assertNotEqual(sql(self.production_event(job, "retry"), False).returncode, 0)
        sql(f"UPDATE production_jobs SET lease_until=now()-interval '1 second' WHERE id='{job['id']}'")
        self.assertIsNone(self.production_claim(job))
        self.assertEqual(self.row(job)["status"], "unknown")
        self.assertEqual(self.feed()["items"][0]["level"], "warning")
        result = self.result(job)
        invalid = {**result, "source_hash": "b"*64}
        self.assertNotEqual(sql(self.as_service(f"SELECT reconcile_production_job('{job['id']}','{encode(invalid)}',"
                                              "'根据供应商账单核对原翻译结果')"), False).returncode, 0)
        self.assertNotEqual(sql(self.as_user(f"SELECT reconcile_production_job('{job['id']}','{encode(result)}',"
                                           "'根据供应商账单核对原翻译结果')"), False).returncode, 0)
        sql(self.as_service(f"SELECT reconcile_production_job('{job['id']}','{encode(result)}','根据供应商账单核对原翻译结果')"))
        resumed = self.production_claim(job)
        sql(self.production_event(resumed, "completed", result))
        self.assertEqual(self.row(job)["status"], "completed")
        other = self.production_claim(self.create())
        result = self.result(other)
        sql(self.production_event(other, "executing"))
        sql(self.production_event(other, "resolution", {"event": "completed", "data": result}))
        sql(f"UPDATE production_jobs SET lease_until=now()-interval '1 second' WHERE id='{other['id']}'")
        resumed = self.production_claim(other)
        sql(self.production_event(resumed, "completed", result))
        self.assertEqual(self.row(other)["status"], "completed")

    def test_source_validation_failure_refunds_once_and_prunes(self):
        job = self.production_claim(self.create())
        result = self.result(job)
        for patch in ({"source_hash": "b"*64}, {"version_id": str(uuid.uuid4())},
                      {"translation": {**result["translation"], "selling_points": []}},
                      {"image_text": [{"original": "forged", "translated": "fake"}]}):
            self.assertNotEqual(sql(self.production_event(job, "completed", {**result, **patch}), False).returncode, 0)
        sql(self.production_event(job, "failed", {"error": "模型结构不符合要求"}))
        sql(self.production_event(job, "failed", {"error": "模型结构不符合要求"}))
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(len(self.feed()["items"]), 1)
        sql(f"UPDATE production_jobs SET completed_at=now()-interval '31 days' WHERE id='{job['id']}'")
        sql(self.as_service("SELECT prune_product_translations()"))
        self.assertNotIn("source", self.row(job)["payload"])
        self.assertEqual(self.row(job)["result"], {"expired": True})

    def test_success_is_preview_and_does_not_change_product(self):
        job = self.production_claim(self.create())
        sql(f"UPDATE products SET name='更新后的杯子' WHERE id='{self.product}'")
        sql(self.production_event(job, "completed", self.result(job)))
        self.assertEqual(self.product_row()["name"], "更新后的杯子")
        self.assertEqual(self.row(job)["result"]["translation"]["name"], "Cup")

    def test_image_search_result_is_bound_to_hash_and_market(self):
        prior = sql("SELECT current_version_id FROM model_configs WHERE slot='intelligence.ebay'").stdout.strip()
        version = sql(self.as_service(f"""SELECT save_model_config('intelligence.ebay',
          {"'"+prior+"'" if prior else "NULL"},'{{"name":"eBay"}}',true,'cipher','{self.other}',true)""")).stdout.strip()
        params = {"search_mode": "image", "image_hash": "a"*64, "market": "US",
                  "image_url": f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/cup.png"}
        target = json.loads(sql(self.as_service(f"SELECT save_intelligence_target('{self.user}','{uuid.uuid4()}',"
                              f"'图片选品','intelligence_products','intelligence.ebay','{encode(params)}')")).stdout)["id"]
        job = json.loads(sql(self.as_service(f"SELECT create_intelligence_job('{self.user}','{uuid.uuid4()}',"
                            f"'{target}',2,'{version}')")).stdout)
        job = self.production_claim(job)
        result = {"source": {"slot": "intelligence.ebay", "version_id": version}, "items": [],
                  "params": {"search_mode": "image", "market": "US", "image_hash": "a"*64}}
        forged = {**result, "params": {**result["params"], "image_hash": "b"*64}}
        self.assertNotEqual(sql(self.production_event(job, "completed", forged), False).returncode, 0)
        sql(self.production_event(job, "completed", result))
        self.assertEqual(self.row(job)["status"], "completed")

    def test_notifications_isolated_soft_delete_dedup_and_cutoff(self):
        job = self.production_claim(self.create())
        sql(self.production_event(job, "completed", self.result(job)))
        feed = self.feed()
        notification = feed["items"][0]["id"]
        self.assertNotEqual(sql(self.as_user("DELETE FROM notifications"), False).returncode, 0)
        self.assertNotEqual(sql(self.as_user(f"UPDATE notification_preferences SET task_success=false"), False).returncode, 0)
        sql(self.as_user(f"SELECT mutate_notifications('delete',ARRAY['{notification}'::uuid])"))
        sql(f"UPDATE production_jobs SET status='pending' WHERE id='{job['id']}'")
        sql(f"UPDATE production_jobs SET status='completed' WHERE id='{job['id']}'")
        self.assertEqual(self.feed()["total"], 0)
        self.assertEqual(sql(f"SELECT count(*) FROM notifications WHERE user_id='{self.user}'").stdout.strip(), "1")
        second = self.production_claim(self.create())
        sql(self.production_event(second, "failed", {"error": "failed"}))
        sql(self.as_user(f"SELECT mutate_notifications('read_all','{{}}','{feed['cutoff']}')"))
        self.assertEqual(self.feed()["unread_all"], 1)
        self.assertEqual(sql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{self.other}'; SELECT count(*) FROM notifications").stdout.strip(), "0")
        sql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{self.other}'; SELECT mutate_notifications('read',ARRAY['{self.feed()['items'][0]['id']}'::uuid])")
        self.assertEqual(self.feed()["unread_all"], 1)
        self.assertNotEqual(sql(self.as_user("SELECT mutate_notifications('read_all','{}',now()+interval '1 day')"), False).returncode, 0)

    def test_preferences_keep_failure_and_unknown_alerts(self):
        sql(self.as_user("""SELECT mutate_notifications('preferences','{}',NULL,
          '{"task_success":false,"intelligence_success":false}')"""))
        success = self.production_claim(self.create())
        sql(self.production_event(success, "completed", self.result(success)))
        self.assertEqual(self.feed()["total"], 0)
        failure = self.production_claim(self.create())
        sql(self.production_event(failure, "failed", {"error": "failed"}))
        self.assertEqual(self.feed()["unread_all"], 1)
        sql(self.as_user(f"SELECT mutate_notifications('read_all','{{}}','{self.feed()['cutoff']}')"))
        sql(self.as_user(f"SELECT mutate_notifications('clear_read','{{}}','{self.feed()['cutoff']}')"))
        self.assertEqual(self.feed()["total"], 0)
        sql(f"UPDATE notifications SET created_at=now()-interval '181 days' WHERE user_id='{self.user}'")
        sql(self.as_service("SELECT prune_notifications()"))
        self.assertEqual(sql(f"SELECT count(*) FROM notifications WHERE user_id='{self.user}'").stdout.strip(), "0")

    def test_video_and_publish_alerts_follow_public_terminal_state(self):
        project = sql(f"INSERT INTO video_projects(user_id,title) VALUES('{self.user}','实际作品') RETURNING id").stdout.strip()
        video = sql(f"INSERT INTO video_jobs(user_id,project_id,status,submission_state) "
                    f"VALUES('{self.user}','{project}','processing','unknown') RETURNING id").stdout.strip()
        self.assertEqual(self.feed()["items"][0]["level"], "warning")
        sql(f"UPDATE video_jobs SET status='completed' WHERE id='{video}'")
        self.assertEqual(self.feed()["unread_all"], 2)
        sql(f"INSERT INTO production_jobs(user_id,request_key,kind,payload,status) "
            f"VALUES('{self.user}','{uuid.uuid4()}','publish','{{}}','completed')")
        self.assertEqual(self.feed()["unread_all"], 2)
        publish = sql(f"INSERT INTO publish_tasks(user_id,project_id,platform,status) "
                      f"VALUES('{self.user}','{project}','tiktok','submitted') RETURNING id").stdout.strip()
        sql(f"UPDATE publish_tasks SET status='moderating' WHERE id='{publish}'")
        self.assertEqual(self.feed()["unread_all"], 2)
        sql(f"UPDATE publish_tasks SET status='published' WHERE id='{publish}'")
        newest = self.feed()["items"][0]
        self.assertEqual(newest["category"], "publish")
        self.assertEqual(newest["source_id"], publish)
        self.assertEqual(newest["level"], "success")

    def test_competitor_reference_is_verified_and_survives_source_delete(self):
        target, sample = str(uuid.uuid4()), str(uuid.uuid4())
        item = {"id": "actual-video", "title": "真实演示", "url": "https://www.youtube.com/watch?v=abcdefghijk", "views": 321}
        source = {"slot": "intelligence.youtube", "version_id": self.versions["text.primary"], "observed_at": "2026-10-22"}
        sql(f"""INSERT INTO intelligence_targets(id,user_id,request_key,name,kind,source_slot,params)
          VALUES('{target}','{self.user}','{uuid.uuid4()}','频道','intelligence_competitor','intelligence.youtube','{{}}');
          INSERT INTO production_jobs(id,user_id,request_key,kind,payload,status) VALUES('{sample}','{self.user}',
          '{uuid.uuid4()}','intelligence_competitor','{{}}','completed');
          INSERT INTO intelligence_samples(job_id,target_id,user_id,data) VALUES('{sample}','{target}','{self.user}',
          '{encode({"source": source, "items": [item]})}');""")
        payload = {"mode": "style", "title": "用户上传的视频", "source_url": "https://db.example/private.mp4",
                   "confirmed_credit_cost": 6, "asr_version": self.versions["audio.asr"],
                   "competitor_reference": {"sample_id": sample, "item_id": "actual-video", "rights_confirmed": True}}
        key = str(uuid.uuid4())
        statement = self.as_service(f"SELECT create_production_job('{self.user}','{key}','analysis','{encode(payload)}',NULL,'{self.versions['text.primary']}')")
        job = json.loads(sql(statement).stdout)
        context = json.loads(sql(f"SELECT context FROM analysis_intelligence_references WHERE job_id='{job['id']}'").stdout)
        self.assertEqual(context["item"], item)
        self.assertNotEqual(sql(self.as_user("SELECT * FROM analysis_intelligence_references"), False).returncode, 0)
        sql(f"DELETE FROM intelligence_targets WHERE id='{target}'")
        self.assertEqual(json.loads(sql(statement).stdout)["id"], job["id"])
        forged = {**payload, "competitor_reference": {**payload["competitor_reference"], "rights_confirmed": False}}
        self.assertNotEqual(sql(self.as_service(f"SELECT create_production_job('{self.user}','{uuid.uuid4()}','analysis',"
                                              f"'{encode(forged)}',NULL,'{self.versions['text.primary']}')"), False).returncode, 0)
        lease = json.loads(sql(self.as_service(f"SELECT claim_production_job('analysis_prepare','{job['id']}')")).stdout)
        prepared = {"duration": 20, "source_hash": "a"*64, "has_audio": False, "frames": [{"time": 0, "url": "https://db.example/frame.jpg"}]}
        sql(self.production_event(lease, "prepared", prepared))
        lease = self.production_claim(job)
        result = {"mode": "style", "source_url": payload["source_url"], "duration": 20, "source_hash": "a"*64,
                  "model_versions": {"text": self.versions["text.primary"], "asr": self.versions["audio.asr"]},
                  "report": {"rhythm": "节奏", "transitions": [], "subtitle_style": "未测量", "color_tone": "自然",
                             "pacing": "未测量"}, "competitor_reference": context}
        self.assertNotEqual(sql(self.production_event(lease, "completed", {**result, "competitor_reference": {"fake": True}}), False).returncode, 0)
        sql(self.production_event(lease, "completed", result))
        sql(f"UPDATE production_jobs SET completed_at=now()-interval '31 days' WHERE id='{job['id']}'")
        sql(self.as_service("SELECT prune_product_translations()"))
        self.assertNotIn("competitor_reference", self.row(job)["result"])
        self.assertEqual(sql(f"SELECT count(*) FROM analysis_intelligence_references WHERE job_id='{job['id']}'").stdout.strip(), "0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
