"""真实PG告警原事件、并发租约、晚提交与投递回执回归。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance


class AlertDeliveryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)

    def setUp(self):
        self.channel = "test_" + uuid.uuid4().hex
        self.alert = str(uuid.uuid4())
        self.event = str(uuid.uuid4())
        finance.sql(f"""INSERT INTO operations_alerts(id,rule,source_type,source_id,permission,severity,title)
          VALUES('{self.alert}','scheduler_unhealthy','scheduler',gen_random_uuid(),'jobs:read','critical','调度故障');
          INSERT INTO operations_alert_events(id,alert_id,event,version)
          VALUES('{self.event}','{self.alert}','opened',1);""")
        self.service(f"""INSERT INTO operations_alert_deliveries(event_id,channel,delivered_at,receipt)
          SELECT id,'{self.channel}',now(),jsonb_build_object('event_id',id,'accepted',true)
          FROM operations_alert_events WHERE id<>'{self.event}';""")

    def service(self, statement):
        return finance.sql("SET ROLE service_role; SET request.jwt.claim.role='service_role'; " + statement)

    def claim(self):
        raw = self.service(f"SELECT claim_alert_delivery('{self.channel}');").stdout.strip()
        return json.loads(raw) if raw else None

    def finish(self, item, receipt="NULL"):
        return self.service(f"""SELECT finish_alert_delivery('{self.channel}','{item['event_id']}',
          '{item['lease_token']}',{receipt});""").stdout.strip()

    def test_parallel_claims_keep_one_original_event_and_snapshot(self):
        # 每个测试独立channel；历史事件先完成，仅当前事件留待领取。
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            rows = list(pool.map(lambda _: self.claim(), range(6)))
        claimed = [row for row in rows if row]
        self.assertEqual(len(claimed), 1)
        item = claimed[0]
        self.assertEqual(item["event_id"], self.event)
        self.assertEqual(item["payload"]["event_id"], self.event)
        self.assertEqual(item["payload"]["alert_id"], self.alert)
        self.assertEqual(item["payload"]["version"], 1)
        self.assertNotIn("note", item["payload"])
        self.assertNotIn("user_id", item["payload"])

    def test_unknown_receipt_backoff_original_retry_and_stale_fencing(self):
        item = self.claim()
        wrong = "'{\"accepted\":true,\"event_id\":\"" + str(uuid.uuid4()) + "\"}'::jsonb"
        self.assertEqual(self.finish(item, wrong), "t")
        row = json.loads(self.service(f"""SELECT jsonb_build_object('attempts',attempts,
          'delivered',delivered_at IS NOT NULL,'delayed',next_run_at>now()) FROM operations_alert_deliveries
          WHERE event_id='{item['event_id']}' AND channel='{self.channel}';""").stdout)
        self.assertEqual(row, {"attempts": 1, "delivered": False, "delayed": True})
        self.service(f"""UPDATE operations_alert_deliveries SET next_run_at=now()
          WHERE event_id='{item['event_id']}' AND channel='{self.channel}';""")
        again = self.claim()
        self.assertEqual(again["event_id"], item["event_id"])
        self.assertNotEqual(again["lease_token"], item["lease_token"])
        self.assertEqual(again["payload"], item["payload"])
        self.assertEqual(self.finish(item), "f")
        receipt = "'{\"accepted\":true,\"event_id\":\"" + again["event_id"] + "\"}'::jsonb"
        self.assertEqual(self.finish(again, receipt), "t")
        self.assertEqual(self.finish(again, receipt), "f")

    def test_old_timestamp_inserted_late_is_discovered_without_cursor(self):
        while item := self.claim():
            self.finish(item, "'{\"accepted\":true,\"event_id\":\"" + item["event_id"] + "\"}'::jsonb")
        late = str(uuid.uuid4())
        finance.sql(f"""INSERT INTO operations_alert_events(id,alert_id,event,version,created_at)
          VALUES('{late}','{self.alert}','resolved',2,now()-interval '2 days');""")
        self.assertEqual(self.claim()["event_id"], late)

    def test_nonservice_cannot_claim_read_or_finish(self):
        for statement in [
            "SELECT * FROM operations_alert_deliveries",
            f"SELECT claim_alert_delivery('{self.channel}')",
            f"SELECT finish_alert_delivery('{self.channel}','{self.event}',gen_random_uuid(),NULL)",
        ]:
            result = finance.sql("SET ROLE authenticated; SET request.jwt.claim.role='authenticated'; " + statement, False)
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
