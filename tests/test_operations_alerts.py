"""真实PG告警：连续扫描、范围隔离、确认回执、恢复与再次发生。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class AlertsTest(unittest.TestCase):
    setUpClass = classmethod(finance.FinanceTest.setUpClass.__func__)
    setUp = finance.FinanceTest.setUp
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    create_job_sql = finance.FinanceTest.create_job_sql

    def scan(self, healthy=True):
        return json.loads(sql(self.as_service(f"SELECT refresh_operations_alerts({str(healthy).lower()})")).stdout)

    def ticket(self):
        tid = str(uuid.uuid4())
        sql(f"INSERT INTO support_tickets(id,user_id,title,category,due_at) VALUES('{tid}','{self.user}','超期问题','other',now()-interval '1 hour')")
        return tid

    def alerts(self, actor=None):
        return json.loads(sql(self.as_service(f"SELECT operator_list('{actor or self.other}','alerts')")).stdout)

    def ack_sql(self, alert, actor=None, key=None, **changes):
        payload = dict(alert_id=alert["id"], expected=alert["version"], reason="值班已接手核对原记录", **changes)
        return self.as_service(f"SELECT operator_mutate('{actor or self.other}','{key or uuid.uuid4()}','alert_ack','{json.dumps(payload)}')")

    def test_dedup_ack_resolve_and_reopen_original_alert(self):
        tid = self.ticket()
        self.scan()
        alert = next(a for a in self.alerts()["items"] if a["source_id"] == tid)
        statement = self.ack_sql(alert, key=str(uuid.uuid4()))
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            receipts = list(pool.map(lambda _: json.loads(sql(statement).stdout), range(4)))
        self.assertEqual(len({a["version"] for a in receipts}), 1)
        self.scan()
        self.assertEqual(sql(f"SELECT status FROM operations_alerts WHERE id='{alert['id']}'").stdout.strip(), "acknowledged")
        self.assertEqual(sql(f"SELECT count(*) FROM operations_alert_events WHERE alert_id='{alert['id']}'").stdout.strip(), "2")
        self.assertNotEqual(sql(self.ack_sql(alert), fail=False).returncode, 0)
        sql(f"UPDATE support_tickets SET status='resolved' WHERE id='{tid}'")
        self.scan()
        self.assertEqual(sql(f"SELECT status FROM operations_alerts WHERE id='{alert['id']}'").stdout.strip(), "resolved")
        sql(f"UPDATE support_tickets SET status='open' WHERE id='{tid}'")
        self.scan()
        reopened = next(a for a in self.alerts()["items"] if a["source_id"] == tid)
        self.assertEqual(reopened["id"], alert["id"])
        self.assertEqual(reopened["occurrences"], 2)
        self.assertIsNone(reopened["acknowledged_by"])
        self.assertEqual(sql(f"SELECT string_agg(event,',' ORDER BY version) FROM operations_alert_events WHERE alert_id='{alert['id']}'").stdout.strip(),
                         "opened,acknowledged,resolved,opened")

    def test_scoped_roles_revocation_service_boundary_and_stale_monitor(self):
        self.ticket()
        self.scan(False)
        actor = str(uuid.uuid4())
        sql(f"INSERT INTO auth.users(id) VALUES('{actor}')")
        sql(f"INSERT INTO operator_grants(operator_id,role,scope_user_id,granted_by) VALUES('{actor}','operations','{self.user}','{self.other}')")
        scoped = self.alerts(actor)
        self.assertEqual(len(scoped["items"]), 1)
        self.assertEqual(scoped["items"][0]["rule"], "ticket_overdue")
        statement = self.ack_sql(scoped["items"][0], actor, str(uuid.uuid4()))
        sql(statement)
        sql(f"UPDATE operator_grants SET revoked_at=now() WHERE operator_id='{actor}'")
        self.assertNotEqual(sql(statement, fail=False).returncode, 0)
        for statement in ("SELECT * FROM operations_alerts", "SELECT * FROM operations_alert_events",
                          "SELECT refresh_operations_alerts(true)", f"SELECT operator_list('{self.other}','alerts')"):
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)
        self.assertFalse(self.alerts()["monitor"]["stale"])
        sql("UPDATE operations_monitor_state SET last_scan_at=now()-interval '4 minutes'")
        self.assertTrue(self.alerts()["monitor"]["stale"])

    def test_unknown_stalled_cost_and_scheduler_recovery(self):
        job = json.loads(sql(self.create_job_sql()).stdout)
        sql(f"UPDATE video_jobs SET submission_state='unknown',status='processing' WHERE id='{job['id']}'")
        self.scan(False)
        rules = {a["rule"] for a in self.alerts()["items"]}
        self.assertTrue({"submission_unknown", "scheduler_unhealthy"} <= rules)
        self.assertEqual(sql(f"SELECT billing_state FROM video_jobs WHERE id='{job['id']}'").stdout.strip(), "reserved")
        sql(f"UPDATE video_jobs SET submission_state='queued',next_poll_at=now()-interval '10 minutes',created_at=now()-interval '10 minutes' WHERE id='{job['id']}'")
        self.scan()
        self.assertEqual(sql(f"SELECT status FROM operations_alerts WHERE rule='submission_unknown' AND source_id='{job['id']}'").stdout.strip(), "resolved")
        self.assertEqual(sql(f"SELECT status FROM operations_alerts WHERE rule='queue_stalled' AND source_id='{job['id']}'").stdout.strip(), "open")
        sql(f"UPDATE video_jobs SET status='failed',created_at=now()-interval '2 days' WHERE id='{job['id']}'")
        self.scan()
        self.assertEqual(sql(f"SELECT status FROM operations_alerts WHERE rule='cost_missing' AND source_id='{job['id']}'").stdout.strip(), "open")
        sql(f"""INSERT INTO supplier_cost_entries(user_id,job_type,job_id,provider,currency,amount_minor,statement_ref,line_ref,evidence_sha256,recorded_by)
          VALUES('{self.user}','video','{job['id']}','test','USD',0,'{uuid.uuid4()}','1','{'a'*64}','{self.other}')""")
        self.scan()
        self.assertEqual(sql(f"SELECT status FROM operations_alerts WHERE rule='cost_missing' AND source_id='{job['id']}'").stdout.strip(), "resolved")


if __name__ == "__main__":
    unittest.main(verbosity=2)
