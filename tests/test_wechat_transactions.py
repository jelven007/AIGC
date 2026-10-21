"""隔离真实PostgreSQL：微信租约/到期/迟到通知与共用现金事务。"""
import concurrent.futures
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class WechatTest(unittest.TestCase):
    setUpClass = classmethod(finance.FinanceTest.setUpClass.__func__)
    setUp = finance.FinanceTest.setUp
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    finalize = finance.FinanceTest.finalize
    order = finance.FinanceTest.order

    def begin(self):
        return json.loads(sql(self.as_service(
            f"SELECT row_to_json(begin_checkout_order('{self.user}','{uuid.uuid4()}','wechat','{self.plan}',10,100));")).stdout)

    def claim(self, order, action="create", merchant="merchant", actor=None):
        actor_text = "NULL" if actor == "scheduler" else f"'{actor or self.user}'"
        return self.as_service(f"SELECT claim_wechat_order({actor_text},'{order['order_no']}','{merchant}','app','{action}');")

    def closed(self, order, lease, **changes):
        evidence = dict(verified=True, trade_state="CLOSED", mchid="merchant", appid="app", out_trade_no=order["order_no"])
        evidence.update(changes)
        raw = json.dumps(evidence).replace("'", "''")
        return self.as_service(f"SELECT row_to_json(finish_wechat_order('{order['id']}','{lease}','{raw}'));")

    def paid(self):
        order = self.begin()
        lease = json.loads(sql(self.claim(order)).stdout)
        sql(self.as_service(f"""SELECT finish_wechat_order('{order['id']}','{lease['transaction']['lease_token']}',
          '{{"verified":true,"outcome":"created"}}','weixin://wxpay/bizpayurl?pr=test');"""))
        sql(self.finalize(order["order_no"], channel="wechat"))
        return order

    def reserve(self, order, amount="10", key=None, actor=None):
        return self.as_service(f"""SELECT row_to_json(reserve_cash_refund('{actor or self.other}',
          '{order['order_no']}','{key or uuid.uuid4()}',{amount},'用户退订'));""")

    def refund_claim(self, order, row, submit=True):
        return json.loads(sql(self.as_service(f"SELECT claim_cash_refund('{self.other}','{order['order_no']}','{row['out_request_no']}',{str(submit).lower()});")).stdout)

    def finish(self, order, claimed, status="SUCCESS", **changes):
        row = claimed["refund"]
        evidence = dict(verified=True, method="query", refund_status=status, mchid="merchant",
                        trade_no=f"trade-{order['order_no']}", out_trade_no=order["order_no"],
                        out_request_no=row["out_request_no"], amount=str(row["refund_amount"]),
                        total_amount="10.00", refund_id=f"wx-{row['id']}")
        evidence.update(changes)
        raw = json.dumps(evidence).replace("'", "''")
        lease = "NULL" if evidence["method"] == "notify" else f"'{row['lease_token']}'"
        return self.as_service(f"SELECT row_to_json(finish_wechat_refund('{row['id']}',{lease},'{raw}'));")

    def test_original_merchant_expiry_and_single_lease(self):
        order = self.begin()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: json.loads(sql(self.claim(order)).stdout), range(6)))
        self.assertEqual(sum(row["mode"] == "create" for row in results), 1)
        self.assertEqual(sum(row["mode"] == "wait" for row in results), 5)
        self.assertEqual(sql(f"SELECT wechat_expires_at-created_at FROM orders WHERE id='{order['id']}'").stdout.strip(), "00:30:00")
        self.assertNotEqual(sql(self.claim(order, merchant="rotated-merchant"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.claim(order, actor=str(uuid.uuid4())), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.claim(order, actor="scheduler"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_service(
            f"SELECT close_paid_order_guarded('{self.user}','{order['order_no']}')"), fail=False).returncode, 0)

    def test_expired_qr_is_not_saved_and_not_locally_cancelled(self):
        order = self.begin()
        claim = json.loads(sql(self.claim(order)).stdout)
        sql(f"UPDATE orders SET wechat_expires_at=now()-interval '1 second' WHERE id='{order['id']}'")
        sql(self.as_service(f"""SELECT finish_wechat_order('{order['id']}','{claim['transaction']['lease_token']}',
          '{{"verified":true,"outcome":"created"}}','weixin://wxpay/bizpayurl?pr=late');"""))
        self.assertEqual(sql(f"SELECT status,wechat_pay_url FROM orders WHERE id='{order['id']}'").stdout.strip(), "pending|")
        sql(f"UPDATE wechat_transactions SET next_query_at=now() WHERE order_id='{order['id']}'")
        self.assertEqual(json.loads(sql(self.claim(order, actor="scheduler", action="query")).stdout)["mode"], "query")

    def test_close_requires_bound_signed_query_and_late_success_wins(self):
        order = self.begin()
        claim = json.loads(sql(self.claim(order, action="create")).stdout)
        token = claim["transaction"]["lease_token"]
        for changes in (dict(verified=False), dict(mchid="wrong"), dict(out_trade_no="wrong"), dict(appid="wrong")):
            self.assertNotEqual(sql(self.closed(order, token, **changes), fail=False).returncode, 0)
        self.assertEqual(sql(f"SELECT status FROM orders WHERE id='{order['id']}'").stdout.strip(), "pending")
        sql(self.closed(order, token))
        self.assertEqual(sql(f"SELECT status FROM orders WHERE id='{order['id']}'").stdout.strip(), "cancelled")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: sql(self.finalize(order["order_no"], channel="wechat")), range(4)))
        self.assertEqual(sql(f"SELECT status FROM orders WHERE id='{order['id']}'").stdout.strip(), "paid")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE order_id='{order['id']}'").stdout.strip(), "1")
        self.assertEqual(json.loads(sql(self.claim(order, action="close")).stdout)["order"]["status"], "paid")

    def test_close_request_blocks_qr_and_expired_lease_cannot_overwrite(self):
        order = self.begin()
        claim = json.loads(sql(self.claim(order)).stdout)
        token = claim["transaction"]["lease_token"]
        waiting = json.loads(sql(self.claim(order, action="close")).stdout)
        self.assertEqual(waiting["mode"], "wait")
        self.assertIsNotNone(waiting["order"]["wechat_close_requested_at"])
        sql(f"UPDATE wechat_transactions SET lease_until=now()-interval '1 second',next_query_at=now() WHERE order_id='{order['id']}'")
        new = json.loads(sql(self.claim(order, action="query")).stdout)
        self.assertNotEqual(token, new["transaction"]["lease_token"])
        self.assertNotEqual(sql(self.closed(order, token), fail=False).returncode, 0)
        sql(self.closed(order, new["transaction"]["lease_token"]))

    def test_legacy_merchant_and_browser_permissions_are_not_guessed(self):
        number = self.order(channel="wechat")
        sql(f"INSERT INTO wechat_transactions(order_id,needs_attention) SELECT id,true FROM orders WHERE order_no='{number}'")
        self.assertNotEqual(sql(self.claim({"order_no": number}), fail=False).returncode, 0)
        for statement in ("SELECT * FROM wechat_transactions", "SELECT apply_cash_refund(NULL,'{}')",
                          "SELECT finish_wechat_refund(NULL,NULL,'{}')", "SELECT claim_wechat_order(NULL,'x','x','x','query')"):
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_service("SELECT apply_cash_refund(NULL,'{}')"), fail=False).returncode, 0)

    def test_refund_original_request_concurrent_cap_and_role(self):
        order = self.paid()
        key = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            rows = list(pool.map(lambda _: json.loads(sql(self.reserve(order, "6", key)).stdout), range(4)))
        self.assertEqual(len({row["id"] for row in rows}), 1)
        self.assertEqual(rows[0]["pay_channel"], "wechat")
        self.assertNotEqual(sql(self.reserve(order, "7", key), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.reserve(order, "5"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.reserve(order, "1", actor=self.user), fail=False).returncode, 0)

    def test_processing_abnormal_and_unknown_keep_original_reservation(self):
        order = self.paid()
        row = json.loads(sql(self.reserve(order)).stdout)
        for status in ("PROCESSING", "ABNORMAL"):
            sql(f"UPDATE alipay_refunds SET next_query_at=now() WHERE id='{row['id']}'")
            claimed = self.refund_claim(order, row)
            sql(self.finish(order, claimed, status))
            self.assertEqual(sql(f"SELECT refunded_amount FROM orders WHERE id='{order['id']}'").stdout.strip(), "0.00")
            self.assertNotEqual(sql(self.reserve(order, "1"), fail=False).returncode, 0)
            sql(f"UPDATE alipay_refunds SET next_query_at=now() WHERE id='{row['id']}'")
            self.assertEqual(self.refund_claim(order, row)["mode"], "query")
            sql(f"UPDATE alipay_refunds SET lease_until=now()-interval '1 second',next_query_at=now() WHERE id='{row['id']}'")

    def test_closed_releases_only_signed_original_refund(self):
        order = self.paid()
        row = json.loads(sql(self.reserve(order)).stdout)
        claimed = self.refund_claim(order, row)
        self.assertNotEqual(sql(self.finish(order, claimed, "CLOSED", mchid="wrong"), fail=False).returncode, 0)
        sql(self.finish(order, claimed, "CLOSED"))
        self.assertEqual(sql(f"SELECT status,refunded_amount FROM orders WHERE id='{order['id']}'").stdout.strip(), "paid|0.00")
        self.assertEqual(self.refund_claim(order, row)["mode"], "done")
        self.assertEqual(json.loads(sql(self.reserve(order)).stdout)["status"], "init")

    def test_success_notification_races_query_and_is_applied_once(self):
        order = self.paid()
        row = json.loads(sql(self.reserve(order)).stdout)
        claimed = self.refund_claim(order, row)
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            statements = [self.finish(order, claimed, method="notify")] * 4 + [self.finish(order, claimed)]
            results = list(pool.map(lambda stmt: sql(stmt), statements))
        self.assertTrue(all(result.returncode == 0 for result in results))
        self.assertEqual(sql(f"SELECT status,refunded_amount,entitlement_revoked_credits FROM orders WHERE id='{order['id']}'").stdout.strip(), "refunded|10.00|100")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{self.user}' AND action='cash_refund_revoke'").stdout.strip(), "1")
        self.assertEqual(sql(self.as_user("SELECT pay_channel,status FROM cash_refund_receipts")).stdout.strip(), "wechat|success")
        self.assertNotEqual(sql(self.finish(order, claimed, method="notify", refund_id="different"), fail=False).returncode, 0)

    def test_wrong_amount_trade_or_lease_never_revokes_credits(self):
        order = self.paid()
        row = json.loads(sql(self.reserve(order)).stdout)
        claimed = self.refund_claim(order, row)
        for change in (dict(amount="9"), dict(total_amount="9"), dict(trade_no="wrong"), dict(verified=False)):
            self.assertNotEqual(sql(self.finish(order, claimed, **change), fail=False).returncode, 0)
        sql(f"UPDATE alipay_refunds SET lease_until=now()-interval '1 second',next_query_at=now() WHERE id='{row['id']}'")
        new = self.refund_claim(order, row, submit=False)
        self.assertNotEqual(sql(self.finish(order, claimed), fail=False).returncode, 0)
        sql(self.finish(order, new))
        self.assertEqual(sql(f"SELECT refunded_amount FROM orders WHERE id='{order['id']}'").stdout.strip(), "10.00")

    def test_only_verified_absence_allows_same_refund_to_retry(self):
        order = self.paid()
        row = json.loads(sql(self.reserve(order, "3.33")).stdout)
        claimed = self.refund_claim(order, row)
        for verified in (False, True):
            raw = json.dumps(dict(method="query", outcome="unknown", verified=verified, code="RESOURCE_NOT_EXISTS"))
            sql(self.as_service(f"""SELECT finish_wechat_refund('{row['id']}','{claimed['refund']['lease_token']}','{raw}');"""))
            sql(f"UPDATE alipay_refunds SET next_query_at=now() WHERE id='{row['id']}'")
            claimed = self.refund_claim(order, row)
            self.assertEqual(claimed["mode"], "refund" if verified else "query")
            self.assertEqual(claimed["refund"]["refund_amount"], 3.33)
            self.assertEqual(claimed["refund"]["out_request_no"], row["out_request_no"])

    def test_refund_atomic_failure_and_cash_debt_are_preserved(self):
        order = self.paid()
        sql(self.as_user(f"SELECT deduct_credits('{self.user}',80,'已消费')"))
        row = json.loads(sql(self.reserve(order)).stdout)
        claimed = self.refund_claim(order, row)
        sql("ALTER TABLE credit_logs ADD CONSTRAINT wechat_outage CHECK(action IS DISTINCT FROM 'cash_refund_revoke') NOT VALID")
        try:
            self.assertNotEqual(sql(self.finish(order, claimed), fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT refunded_amount FROM orders WHERE id='{order['id']}'").stdout.strip(), "0.00")
        finally:
            sql("ALTER TABLE credit_logs DROP CONSTRAINT wechat_outage")
        sql(self.finish(order, claimed))
        self.assertEqual(sql(f"SELECT credits_total-credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "-80")

    def test_partial_refunds_are_spaced_and_age_limited(self):
        order = self.paid()
        first = json.loads(sql(self.reserve(order, "3.33")).stdout)
        second = json.loads(sql(self.reserve(order, "6.67")).stdout)
        claimed = self.refund_claim(order, first)
        sql(self.finish(order, claimed))
        self.assertEqual(sql(f"SELECT entitlement_revoked_credits FROM orders WHERE id='{order['id']}'").stdout.strip(), "33")
        self.assertEqual(self.refund_claim(order, second)["mode"], "wait")
        sql(f"UPDATE alipay_refunds SET submitted_at=now()-interval '2 minutes' WHERE id='{first['id']}'")
        sql(f"UPDATE alipay_refunds SET next_query_at=now() WHERE id='{second['id']}'")
        sql(self.finish(order, self.refund_claim(order, second)))
        self.assertEqual(sql(f"SELECT entitlement_revoked_credits FROM orders WHERE id='{order['id']}'").stdout.strip(), "100")
        old = self.paid()
        sql(f"UPDATE orders SET paid_at=now()-interval '366 days' WHERE id='{old['id']}'")
        self.assertNotEqual(sql(self.reserve(old), fail=False).returncode, 0)
        capped = self.paid()
        sql(f"""INSERT INTO alipay_refunds(order_id,out_trade_no,out_request_no,refund_amount,status,pay_channel)
          SELECT '{capped['id']}','{capped['order_no']}',gen_random_uuid()::text,0.10,'unknown','wechat'
          FROM generate_series(1,50);""")
        self.assertNotEqual(sql(self.reserve(capped, "0.10"), fail=False).returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
