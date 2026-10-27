"""最新迁移能力必须包含知识范数与持久告警，防止旧库被误报就绪。"""
import json
import unittest
import test_finance as finance


class FinalContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def probe(self):
        return json.loads(finance.sql("SET ROLE service_role; SET request.jwt.claim.role='service_role'; SELECT worker_capabilities();").stdout)

    def test_latest_contract_and_new_columns_are_required(self):
        result = self.probe()
        self.assertEqual(result["version"], 24)
        self.assertEqual(result["required_migration"], "00068")
        self.assertTrue(result["ready"])
        for table, column in [("knowledge_chunks", "embedding_norm"), ("operations_alert_deliveries", "receipt")]:
            finance.sql(f"ALTER TABLE {table} RENAME COLUMN {column} TO test_missing;")
            try:
                result = self.probe()
                self.assertFalse(result["ready"])
                self.assertIn(table, result["missing"])
            finally:
                finance.sql(f"ALTER TABLE {table} RENAME COLUMN test_missing TO {column};")

    def test_missing_delivery_rpc_and_nonservice_probe_are_rejected(self):
        finance.sql("REVOKE EXECUTE ON FUNCTION claim_alert_delivery(text) FROM service_role;")
        try:
            result = self.probe()
            self.assertFalse(result["ready"])
            self.assertIn("claim_alert_delivery(text)", result["missing"])
        finally:
            finance.sql("GRANT EXECUTE ON FUNCTION claim_alert_delivery(text) TO service_role;")
        result = finance.sql("SET ROLE authenticated; SELECT worker_capabilities();", False)
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
