"""真实PG：图片编辑原UUID、计费、模型版本、素材权限与未知恢复。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class ImageEditingTest(unittest.TestCase):
    setUpClass = classmethod(finance.FinanceTest.setUpClass.__func__)
    as_user = finance.FinanceTest.as_user
    as_service = finance.FinanceTest.as_service
    production_event = finance.FinanceTest.production_event

    def setUp(self):
        finance.FinanceTest.setUp(self)
        sql(f"UPDATE user_plans SET credits_total=100 WHERE user_id='{self.user}'")
        previous = sql("SELECT current_version_id FROM model_configs WHERE slot='image.primary'").stdout.strip()
        settings = json.dumps({"name": "真实编辑", "protocol": "openai-images", "model": "gpt-image-1.5",
                              "endpoint": "https://api.openai.com/v1/images/generations", "edit_endpoint": "https://api.openai.com/v1/images/edits"})
        self.version = sql(self.as_service(f"""SELECT save_model_config('image.primary',
          {"'"+previous+"'" if previous else "NULL"},'{settings}',true,'cipher','{self.other}',true)""")).stdout.strip()
        sql(f"INSERT INTO storage.objects(bucket_id,name) VALUES('materials','{self.user}/original.png'),('materials','{self.user}/mask.png'),('materials','{self.other}/mask.png')")
        self.payload = {"mode": "outpaint", "prompt": "延续自然光背景", "size": "1024x1024", "quality": "low",
                        "reference_image": f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/original.png",
                        "mask_image": f"https://db.example/storage/v1/object/authenticated/materials/{self.user}/mask.png",
                        "confirmed_credit_cost": 10, "confirmed_model_version": self.version}

    def create(self, key=None, payload=None, version=None):
        return self.as_service(f"""SELECT create_production_job('{self.user}','{key or uuid.uuid4()}','image',
          '{json.dumps(payload or self.payload)}',NULL,'{version or self.version}')""")

    def claim(self, job):
        value = sql(self.as_service(f"SELECT claim_production_job('image','{job['id']}')")).stdout.strip()
        return json.loads(value) if value else None

    def test_same_request_concurrent_charge_and_disabled_config_recovery(self):
        statement = self.create()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            jobs = list(pool.map(lambda _: json.loads(sql(statement).stdout), range(4)))
        self.assertEqual(len({job["id"] for job in jobs}), 1)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "10")
        sql("UPDATE model_configs SET enabled=false WHERE slot='image.primary'")
        sql("UPDATE credit_costs SET cost=17 WHERE action='generate_image'")
        self.assertEqual(json.loads(sql(statement).stdout)["id"], jobs[0]["id"])
        self.assertNotEqual(sql(self.create(key=jobs[0]["request_key"], payload={**self.payload, "prompt": "修改"}), fail=False).returncode, 0)
        sql("UPDATE credit_costs SET cost=10 WHERE action='generate_image'")

    def test_invalid_input_authorization_and_price_zero_charge(self):
        invalid = [{"mode": "fake"}, {"mode": "generate"}, {"mask_image": None}, {"confirmed_credit_cost": 1},
                   {"confirmed_model_version": str(uuid.uuid4())}, {"prompt": 42},
                   {"mask_image": self.payload["mask_image"].replace(self.user, self.other)},
                   {"mask_image": self.payload["mask_image"].replace("mask.png", "missing.png")},
                   {"mask_image": "https://external.example/mask.png"}]
        for change in invalid:
            self.assertNotEqual(sql(self.create(payload={**self.payload, **change}), fail=False).returncode, 0, change)
        self.assertEqual(sql(f"SELECT count(*) FROM production_jobs WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertNotEqual(sql(self.as_user("SELECT image_editing_schema_ready()"), fail=False).returncode, 0)
        self.assertEqual(sql(self.as_service("SELECT image_editing_schema_ready()")).stdout.strip(), "t")
        self.assertNotEqual(sql(self.as_service(f"SELECT create_production_job_before_image_edit('{self.user}','{uuid.uuid4()}','image','{{}}',NULL,NULL)"), fail=False).returncode, 0)

    def test_unknown_execution_preserves_charge_and_no_reclaim(self):
        job = json.loads(sql(self.create()).stdout)
        claimed = self.claim(job)
        sql(self.production_event(claimed, "executing"))
        sql(f"UPDATE production_jobs SET lease_until=now()-interval '1 second' WHERE id='{job['id']}'")
        self.assertIsNone(self.claim(job))
        self.assertEqual(sql(f"SELECT status FROM production_jobs WHERE id='{job['id']}'").stdout.strip(), "unknown")
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "10")
        self.assertEqual(json.loads(sql(self.create(key=job["request_key"])).stdout)["id"], job["id"])

    def test_known_failure_refunds_original_once_and_checkpoint_keeps_model_version(self):
        job = json.loads(sql(self.create()).stdout)
        claimed = self.claim(job)
        sql(self.production_event(claimed, "executing"))
        sql(self.production_event(claimed, "failed", {"error": "模型返回 HTTP 422"}))
        sql(self.production_event(claimed, "failed", {"error": "模型返回 HTTP 422"}))
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE original_charge_id='{job['charge_id']}'").stdout.strip(), "1")
        second = json.loads(sql(self.create(payload={**self.payload, "mode": "inpaint"})).stdout)
        claimed = self.claim(second)
        sql(self.production_event(claimed, "checkpoint", {"data": [{"b64_json": "saved"}]}))
        sql(self.production_event(claimed, "retry", {"error": "归档暂时失败"}))
        sql("UPDATE model_configs SET enabled=false WHERE slot='image.primary'")
        sql(f"UPDATE production_jobs SET next_run_at=now(),lease_until=NULL WHERE id='{second['id']}'")
        reclaimed = self.claim(second)
        self.assertEqual(reclaimed["model_config_version_id"], self.version)
        self.assertEqual(reclaimed["evidence"]["data"][0]["b64_json"], "saved")


if __name__ == "__main__":
    unittest.main(verbosity=2)
