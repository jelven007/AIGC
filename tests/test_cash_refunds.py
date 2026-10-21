"""实际 PostgreSQL 现金退款事务：并发/恢复/权限/权益回收，不使用资金 mock。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class CashRefundTest(unittest.TestCase):
    setUpClass = classmethod(finance.FinanceTest.setUpClass.__func__)
    setUp = finance.FinanceTest.setUp
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    order = finance.FinanceTest.order
    finalize = finance.FinanceTest.finalize
    charge = finance.FinanceTest.charge

    def reserve(self, order, amount=10, key=None, actor=None, reason="退订"):
        return self.as_service(
            f"SELECT row_to_json(reserve_cash_refund('{actor or self.other}','{order}',"
            f"'{key or uuid.uuid4()}',{amount},'{reason}'));")

    def paid(self, plan=None, amount=10):
        order = self.order(plan, amount=amount)
        sql(self.finalize(order, amount=amount))
        return order

    def claim(self, order, row, submit=True):
        return json.loads(sql(self.as_service(
            f"SELECT claim_cash_refund('{self.other}','{order}','{row['out_request_no']}',"
            f"{str(submit).lower()});")).stdout)

    def finish(self, order, claimed, **changes):
        row = claimed["refund"]
        evidence = dict(outcome="success", verified=True, method="refund", code="10000",
                        trade_no=f"trade-{order}", out_trade_no=order,
                        out_request_no=row["out_request_no"],
                        amount=str(row["refund_amount"]), fund_change="Y")
        evidence.update(changes)
        return self.as_service(
            f"SELECT row_to_json(finish_cash_refund('{row['id']}','{row['lease_token']}',"
            f"'{json.dumps(evidence)}'));")

    def test_schema_and_browser_cash_boundaries(self):
        order = self.paid()
        for table in ("alipay_refunds", "operator_grants"):
            self.assertNotEqual(sql(self.as_user(f"SELECT * FROM {table}"), fail=False).returncode, 0)
            self.assertNotEqual(sql(self.as_user(f"DELETE FROM {table}"), fail=False).returncode, 0)
        for function in ("operator_can", "require_operator"):
            self.assertNotEqual(sql(self.as_user(
                f"SELECT {function}('{self.other}','refunds:write','{self.user}');"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_user(
            f"SELECT reserve_cash_refund('{self.other}','{order}','{uuid.uuid4()}',1,'伪造')"),
            fail=False).returncode, 0)
        self.assertNotEqual(sql(self.reserve(order, actor=self.user), fail=False).returncode, 0)
        sql(f"UPDATE profiles SET role='admin' WHERE id='{self.user}'")
        self.assertNotEqual(sql(self.reserve(order, actor=self.user), fail=False).returncode, 0)

    def test_live_role_scope_and_ban(self):
        order = self.paid()
        scoped = str(uuid.uuid4())
        sql(f"INSERT INTO auth.users(id,email) VALUES ('{scoped}','operator@test.example');")
        sql(f"""INSERT INTO operator_grants(operator_id,role,scope_user_id,granted_by)
          VALUES('{scoped}','finance','{self.user}','{self.other}');""")
        self.assertEqual(sql(self.as_service(
            f"SELECT operator_can('{scoped}','refunds:write','{self.user}')")).stdout.strip(), "t")
        self.assertEqual(sql(self.as_service(
            f"SELECT operator_can('{scoped}','refunds:write','{self.other}')")).stdout.strip(), "f")
        sql(f"UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='{scoped}'")
        self.assertNotEqual(sql(self.reserve(order, actor=scoped), fail=False).returncode, 0)
        sql(f"UPDATE auth.users SET banned_until=NULL WHERE id='{scoped}'")
        row = json.loads(sql(self.reserve(order, actor=scoped)).stdout)
        sql(f"UPDATE operator_grants SET revoked_at=now() WHERE operator_id='{scoped}'")
        self.assertNotEqual(sql(self.as_service(
            f"SELECT claim_cash_refund('{scoped}','{order}','{row['out_request_no']}');"), fail=False).returncode, 0)

    def test_parallel_reservations_include_unknown_amount(self):
        order = self.paid()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: sql(self.reserve(order, amount=4), fail=False), range(6)))
        self.assertEqual(sum(result.returncode == 0 for result in results), 2)
        self.assertEqual(sql(f"SELECT sum(refund_amount) FROM alipay_refunds WHERE out_trade_no='{order}'").stdout.strip(), "8.00")
        row = json.loads(next(result.stdout for result in results if result.returncode == 0))
        claimed = self.claim(order, row)
        sql(self.finish(order, claimed, outcome="unknown"))
        self.assertNotEqual(sql(self.reserve(order, amount=3), fail=False).returncode, 0)

    def test_original_request_binding_and_terminal_replay(self):
        order = self.paid()
        key = str(uuid.uuid4())
        row = json.loads(sql(self.reserve(order, key=key)).stdout)
        self.assertEqual(row["out_trade_no"], order)
        self.assertEqual(row["operator_id"], self.other)
        self.assertEqual(json.loads(sql(self.reserve(order, key=key)).stdout)["id"], row["id"])
        for statement in (self.reserve(order, amount=1, key=key), self.reserve(order, key=key, reason="换原因"),
                          self.reserve(self.paid(), key=key)):
            self.assertNotEqual(sql(statement, fail=False).returncode, 0)
        sql(self.finish(order, self.claim(order, row)))
        self.assertEqual(json.loads(sql(self.reserve(order, key=key)).stdout)["status"], "success")

    def test_lease_query_spacing_and_original_retry(self):
        order = self.paid()
        row = json.loads(sql(self.reserve(order)).stdout)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            claimed = list(pool.map(lambda _: self.claim(order, row), range(4)))
        self.assertEqual(sum(value["mode"] == "refund" for value in claimed), 1)
        active = next(value for value in claimed if value["mode"] == "refund")
        sql(self.finish(order, active, outcome="unknown"))
        self.assertEqual(self.claim(order, row)["mode"], "wait")
        sql(f"UPDATE alipay_refunds SET next_query_at=now()-interval '1 second' WHERE id='{row['id']}'")
        query = self.claim(order, row)
        self.assertEqual(query["mode"], "query")
        sql(self.finish(order, query, outcome="unknown", method="query"))
        sql(f"UPDATE alipay_refunds SET next_query_at=now()-interval '1 second' WHERE id='{row['id']}'")
        retry = self.claim(order, row)
        self.assertEqual(retry["mode"], "refund")
        self.assertEqual(retry["refund"]["refund_amount"], 10.0)

    def test_crash_after_submit_only_queries_when_lease_expires(self):
        order = self.paid()
        row = json.loads(sql(self.reserve(order)).stdout)
        claimed = self.claim(order, row)
        sql(f"""UPDATE alipay_refunds SET lease_until=now()-interval '1 second',
            next_query_at=now()-interval '1 second' WHERE id='{row['id']}';""")
        self.assertNotEqual(sql(self.finish(order, claimed), fail=False).returncode, 0)
        query = self.claim(order, row)
        self.assertEqual(query["mode"], "query")
        self.assertNotEqual(sql(self.finish(order, claimed), fail=False).returncode, 0)
        sql(self.finish(order, query, method="query", refund_status="REFUND_SUCCESS"))
        self.assertEqual(self.claim(order, row)["mode"], "done")

    def test_evidence_required_and_bound(self):
        order = self.paid()
        row = json.loads(sql(self.reserve(order)).stdout)
        claim = self.claim(order, row)
        for change in ({"amount": "1.00"}, {"trade_no": "wrong"}, {"out_trade_no": "wrong"}, {"code": None},
                       {"verified": False}, {"method": None}, {"fund_change": "N"},
                       {"method": "query", "refund_status": "UNKNOWN"}):
            self.assertNotEqual(sql(self.finish(order, claim, **change), fail=False).returncode, 0, change)
        self.assertEqual(sql(f"SELECT status FROM orders WHERE order_no='{order}'").stdout.strip(), "paid")
        sql(self.finish(order, claim))

    def test_concurrent_finalization_once_and_prorated_full_revocation(self):
        order = self.paid()
        first = json.loads(sql(self.reserve(order, amount=3.33)).stdout)
        claim = self.claim(order, first)
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(lambda _: sql(self.finish(order, claim)), range(5)))
        self.assertEqual(len(results), 5)
        self.assertEqual(sql(f"SELECT refunded_amount,entitlement_revoked_credits FROM orders WHERE order_no='{order}'").stdout.strip(), "3.33|33")
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "67")
        rest = json.loads(sql(self.reserve(order, amount=6.67)).stdout)
        sql(self.finish(order, self.claim(order, rest)))
        self.assertEqual(sql(f"SELECT refunded_amount,entitlement_revoked_credits,status FROM orders WHERE order_no='{order}'").stdout.strip(), "10.00|100|refunded")
        self.assertEqual(sql(f"SELECT credits_total,active_order_id FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "0|")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{self.user}' AND action='cash_refund_revoke'").stdout.strip(), "2")

    def test_spent_credits_debt_survives_new_subscription(self):
        order = self.paid()
        self.charge(90)
        row = json.loads(sql(self.reserve(order)).stdout)
        sql(self.finish(order, self.claim(order, row)))
        self.assertEqual(sql(f"SELECT credits_total-credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "-90")
        self.assertNotEqual(sql(self.as_user(f"SELECT deduct_credits('{self.user}',1,'after-refund')"), fail=False).returncode, 0)
        second = self.paid()
        self.assertEqual(sql(f"SELECT credits_total-credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "10")
        self.assertEqual(json.loads(sql(self.finalize(second)).stdout)["outcome"], "already_processed")

    def test_old_subscription_does_not_revoke_new_plan_or_boosters(self):
        old = self.paid()
        new = self.paid()
        row = json.loads(sql(self.reserve(old)).stdout)
        sql(self.finish(old, self.claim(old, row)))
        self.assertEqual(sql(f"SELECT credits_total,active_order_id=(SELECT id FROM orders WHERE order_no='{new}') FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "100|t")
        booster = self.paid(self.booster, amount=2)
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "130")
        row = json.loads(sql(self.reserve(booster, amount=2)).stdout)
        sql(self.finish(booster, self.claim(booster, row)))
        self.assertEqual(sql(f"SELECT credits_total,active_order_id=(SELECT id FROM orders WHERE order_no='{new}') FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "100|t")

    def test_failure_rolls_back_cash_and_credits_then_recovers(self):
        order = self.paid()
        row = json.loads(sql(self.reserve(order)).stdout)
        claim = self.claim(order, row)
        sql("ALTER TABLE credit_logs ADD CONSTRAINT reject_cash CHECK(action IS DISTINCT FROM 'cash_refund_revoke') NOT VALID;")
        try:
            self.assertNotEqual(sql(self.finish(order, claim), fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT refunded_amount,status FROM orders WHERE order_no='{order}'").stdout.strip(), "0.00|paid")
            self.assertEqual(sql(f"SELECT status,applied_at FROM alipay_refunds WHERE id='{row['id']}'").stdout.strip(), "requested|")
        finally:
            sql("ALTER TABLE credit_logs DROP CONSTRAINT reject_cash;")
        sql(self.finish(order, claim))
        self.assertEqual(sql(f"SELECT refunded_amount,status FROM orders WHERE order_no='{order}'").stdout.strip(), "10.00|refunded")

    def test_owner_safe_receipt_and_close_race(self):
        order = self.paid()
        row = json.loads(sql(self.reserve(order)).stdout)
        self.assertEqual(sql(self.as_user("SELECT count(*) FROM cash_refund_receipts")).stdout.strip(), "1")
        self.assertEqual(sql(f"""SET ROLE authenticated; SET request.jwt.claim.sub='{self.other}';
          SELECT count(*) FROM cash_refund_receipts;""").stdout.strip(), "0")
        result = sql(self.as_service(f"SELECT close_paid_order_guarded('{self.user}','{order}')")).stdout.strip()
        self.assertEqual(result, "paid")
        self.assertEqual(sql(f"SELECT status FROM orders WHERE order_no='{order}'").stdout.strip(), "paid")
        self.assertNotEqual(sql(self.as_service(f"SELECT close_paid_order_guarded('{uuid.uuid4()}','{order}')"), fail=False).returncode, 0)

    def test_internal_worker_cannot_initiate_or_retry_cash(self):
        order = self.paid()
        row = json.loads(sql(self.reserve(order)).stdout)
        self.assertNotEqual(sql(self.as_service(
            f"SELECT claim_cash_refund(NULL,'{order}','{row['out_request_no']}',true)"), fail=False).returncode, 0)
        result = json.loads(sql(self.as_service(
            f"SELECT claim_cash_refund(NULL,'{order}','{row['out_request_no']}',false)")).stdout)
        self.assertEqual(result["mode"], "query")
        sql(self.finish(order, result, outcome="unknown", method="query"))

    def test_operator_scope_pagination_and_safe_fields(self):
        own = self.paid()
        foreign = self.order()
        sql(f"UPDATE orders SET user_id='{self.other}' WHERE order_no='{foreign}'")
        actor = str(uuid.uuid4())
        sql(f"INSERT INTO auth.users(id,email) VALUES('{actor}','scope@test.example');")
        sql(f"""INSERT INTO operator_grants(operator_id,role,scope_user_id,granted_by)
          VALUES('{actor}','finance','{self.user}','{self.other}');""")
        listed = json.loads(sql(self.as_service(f"SELECT operator_list('{actor}','orders')")).stdout)
        self.assertEqual(listed["total"], 1)
        self.assertEqual(listed["items"][0]["order_no"], own)
        self.assertNotIn("provider_trade_no", listed["items"][0])
        empty = json.loads(sql(self.as_service(f"SELECT operator_list('{actor}','orders',2)")).stdout)
        self.assertEqual(empty["items"], [])
        self.assertNotEqual(sql(self.as_service(f"SELECT operator_list('{actor}','customers')"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_user(f"SELECT operator_list('{self.other}','orders')"), fail=False).returncode, 0)
        for domain in ("orders", "refunds", "customers", "jobs", "risk", "audit", "operators"):
            result = json.loads(sql(self.as_service(f"SELECT operator_list('{self.other}','{domain}')")).stdout)
            self.assertIn("observed_at", result)
            self.assertLessEqual(len(result["items"]), 25)

    def test_operator_grant_revoke_idempotency_and_audit(self):
        actor = str(uuid.uuid4())
        sql(f"INSERT INTO auth.users(id,email) VALUES('{actor}','granted@test.example');")
        key = str(uuid.uuid4())
        payload = json.dumps(dict(operator_id=actor, role="finance", scope_user_id=self.user))
        mutation = self.as_service(f"SELECT operator_mutate('{self.other}','{key}','grant','{payload}');")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: json.loads(sql(mutation).stdout), range(4)))
        self.assertEqual(len({value["grant_id"] for value in results}), 1)
        self.assertEqual(sql(f"SELECT count(*) FROM audit_logs WHERE action='operator_grant' AND record_id='{results[0]['grant_id']}'").stdout.strip(), "1")
        permissions = json.loads(sql(self.as_service(f"SELECT operator_access('{actor}')")).stdout)["permissions"]
        self.assertIn("refunds:write", permissions)
        self.assertNotIn("operators:write", permissions)
        self.assertNotEqual(sql(self.as_service(
            f"SELECT operator_mutate('{actor}','{uuid.uuid4()}','grant','{payload}');"), fail=False).returncode, 0)
        sql(self.as_service(f"""SELECT operator_mutate('{self.other}','{uuid.uuid4()}','revoke',
          '{{"grant_id":"{results[0]['grant_id']}"}}');"""))
        self.assertNotIn("refunds:write", json.loads(sql(self.as_service(f"SELECT operator_access('{actor}')")).stdout)["permissions"])

    def test_daily_budget_atomic_for_all_charges_and_versioned_updates(self):
        self.paid()
        key = str(uuid.uuid4())
        payload = json.dumps(dict(user_id=self.user, amount=25, expected=0))
        mutation = self.as_service(f"SELECT operator_mutate('{self.other}','{key}','budget','{payload}');")
        first = sql(mutation).stdout
        self.assertEqual(sql(mutation).stdout, first)
        self.assertNotEqual(sql(self.as_service(f"SELECT operator_mutate('{self.other}','{uuid.uuid4()}','budget','{payload}');"), fail=False).returncode, 0)
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(lambda _: sql(self.as_user(
                f"SELECT deduct_credits('{self.user}',10,'budget-test')"), fail=False), range(5)))
        self.assertEqual(sum(result.returncode == 0 for result in results), 2)
        charge = json.loads(next(result.stdout for result in results if result.returncode == 0))["charge_id"]
        sql(self.as_service(f"SELECT refund_credit_charge('{self.user}','{charge}','任务失败')"))
        self.assertNotEqual(sql(self.as_user(f"SELECT deduct_credits('{self.user}',10,'budget-test')"), fail=False).returncode, 0)
        sql(f"UPDATE credit_logs SET created_at=now()-interval '2 days' WHERE user_id='{self.user}' AND action='budget-test'")
        self.assertEqual(json.loads(sql(self.as_user(f"SELECT deduct_credits('{self.user}',10,'new-day')")).stdout)["ok"], True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
