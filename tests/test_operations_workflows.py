"""隔离真实PG：工单身份/冲突、租户共享与预算、风险限制、现金成本原流水。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class OperationsWorkflowTest(unittest.TestCase):
    setUpClass = classmethod(finance.FinanceTest.setUpClass.__func__)
    setUp = finance.FinanceTest.setUp
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    create_job_sql = finance.FinanceTest.create_job_sql

    def mutation(self, action, payload, actor=None, key=None):
        encoded = json.dumps(payload, ensure_ascii=False).replace("'", "''")
        return self.as_service(f"SELECT operator_mutate('{actor or self.other}','{key or uuid.uuid4()}','{action}','{encoded}');")

    def mutate(self, action, payload, actor=None, key=None):
        return json.loads(sql(self.mutation(action, payload, actor, key)).stdout)

    def ticket(self, **changes):
        return self.mutate("ticket_create", dict(title="原任务待核对", category="task", body="请核对原供应商任务", **changes), actor=self.user)

    def team(self):
        return json.loads(sql(self.as_service(f"SELECT manage_team('{self.user}','create','{{\"name\":\"真实租户\"}}');")).stdout)

    def tenant_payload(self, team, **changes):
        return dict(team_id=team["id"], expected=team["ops_version"], name=team["name"],
                    state="active", max_members=5, daily_credit_budget=0, reason="核对企业策略", **changes)

    def test_service_boundary_and_original_replay(self):
        payload = dict(title="丢失回执", category="task", body="支付参数保持原样")
        key = str(uuid.uuid4())
        statement = self.mutation("ticket_create", payload, actor=self.user, key=key)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            receipts = list(pool.map(lambda _: json.loads(sql(statement).stdout), range(4)))
        self.assertEqual(len({x["id"] for x in receipts}), 1)
        self.assertEqual(sql(f"SELECT count(*) FROM support_messages WHERE ticket_id='{receipts[0]['id']}'").stdout.strip(), "1")
        self.assertNotEqual(sql(self.mutation("ticket_create", {**payload, "body": "不同"}, self.user, key), fail=False).returncode, 0)
        for table in ("support_tickets", "support_messages", "supplier_cost_entries", "workload_restrictions", "team_credit_reservations"):
            self.assertNotEqual(sql(self.as_user(f"SELECT * FROM {table}"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_user(f"SELECT operator_mutate('{self.user}','{uuid.uuid4()}','ticket_create','{json.dumps(payload)}')"), fail=False).returncode, 0)

    def test_ticket_scope_messages_assignment_and_conflict(self):
        ticket = self.ticket()
        outsider = str(uuid.uuid4())
        sql(f"INSERT INTO auth.users(id,email) VALUES('{outsider}','outsider@test.example')")
        actor = str(uuid.uuid4())
        sql(f"INSERT INTO auth.users(id,email) VALUES('{actor}','support@test.example')")
        sql(f"INSERT INTO operator_grants(operator_id,role,scope_user_id,granted_by) VALUES('{actor}','operations','{self.user}','{self.other}')")
        self.assertNotEqual(sql(self.as_service(f"SELECT support_read('{outsider}','{ticket['id']}')"), fail=False).returncode, 0)
        updated = self.mutate("ticket_update", dict(ticket_id=ticket["id"], expected=1, status="in_progress", assignee_id=actor, priority="high", reason="开始核对"), actor)
        self.assertEqual(updated["version"], 2)
        statement = self.mutation("ticket_reply", dict(ticket_id=ticket["id"], expected=2, body="内部账单细节", internal=True), actor)
        sql(statement)
        detail = json.loads(sql(self.as_service(f"SELECT support_read('{self.user}','{ticket['id']}')")).stdout)
        self.assertEqual(len(detail["items"]), 2)
        self.assertNotIn("内部账单", json.dumps(detail))
        self.assertNotEqual(sql(self.mutation("ticket_reply", dict(ticket_id=ticket["id"], expected=3, body="伪造内部", internal=True), self.user), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.mutation("ticket_reply", dict(ticket_id=ticket["id"], expected=2, body="过期回复"), self.user), fail=False).returncode, 0)
        self.mutate("ticket_update", dict(ticket_id=ticket["id"], expected=3, status="resolved", reason="原结果确认完成"), actor)
        closed = self.mutate("ticket_update", dict(ticket_id=ticket["id"], expected=4, status="closed", reason="用户确认"), self.user)
        self.assertEqual(closed["status"], "closed")
        self.assertNotEqual(sql(self.mutation("ticket_reply", dict(ticket_id=ticket["id"], expected=5, body="关闭后"), self.user), fail=False).returncode, 0)
        sql(f"UPDATE operator_grants SET revoked_at=now() WHERE operator_id='{actor}'")
        self.assertNotEqual(sql(statement, fail=False).returncode, 0)

    def test_ticket_related_owner_limit_and_pagination(self):
        job = json.loads(sql(self.create_job_sql()).stdout)
        self.ticket(related_type="video", related_id=job["id"])
        self.assertNotEqual(sql(self.mutation("ticket_create", dict(title="越权", category="task", body="越权关联", user_id=self.other, related_type="video", related_id=job["id"])), fail=False).returncode, 0)
        for i in range(9):
            self.mutate("ticket_create", dict(title=f"工单{i}", category="other", body="问题记录"), self.user)
        self.assertNotEqual(sql(self.mutation("ticket_create", dict(title="超额", category="other", body="问题记录"), self.user), fail=False).returncode, 0)
        listed = json.loads(sql(self.as_service(f"SELECT support_read('{self.user}',NULL,2)")).stdout)
        self.assertEqual(listed["total"], 10)
        self.assertEqual(listed["items"], [])

    def test_tenant_version_member_cap_transfer_suspend_and_restore(self):
        team = self.team()
        sql(f"INSERT INTO team_members(team_id,user_id,role) VALUES('{team['id']}','{self.other}','editor')")
        payload = self.tenant_payload(team)
        payload["max_members"] = 1
        self.assertNotEqual(sql(self.mutation("tenant_update", payload), fail=False).returncode, 0)
        payload = self.tenant_payload(team)
        payload.update(owner_id=self.other, state="suspended")
        updated = self.mutate("tenant_update", payload)
        self.assertEqual(updated["owner_id"], self.other)
        self.assertEqual(sql(f"SELECT count(*) FROM team_members WHERE team_id='{team['id']}' AND role='owner'").stdout.strip(), "1")
        self.assertEqual(sql(self.as_user(f"SELECT is_team_member('{team['id']}','{self.user}')")).stdout.strip(), "f")
        self.assertNotEqual(sql(self.as_user(f"SELECT deduct_credits('{self.user}',1,'suspended')"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.mutation("tenant_update", payload), fail=False).returncode, 0)
        self.mutate("tenant_update", self.tenant_payload(updated))
        self.assertEqual(sql(self.as_user(f"SELECT is_team_member('{team['id']}','{self.user}')")).stdout.strip(), "t")
        sql(self.as_user(f"SELECT deduct_credits('{self.user}',1,'restored')"))
        detail = json.loads(sql(self.as_service(f"SELECT tenant_read('{self.other}','{team['id']}')")).stdout)
        self.assertEqual(detail["total"], 2)
        member = next(x for x in detail["items"] if x["user_id"] == self.user)
        self.mutate("tenant_member", dict(team_id=team["id"], expected=detail["tenant"]["ops_version"],
                                         member_id=member["id"], member_action="remove", reason="成员离职"))
        self.assertEqual(sql(self.as_user(f"SELECT is_team_member('{team['id']}','{self.user}')")).stdout.strip(), "f")

    def test_tenant_parallel_daily_budget_fixed_charge_attribution(self):
        team = self.team()
        sql(f"INSERT INTO team_members(team_id,user_id,role) VALUES('{team['id']}','{self.other}','editor')")
        payload = self.tenant_payload(team)
        payload["daily_credit_budget"] = 10
        self.mutate("tenant_update", payload)
        statements = [self.as_service(f"SELECT deduct_credits('{user}',6,'team-budget')") for user in [self.user, self.other] * 3]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda x: sql(x, fail=False), statements))
        self.assertEqual(sum(x.returncode == 0 for x in results), 1)
        charge = json.loads(next(x.stdout for x in results if x.returncode == 0))["charge_id"]
        owner = sql(f"SELECT user_id FROM credit_logs WHERE id='{charge}'").stdout.strip()
        sql(self.as_service(f"SELECT refund_credit_charge('{owner}','{charge}','确定失败')"))
        sql(f"UPDATE team_members SET status='removed' WHERE team_id='{team['id']}' AND user_id='{self.other}'")
        self.assertEqual(sql(f"SELECT sum(amount) FROM team_credit_reservations WHERE team_id='{team['id']}'").stdout.strip(), "6")
        self.assertNotEqual(sql(self.as_user(f"SELECT deduct_credits('{self.user}',6,'still-budgeted')"), fail=False).returncode, 0)

    def test_risk_disposition_and_restriction_separate_refund_preserved(self):
        event = str(uuid.uuid4())
        sql(f"INSERT INTO risk_events(id,user_id,decision) VALUES('{event}','{self.user}','review_pending')")
        reviewed = self.mutate("risk_review", dict(event_id=event, expected=1, disposition="dismissed", reason="人工核对误报"))
        self.assertEqual(reviewed["disposition"], "dismissed")
        charge = json.loads(sql(self.as_user(f"SELECT deduct_credits('{self.user}',1,'before-restrict')")).stdout)["charge_id"]
        original_job = json.loads(sql(self.create_job_sql()).stdout)
        restriction = self.mutate("restriction", dict(user_id=self.user, restricted=True, expected=0, reason="暂停新计费任务"))
        self.assertTrue(restriction["restricted"])
        self.assertNotEqual(sql(self.as_user(f"SELECT deduct_credits('{self.user}',1,'blocked')"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.create_job_sql(), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT count(*) FROM video_jobs WHERE user_id='{self.user}'").stdout.strip(), "1")
        claimed = json.loads(sql(self.as_service(f"SELECT claim_video_job('{original_job['id']}')")).stdout)
        sql(self.as_service(f"SELECT record_video_job_event('{claimed['id']}','{claimed['lease_token']}','submit_rejected',NULL,NULL,'上游确定拒绝',0)"))
        self.ticket()
        sql(self.as_service(f"SELECT refund_credit_charge('{self.user}','{charge}','原任务失败')"))
        self.mutate("restriction", dict(user_id=self.user, restricted=False, expected=1, reason="申诉核对解除"))
        sql(self.as_user(f"SELECT deduct_credits('{self.user}',1,'allowed')"))

    def test_cash_cost_original_model_version_minor_currency_and_reversal(self):
        job = json.loads(sql(self.create_job_sql()).stdout)
        payload = dict(job_type="video", job_id=job["id"], amount_minor=123, currency="USD",
                       statement_ref="invoice-2026-10", line_ref="line-1", evidence_sha256="a" * 64, reason="已核对供应商账单")
        key = str(uuid.uuid4())
        first = self.mutate("cost_record", payload, key=key)
        self.assertEqual(self.mutate("cost_record", payload, key=key), first)
        self.assertEqual(first["user_id"], self.user)
        self.assertEqual(first["model_version"], self.versions["SeedanceMini"])
        self.assertEqual(first["amount_minor"], 123)
        self.assertNotEqual(sql(self.mutation("cost_record", payload), fail=False).returncode, 0)
        self.assertNotEqual(sql(f"UPDATE supplier_cost_entries SET amount_minor=1 WHERE id='{first['id']}'", fail=False).returncode, 0)
        reverse = dict(entry_id=first["id"], statement_ref="correction-2026-10", line_ref="line-2", evidence_sha256="b" * 64, reason="原账单撤销")
        statement = self.mutation("cost_reverse", reverse)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: sql(statement, fail=False), range(4)))
        self.assertEqual(sum(x.returncode == 0 for x in results), 4)
        self.assertEqual(sql(f"SELECT sum(amount_minor) FROM supplier_cost_entries WHERE job_id='{job['id']}' AND currency='USD'").stdout.strip(), "0")
        self.assertNotEqual(sql(self.mutation("cost_reverse", reverse), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "10")
        second = json.loads(sql(self.create_job_sql()).stdout)
        report = json.loads(sql(self.as_service(f"SELECT supplier_cost_report('{self.other}','{self.user}')")).stdout)
        self.assertEqual(report["unrecorded_workloads"], 1)
        self.assertEqual(report["totals"][0]["amount_minor"], 0)
        self.mutate("cost_record", {**payload, "job_id": second["id"], "line_ref": "zero-cost", "amount_minor": 0})
        self.assertEqual(json.loads(sql(self.as_service(f"SELECT supplier_cost_report('{self.other}','{self.user}')")).stdout)["unrecorded_workloads"], 0)

    def test_scoped_operator_cannot_read_tenants_or_foreign_cost(self):
        actor = str(uuid.uuid4())
        sql(f"INSERT INTO auth.users(id,email) VALUES('{actor}','scoped@test.example')")
        sql(f"INSERT INTO operator_grants(operator_id,role,scope_user_id,granted_by) VALUES('{actor}','operations','{self.user}','{self.other}')")
        self.ticket()
        self.assertEqual(json.loads(sql(self.as_service(f"SELECT operator_list('{actor}','tickets')")).stdout)["total"], 1)
        self.assertNotEqual(sql(self.as_service(f"SELECT operator_list('{actor}','tenants')"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.mutation("restriction", dict(user_id=self.user, restricted=True, expected=0, reason="越权"), actor), fail=False).returncode, 0)
        for domain in ("tickets", "tenants", "costs", "cost_missing", "risk", "customers"):
            self.assertIn("observed_at", json.loads(sql(self.as_service(f"SELECT operator_list('{self.other}','{domain}')")).stdout))


if __name__ == "__main__":
    unittest.main(verbosity=2)
