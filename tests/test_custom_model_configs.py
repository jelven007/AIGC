"""真实数据库验证自建模型的并发创建、版本保存与权限。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance


class CustomModelConfigTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        self.admin, self.user = (str(uuid.uuid4()) for _ in range(2))
        finance.sql(f"""INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
          ('{self.admin}','admin@custom.example','{{"role":"admin"}}'),
          ('{self.user}','user@custom.example','{{}}');""")

    def service(self, statement):
        return "SET ROLE service_role; SET request.jwt.claim.role='service_role'; " + statement

    def create(self, slot, settings=None, actor=None):
        settings = json.dumps(settings or {"name": "自建模型", "protocol": "openai-chat"})
        return self.service(f"""SELECT create_custom_model_config(
          '{slot}','{settings}','{actor or self.admin}');""")

    def test_parallel_creation_is_idempotent_and_settings_cannot_be_reused(self):
        slot = f"custom.text.{uuid.uuid4()}"
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            versions = list(pool.map(lambda _: finance.sql(self.create(slot)).stdout.strip(), range(4)))
        self.assertEqual(len(set(versions)), 1)
        self.assertEqual(finance.sql(f"SELECT count(*) FROM model_config_versions WHERE slot='{slot}'").stdout.strip(), "1")
        self.assertNotEqual(finance.sql(self.create(slot, {"name": "不同名称"}), False).returncode, 0)

    def test_all_categories_save_new_versions_preserving_original(self):
        for category in ("text", "video", "image", "audio", "3d", "embedding"):
            slot = f"custom.{category}.{uuid.uuid4()}"
            original = finance.sql(self.create(slot)).stdout.strip()
            newer = finance.sql(self.service(f"""SELECT save_model_config(
              '{slot}','{original}','{{"name":"修改后"}}',false,NULL,'{self.admin}',false);""")).stdout.strip()
            self.assertNotEqual(newer, original)
            self.assertEqual(finance.sql(f"SELECT settings->>'name' FROM model_config_versions WHERE id='{original}'").stdout.strip(), "自建模型")
            self.assertEqual(finance.sql(self.create(slot)).stdout.strip(), newer, "重试创建不能覆盖后续修改")
            self.assertNotEqual(finance.sql(self.service(f"""SELECT save_model_config(
              '{slot}','{original}','{{}}',false,NULL,'{self.admin}',false);"""), False).returncode, 0)
            self.assertEqual(finance.sql(f"SELECT enabled FROM model_configs WHERE slot='{slot}'").stdout.strip(), "f")

    def test_permissions_and_invalid_slots_leave_no_records(self):
        for slot in ("text.primary", f"custom.avatar.{uuid.uuid4()}", "custom.text.invalid"):
            self.assertNotEqual(finance.sql(self.create(slot), False).returncode, 0)
        slot = f"custom.text.{uuid.uuid4()}"
        self.assertNotEqual(finance.sql(self.create(slot, actor=self.user), False).returncode, 0)
        self.assertNotEqual(finance.sql(f"""SET ROLE authenticated;
          SELECT create_custom_model_config('{slot}','{{"name":"非法"}}','{self.admin}');""", False).returncode, 0)
        self.assertEqual(finance.sql(f"SELECT count(*) FROM model_slot_catalog WHERE slot='{slot}'").stdout.strip(), "0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
