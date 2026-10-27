"""真实PG验证原脚本回执、资金和每次模型尝试；不调用真实模型。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class AIRequestsTest(unittest.TestCase):
    setUp = finance.FinanceTest.setUp
    as_user = finance.FinanceTest.as_user
    as_service = finance.FinanceTest.as_service

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def begin(self, key=None, product="商品"):
        key = key or str(uuid.uuid4())
        body = json.dumps({"product_name": product, "platform": "douyin", "selling_points": ["耐用"],
                           "audience": "通勤者", "pain_points": []}, ensure_ascii=False)
        return self.as_service(f"SELECT begin_script_request('{self.user}','{key}','{body}');")

    def test_parallel_original_request_deducts_once_and_conflict_rejected(self):
        key = str(uuid.uuid4())
        command = self.begin(key)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: json.loads(sql(command).stdout), range(4)))
        self.assertEqual(sum(row["created"] for row in responses), 1)
        self.assertEqual(len({row["id"] for row in responses}), 1)
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{self.user}' AND action='generate_script_four_layer'").stdout.strip(), "1")
        self.assertNotEqual(sql(self.begin(key, "其他商品"), fail=False).returncode, 0)

    def test_existing_editor_script_columns_are_supported(self):
        sql(self.as_user(f"""INSERT INTO scripts(user_id,title,product_name,pain_points,full_content)
          VALUES('{self.user}','脚本标题','商品',ARRAY['携带麻烦'],'原脚本正文');"""))
        self.assertEqual(sql(self.as_user("SELECT full_content FROM scripts")).stdout.strip(), "原脚本正文")

    def test_saved_model_result_recovers_after_insert_failure_without_charge(self):
        receipt = json.loads(sql(self.begin()).stdout)
        result = {"scenes": [{"order": 1, "scene": "开场", "visual": "展示商品", "dialogue": "商品介绍",
                               "prompt": "Show product", "duration": 3, "layer": "hook"}], "prompt_text": "Product video"}
        sql(self.as_service(f"SELECT checkpoint_script_result('{self.user}','{receipt['id']}','原模型结果','{json.dumps(result, ensure_ascii=False)}');"))
        sql("ALTER TABLE scripts ADD CONSTRAINT test_script_save_outage CHECK (product_name='impossible') NOT VALID;")
        try:
            self.assertNotEqual(sql(self.as_service(f"SELECT save_script_request('{self.user}','{receipt['id']}');"), fail=False).returncode, 0)
        finally:
            sql("ALTER TABLE scripts DROP CONSTRAINT test_script_save_outage;")
        self.assertEqual(sql(f"SELECT status FROM ai_requests WHERE id='{receipt['id']}'").stdout.strip(), "result_ready")
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            rows = list(pool.map(lambda _: json.loads(sql(self.as_service(
                f"SELECT save_script_request('{self.user}','{receipt['id']}');")).stdout), range(3)))
        self.assertEqual(len({row["script_id"] for row in rows}), 1)
        self.assertEqual(rows[0]["status"], "completed")
        self.assertEqual(sql(f"SELECT count(*) FROM scripts WHERE id='{rows[0]['script_id']}'").stdout.strip(), "1")

    def test_original_receipt_is_owned_and_read_only_for_user(self):
        receipt = json.loads(sql(self.begin()).stdout)
        self.assertEqual(sql(self.as_user("SELECT count(*) FROM ai_requests")).stdout.strip(), "1")
        self.assertNotEqual(sql(self.as_user(f"SELECT begin_script_request('{self.user}','{uuid.uuid4()}','{{}}');"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_service(f"SELECT read_script_request('{self.other}','{receipt['id']}');"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_user("UPDATE ai_requests SET status='completed'"), fail=False).returncode, 0)

    def test_invalid_result_and_original_refund_are_one_transaction_and_idempotent(self):
        receipt = json.loads(sql(self.begin()).stdout)
        command = self.as_service(f"SELECT checkpoint_script_result('{self.user}','{receipt['id']}','无有效场景',NULL);")
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            rows = list(pool.map(lambda _: json.loads(sql(command).stdout), range(3)))
        self.assertTrue(all(row["status"] == "invalid" for row in rows))
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE original_charge_id='{receipt['charge_id']}'").stdout.strip(), "1")
        self.assertNotEqual(sql(self.as_service(f"SELECT save_script_request('{self.user}','{receipt['id']}');"), fail=False).returncode, 0)

    def test_explicit_rejection_refunds_once_but_unknown_attempt_cannot_be_rejected(self):
        for status in ("error", "unknown"):
            receipt = json.loads(sql(self.begin()).stdout)
            attempt = str(uuid.uuid4())
            sql(self.as_service(f"SELECT begin_model_attempt('{self.user}','{receipt['id']}','generate_script_four_layer','text.primary','{self.versions['ArkSeedance']}','model','{attempt}','{{}}');"))
            sql(self.as_service(f"SELECT finish_model_attempt('{attempt}','{status}',10,NULL,NULL,'上游状态');"))
            command = self.as_service(f"SELECT reject_script_request('{self.user}','{receipt['id']}','上游明确拒绝');")
            if status == "error":
                sql(command)
                sql(command)
                self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
            else:
                self.assertNotEqual(sql(command, fail=False).returncode, 0)
                self.assertEqual(sql(f"SELECT status FROM ai_requests WHERE id='{receipt['id']}'").stdout.strip(), "started")

    def test_model_attempt_records_usage_and_pending_completion_is_visible(self):
        request = str(uuid.uuid4())
        attempt = str(uuid.uuid4())
        version = self.versions["ArkSeedance"]
        command = self.as_service(f"SELECT begin_model_attempt('{self.user}','{request}','text-generation','text.primary','{version}','test-model','{attempt}','{{}}');")
        self.assertEqual(sql(command).stdout.strip(), attempt)
        sql(command)
        self.assertEqual(sql(f"SELECT count(*) FROM model_attempts WHERE id='{attempt}'").stdout.strip(), "1")
        self.assertEqual(sql(f"SELECT status FROM model_attempts WHERE id='{attempt}'").stdout.strip(), "started")
        sql(self.as_service(f"""SELECT finish_model_attempt('{attempt}','success',12,'upstream-42','{{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',NULL);"""))
        self.assertEqual(sql(f"SELECT total_tokens FROM model_attempts WHERE id='{attempt}'").stdout.strip(), "15")
        self.assertNotEqual(sql(self.as_user(f"SELECT finish_model_attempt('{attempt}','success',12,NULL,'{{}}',NULL)"), fail=False).returncode, 0)

    def test_attempt_cost_missing_pending_visibility_and_original_cash_reconciliation(self):
        attempt, request = str(uuid.uuid4()), str(uuid.uuid4())
        version = self.versions["ArkSeedance"]
        sql(self.as_service(f"SELECT begin_model_attempt('{self.user}','{request}','text-generation','text.primary','{version}','text-model','{attempt}','{{}}');"))
        listed = json.loads(sql(self.as_service(f"SELECT operator_list('{self.other}','model_attempts');")).stdout)
        row = next(item for item in listed["items"] if item["id"] == attempt)
        self.assertTrue(row["needs_reconciliation"])
        self.assertEqual(row["cash_state"], "unrecorded")
        missing = json.loads(sql(self.as_service(f"SELECT operator_list('{self.other}','cost_missing');")).stdout)
        self.assertTrue(any(item["id"] == attempt and item["job_type"] == "model_attempt" for item in missing["items"]))
        payload = dict(job_type="model_attempt", job_id=attempt, amount_minor=123, currency="USD",
                       statement_ref=f"fixture/{request}", line_ref="1", evidence_sha256="a" * 64, reason="核对原供应商账单")
        encoded = json.dumps(payload, ensure_ascii=False)
        command = self.as_service(f"SELECT operator_mutate('{self.other}','{uuid.uuid4()}','cost_record','{encoded}');")
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            costs = list(pool.map(lambda _: json.loads(sql(command).stdout), range(3)))
        self.assertEqual(len({cost["id"] for cost in costs}), 1)
        self.assertEqual(costs[0]["model_version"], version)
        self.assertEqual(sql(f"SELECT status FROM model_attempts WHERE id='{attempt}'").stdout.strip(), "started")
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        reversal = json.dumps(dict(entry_id=costs[0]["id"], statement_ref=f"fixture/{request}/reverse",
            line_ref="2", evidence_sha256="b" * 64, reason="核对账单冲销"), ensure_ascii=False)
        sql(self.as_service(f"SELECT operator_mutate('{self.other}','{uuid.uuid4()}','cost_reverse','{reversal}');"))
        self.assertEqual(sql(f"SELECT sum(amount_minor) FROM supplier_cost_entries WHERE job_id='{attempt}'").stdout.strip(), "0")
        self.assertNotEqual(sql(self.as_user(f"SELECT operator_list('{self.other}','model_attempts');"), fail=False).returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
