"""真实PG商品事务、来源、隔离、回执与提取队列回归。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance
sql = finance.sql


class ProductsTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    production_claim = finance.FinanceTest.production_claim
    production_event = finance.FinanceTest.production_event

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        finance.FinanceTest.setUp(self)
        self.draft = {"name": "真实杯子", "category": "家居用品", "status": "draft", "currency": "USD",
                      "original_price": 12.90, "stock": None, "sales_count": None,
                      "selling_points": [], "images": [], "specs": []}

    def mutate(self, items=None, action="save", key=None, user=None, fail=True):
        payload = json.dumps(items or [{"draft": self.draft}], ensure_ascii=False).replace("'", "''")
        return sql(self.as_service(f"SELECT mutate_products('{user or self.user}','{key or uuid.uuid4()}',"
                                  f"'{action}','{payload}')"), fail)

    def row(self, product):
        return json.loads(sql(f"SELECT to_jsonb(p) FROM products p WHERE id='{product}'").stdout)

    def create(self, key=None):
        return json.loads(sql(self.as_service(f"SELECT create_product_import('{self.user}','{key or uuid.uuid4()}',"
                                            """'{"mode":"text","content":"商品名称：真实杯子"}')""")).stdout)

    def test_isolation_and_direct_writes_revoked(self):
        product = json.loads(self.mutate().stdout)["ids"][0]
        self.assertEqual(sql(self.as_user("SELECT count(*) FROM products;")).stdout.strip(), "1")
        for statement in ("DELETE FROM products;", "UPDATE products SET stock=100;",
                          f"INSERT INTO products(user_id,name,category) VALUES('{self.user}','伪造','其他');",
                          f"SELECT mutate_products('{self.other}','{uuid.uuid4()}','delete','[]');",
                          "SELECT * FROM product_mutation_receipts;"):
            self.assertNotEqual(sql(self.as_user(statement), False).returncode, 0)
        result = self.mutate([{"id": product, "expected_updated_at": self.row(product)["updated_at"]}],
                             "delete", user=self.other, fail=False)
        self.assertNotEqual(result.returncode, 0)

    def test_parallel_receipt_and_payload_binding(self):
        key = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: json.loads(self.mutate(key=key).stdout), range(4)))
        self.assertEqual(len({result["ids"][0] for result in results}), 1)
        row = self.row(results[0]["ids"][0])
        self.assertEqual(row["price"], 12.9)
        self.assertEqual(row["currency"], "USD")
        self.assertIsNone(row["stock"])
        self.assertIsNone(row["sales_count"])
        self.assertNotEqual(self.mutate([{"draft": {**self.draft, "name": "不同商品"}}], key=key, fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM audit_logs WHERE user_id='{self.user}' AND action='products_save'").stdout.strip(), "1")

    def test_save_and_receipt_failure_roll_back_whole_batch(self):
        sql("ALTER TABLE product_mutation_receipts ADD CONSTRAINT test_product_receipt CHECK(false) NOT VALID")
        try:
            self.assertNotEqual(self.mutate(fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT count(*) FROM products WHERE user_id='{self.user}'").stdout.strip(), "0")
        finally:
            sql("ALTER TABLE product_mutation_receipts DROP CONSTRAINT test_product_receipt")
        items = [{"draft": self.draft}, {"draft": {**self.draft, "name": ""}}]
        self.assertNotEqual(self.mutate(items, fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM products WHERE user_id='{self.user}'").stdout.strip(), "0")

    def test_version_conflict_and_delete_rollback(self):
        ids = json.loads(self.mutate([{"draft": self.draft}, {"draft": {**self.draft, "name": "商品乙"}}]).stdout)["ids"]
        items = [{"id": product, "expected_updated_at": self.row(product)["updated_at"]} for product in ids]
        updated = {**items[1], "draft": {**self.draft, "name": "更新乙"}}
        self.mutate([updated])
        self.assertNotEqual(self.mutate(items, "delete", fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM products WHERE user_id='{self.user}'").stdout.strip(), "2")
        key = str(uuid.uuid4())
        items = [{"id": product, "expected_updated_at": self.row(product)["updated_at"]} for product in ids]
        self.mutate(items, "delete", key)
        self.assertEqual(json.loads(self.mutate(items, "delete", key).stdout)["count"], 2)

    def test_import_source_once_and_tombstone(self):
        job = self.production_claim(self.create())
        result = {"draft": self.draft, "warnings": [], "source": {"mode": "text", "content_hash": "a" * 64,
                  "url": None, "observed_at": "2026-10-22T00:00:00Z", "facts": {"name": "真实杯子"}}}
        sql(self.production_event(job, "completed", result))
        product = json.loads(self.mutate([{"draft": self.draft, "import_job_id": job["id"]}]).stdout)["ids"][0]
        self.assertEqual(self.row(product)["source"], result["source"])
        self.assertNotEqual(self.mutate([{"draft": self.draft, "import_job_id": job["id"]}], user=self.other, fail=False).returncode, 0)
        self.assertNotEqual(self.mutate([{"draft": self.draft, "import_job_id": job["id"]}], fail=False).returncode, 0)
        self.mutate([{"id": product, "expected_updated_at": self.row(product)["updated_at"]}], "delete")
        self.assertNotEqual(self.mutate([{"draft": self.draft, "import_job_id": job["id"]}], fail=False).returncode, 0)

    def test_queue_cap_unknown_and_free_original_request(self):
        key = str(uuid.uuid4())
        first = self.create(key)
        self.assertEqual(self.create(key)["id"], first["id"])
        for _ in range(3):
            self.create()
        sql(f"UPDATE production_jobs SET status='unknown' WHERE id='{first['id']}'")
        with self.assertRaises(AssertionError):
            self.create()
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0")
        self.assertEqual(sql(f"SELECT count(*) FROM production_jobs WHERE user_id='{self.user}'").stdout.strip(), "4")

    def test_worker_read_failure_stops_and_prunes_copies(self):
        job = self.create()
        for _ in range(3):
            lease = self.production_claim(job)
            sql(self.production_event(lease, "retry", {"error": "HTTP 503"}))
        self.assertEqual(sql(f"SELECT status FROM production_jobs WHERE id='{job['id']}'").stdout.strip(), "failed")
        sql(f"UPDATE production_jobs SET completed_at=now()-interval '31 days' WHERE id='{job['id']}'")
        sql(self.as_service("SELECT prune_product_imports()"))
        row = json.loads(sql(f"SELECT to_jsonb(j) FROM production_jobs j WHERE id='{job['id']}'").stdout)
        self.assertNotIn("content", row["payload"])
        self.assertEqual(row["result"], {"expired": True})


if __name__ == "__main__":
    unittest.main(verbosity=2)
