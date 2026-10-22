"""真实PG：同一快照的权益/余额、过期、本人范围与缺账号。"""
import json
import unittest
import uuid
import test_finance as finance

sql = finance.sql


class AccountCreditsTest(unittest.TestCase):
    setUpClass = classmethod(finance.FinanceTest.setUpClass.__func__)
    setUp = finance.FinanceTest.setUp
    as_user = finance.FinanceTest.as_user
    as_service = finance.FinanceTest.as_service

    def credits(self):
        return json.loads(sql(self.as_user("SELECT get_my_credits()")).stdout)

    def test_balance_and_levels_ignore_marketing_name_and_preserve_debt(self):
        sql(f"""UPDATE plans SET name='企业专业免费宣传词' WHERE id='{self.free}';
          UPDATE user_plans SET plan_id='{self.free}',credits_total=4,credits_used=9 WHERE user_id='{self.user}';""")
        snapshot = self.credits()
        self.assertEqual(snapshot["plan_level"], 0)
        self.assertEqual(snapshot["credits_left"], 0)
        self.assertEqual(snapshot["credits_used"], 9)
        sql(f"""UPDATE plans SET name='自定义套餐名称',level=3 WHERE id='{self.plan}';
          UPDATE user_plans SET plan_id='{self.plan}',credits_total=100,credits_used=7,
            expires_at=now()+interval '1 day' WHERE user_id='{self.user}';""")
        snapshot = self.credits()
        self.assertEqual(snapshot["plan_level"], 3)
        self.assertEqual(snapshot["credits_left"], 93)
        self.assertTrue(snapshot["entitlement_active"])
        self.assertEqual(sql(f"SELECT credits_total,credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "100|7")

    def test_expired_cancelled_and_non_expiring_base_do_not_reset_balance(self):
        for status, expiration in (("active", "now()"), ("expired", "now()+interval '1 day'"), ("cancelled", "NULL")):
            sql(f"""UPDATE user_plans SET plan_id='{self.plan}',status='{status}',expires_at={expiration},
              credits_total=150,credits_used=17 WHERE user_id='{self.user}';""")
            snapshot = self.credits()
            self.assertFalse(snapshot["entitlement_active"])
            self.assertEqual(snapshot["plan_level"], 0)
            self.assertEqual(snapshot["configured_plan_level"], 1)
            self.assertEqual(snapshot["credits_left"], 133)
        sql(f"UPDATE user_plans SET plan_id='{self.free}',status='active',expires_at=NULL WHERE user_id='{self.user}'")
        self.assertTrue(self.credits()["entitlement_active"])
        self.assertEqual(self.credits()["credits_left"], 133)

    def test_admin_is_still_own_account_and_anonymous_cannot_read(self):
        sql(f"UPDATE auth.users SET raw_app_meta_data='{{\"role\":\"admin\"}}' WHERE id='{self.user}'")
        self.assertEqual(self.credits()["user_id"], self.user)
        for statement in ("SET ROLE anon; SELECT get_my_credits()", "SET ROLE authenticated; SELECT get_my_credits()"):
            self.assertNotEqual(sql(statement, fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_user("SELECT account_credits_schema_ready()"), fail=False).returncode, 0)
        self.assertEqual(sql(self.as_service("SELECT account_credits_schema_ready()")).stdout.strip(), "t")

    def test_missing_account_is_error_and_never_fabricates_free_zero(self):
        sql(f"DELETE FROM user_plans WHERE user_id='{self.user}'")
        result = sql(self.as_user("SELECT get_my_credits()"), fail=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("尚未初始化", result.stderr)

    def test_phone_verified_registration_without_email_initializes_bonus_and_invitation(self):
        sql(f"UPDATE auth.users SET phone_confirmed_at=now() WHERE id='{self.user}'")
        code = sql(f"SELECT invite_code FROM profiles WHERE id='{self.user}'").stdout.strip()
        invitee = str(uuid.uuid4())
        sql(f"""INSERT INTO auth.users(id,email,phone_confirmed_at,raw_user_meta_data)
          VALUES('{invitee}',NULL,now(),'{{"invited_by_code":"{code}"}}');""")
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{invitee}'").stdout.strip(), "70")
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "70")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{invitee}' AND action='register_gift'").stdout.strip(), "1")
        self.assertEqual(sql(f"SELECT email IS NULL AND username IS NOT NULL FROM profiles WHERE id='{invitee}'").stdout.strip(), "t")


if __name__ == "__main__":
    unittest.main(verbosity=2)
