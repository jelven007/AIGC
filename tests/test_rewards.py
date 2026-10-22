"""真实PG16：旧邀请接管、验证赠分、原请求领取、资格/分页与异常上报。"""
import concurrent.futures
import json
import re
import unittest
import uuid
import test_finance as finance

sql = finance.sql
legacy_owner = str(uuid.uuid4())
legacy_invitee = str(uuid.uuid4())


class RewardsTest(unittest.TestCase):
    setUpClass = classmethod(finance.FinanceTest.setUpClass.__func__)
    setUp = finance.FinanceTest.setUp
    as_service = finance.FinanceTest.as_service
    as_user = finance.FinanceTest.as_user
    create_job_sql = finance.FinanceTest.create_job_sql
    create_job = finance.FinanceTest.create_job
    claim_job = finance.FinanceTest.claim_job
    job_event_sql = finance.FinanceTest.job_event_sql
    submitted_job = finance.FinanceTest.submitted_job

    @staticmethod
    def before_migration(path):
        if not path.name.startswith("00060_"):
            return
        snapshot = (finance.ROOT / "supabase/schema.sql").read_text()
        # 仅装入旧邀请表及两个实际快照函数，验证增量能接管未知触发器名。
        sql('ALTER TABLE profiles ADD COLUMN invite_code text UNIQUE;')
        for name in ("handle_new_user_invite_code", "process_invitation"):
            function = re.search(rf'CREATE FUNCTION "public"\."{name}"\(\).*?\$\$;', snapshot, re.S).group()
            sql(function)
        table = re.search(r'CREATE TABLE "public"\."invitations" \(.*?\n\);', snapshot, re.S).group()
        sql(table + """ALTER TABLE invitations ADD PRIMARY KEY(id);
          CREATE TRIGGER legacy_profile_code BEFORE INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION handle_new_user_invite_code();
          CREATE TRIGGER z_old_invitation AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION process_invitation();""")
        sql(f"""INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('{legacy_owner}','legacy@example.com',now());
          INSERT INTO auth.users(id,email,raw_user_meta_data) SELECT '{legacy_invitee}','legacy-invitee@example.com',
            jsonb_build_object('invited_by_code',invite_code) FROM profiles WHERE id='{legacy_owner}';""")

    def register_invited(self, confirmed=False):
        sql(f"UPDATE auth.users SET email_confirmed_at=now() WHERE id='{self.user}'")
        code = sql(f"SELECT invite_code FROM profiles WHERE id='{self.user}'").stdout.strip()
        invitee = str(uuid.uuid4())
        sql(f"""INSERT INTO auth.users(id,email,raw_user_meta_data,email_confirmed_at)
          VALUES('{invitee}','new-{invitee}@example.com','{{"invited_by_code":" {code.lower()} "}}',
          {"now()" if confirmed else "NULL"});""")
        return invitee

    def activity(self, kind="daily_checkin", limit=0):
        aid = str(uuid.uuid4())
        sql(f"INSERT INTO activities(id,title,type,reward_credits,max_times) VALUES('{aid}','测试活动','{kind}',5,{limit})")
        return aid

    def test_legacy_records_and_trigger_adoption_never_reissue(self):
        before = sql(f"SELECT credits_total,credits_used FROM user_plans WHERE user_id='{legacy_owner}'").stdout.strip()
        sql(f"UPDATE auth.users SET email_confirmed_at=now() WHERE id='{legacy_invitee}'")
        sql(self.as_service(f"SELECT settle_verified_invitation('{legacy_invitee}')"))
        self.assertEqual(sql(f"SELECT credits_total,credits_used FROM user_plans WHERE user_id='{legacy_owner}'").stdout.strip(), before)
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE user_id='{legacy_owner}' AND reward_source='invitation'").stdout.strip(), "0")
        self.assertEqual(sql("SELECT count(*) FROM pg_trigger WHERE tgname='z_old_invitation'").stdout.strip(), "0")
        self.assertEqual(sql("SELECT count(*) FROM pg_trigger WHERE tgname='on_auth_user_created' AND tgrelid='auth.users'::regclass").stdout.strip(), "1")
        self.assertEqual(sql(self.as_service("SELECT reward_schema_ready()")).stdout.strip(), "t")
        self.assertNotEqual(sql(self.as_user("SELECT reward_schema_ready()"), fail=False).returncode, 0)

    def test_pending_verification_adds_both_bonuses_preserving_usage_once(self):
        sql(self.as_user(f"SELECT deduct_credits('{self.user}',5,'usage')"))
        invitee = self.register_invited()
        self.assertEqual(sql(f"SELECT status FROM invitations WHERE invitee_id='{invitee}'").stdout.strip(), "pending")
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{invitee}'").stdout.strip(), "20")
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(lambda _: sql(f"UPDATE auth.users SET email_confirmed_at=now() WHERE id='{invitee}'"), range(6)))
        self.assertEqual(sql(f"SELECT credits_total,credits_used FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "70|5")
        self.assertEqual(sql(f"SELECT credits_total,credits_used FROM user_plans WHERE user_id='{invitee}'").stdout.strip(), "70|0")
        self.assertEqual(sql(f"SELECT count(*) FROM credit_logs WHERE reward_key=(SELECT id::text FROM invitations WHERE invitee_id='{invitee}')").stdout.strip(), "2")

    def test_bonus_failure_rolls_back_verification_and_can_retry(self):
        invitee = self.register_invited()
        sql("ALTER TABLE credit_logs ADD CONSTRAINT reject_test_invitation CHECK(action IS DISTINCT FROM 'invitation_invitee') NOT VALID")
        try:
            self.assertNotEqual(sql(f"UPDATE auth.users SET email_confirmed_at=now() WHERE id='{invitee}'", fail=False).returncode, 0)
            self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "20")
            self.assertEqual(sql(f"SELECT status FROM invitations WHERE invitee_id='{invitee}'").stdout.strip(), "pending")
            self.assertEqual(sql(f"SELECT email_confirmed_at IS NULL FROM auth.users WHERE id='{invitee}'").stdout.strip(), "t")
        finally:
            sql("ALTER TABLE credit_logs DROP CONSTRAINT reject_test_invitation")
        sql(f"UPDATE auth.users SET phone_confirmed_at=now() WHERE id='{invitee}'")
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "70")

    def test_registration_ignores_invalid_or_banned_inviter_and_browser_cannot_forge(self):
        sql(f"UPDATE auth.users SET email_confirmed_at=now(),banned_until=now()+interval '1 day' WHERE id='{self.user}'")
        code = sql(f"SELECT invite_code FROM profiles WHERE id='{self.user}'").stdout.strip()
        for token in (code, "INVALID"):
            invitee = str(uuid.uuid4())
            sql(f"INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('{invitee}','{invitee}@example.com','{{\"invited_by_code\":\"{token}\"}}')")
            self.assertEqual(sql(f"SELECT count(*) FROM invitations WHERE invitee_id='{invitee}'").stdout.strip(), "0")
        for statement in (
            f"UPDATE profiles SET invite_code='FORGED99' WHERE id='{self.user}'",
            "DELETE FROM invitations",
            f"INSERT INTO profiles(id) VALUES('{uuid.uuid4()}')",
            f"SELECT settle_verified_invitation('{self.user}')",
            f"INSERT INTO activity_reward_receipts(user_id,request_key) VALUES('{self.user}','{uuid.uuid4()}')",
        ):
            self.assertNotEqual(sql(self.as_user(statement), fail=False).returncode, 0)

    def test_invitations_aggregate_over_api_limit_page_and_private_labels(self):
        # 历史重复记录也原样保留，统计不受1000条Data API限制影响。
        sql(f"""INSERT INTO invitations(inviter_id,invitee_id,invite_code,reward_version,status)
          SELECT '{self.user}','{self.other}','LEGACY99',NULL,'completed' FROM generate_series(1,1105);
          INSERT INTO invitations(inviter_id,invitee_id,invite_code,reward_version) VALUES('{self.other}','{self.user}','OTHER999',NULL);""")
        data = json.loads(sql(self.as_user("SELECT get_my_invitations(20,20)")).stdout)
        self.assertEqual(data["total"], 1105)
        self.assertEqual(data["legacy"], 1105)
        self.assertEqual(data["credits"], 0)
        self.assertEqual(len(data["items"]), 20)
        self.assertNotIn("@", json.dumps(data))
        self.assertEqual(len(json.loads(sql(self.as_user("SELECT get_my_invitations(1100,20)")).stdout)["items"]), 5)
        self.assertNotEqual(sql(self.as_user("SELECT get_my_invitations(-1,100)"), fail=False).returncode, 0)
        self.assertNotEqual(sql("SET ROLE anon; SELECT get_my_invitations()", fail=False).returncode, 0)

    def test_activity_original_request_concurrent_retry_after_catalog_close(self):
        aid = self.activity("login_first", 1)
        key = str(uuid.uuid4())
        claim = self.as_user(f"SELECT claim_activity_reward('{aid}','{key}')")
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            rows = list(pool.map(lambda _: json.loads(sql(claim).stdout), range(6)))
        self.assertEqual(sum(not row["already_claimed"] for row in rows), 1)
        self.assertEqual(sql(f"SELECT credits_total FROM user_plans WHERE user_id='{self.user}'").stdout.strip(), "25")
        sql(f"UPDATE activities SET reward_credits=999,status='closed' WHERE id='{aid}'")
        self.assertEqual(json.loads(sql(claim).stdout)["reward"], 5)
        self.assertNotEqual(sql(self.as_user(f"SELECT claim_activity_reward('{self.activity()}','{key}')"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_user(f"SELECT claim_activity_reward('{aid}','{uuid.uuid4()}')"), fail=False).returncode, 0)

    def test_eligibility_utc_window_video_evidence_unsupported_and_max_times(self):
        aids = {kind: self.activity(kind, 2) for kind in ("daily_checkin", "video_first", "join_community", "login_first")}
        def eligible(aid):
            items = json.loads(sql(self.as_user("SELECT get_my_activities()")).stdout)["items"]
            return next(row["eligibility"] for row in items if row["id"] == aid)
        self.assertEqual(eligible(aids["video_first"]), "video_required")
        sql(f"INSERT INTO video_projects(user_id,title,status,video_url) VALUES('{self.user}','客户端完成态','completed','https://fake.example/video')")
        self.assertEqual(eligible(aids["video_first"]), "video_required")
        job = self.submitted_job()
        sql(self.job_event_sql(job, "completed", video="'https://provider.example/actual.mp4'"))
        self.assertEqual(eligible(aids["video_first"]), "eligible")
        self.assertEqual(eligible(aids["join_community"]), "evidence_required")
        sql(self.as_user(f"SELECT claim_activity_reward('{aids['daily_checkin']}','{uuid.uuid4()}')"))
        sql(f"UPDATE user_activities SET last_claimed_at=now()-interval '1 day',completed_times=0 WHERE user_id='{self.user}'")
        self.assertEqual(eligible(aids["daily_checkin"]), "claimed_today")
        self.assertNotEqual(sql(self.as_user(f"SELECT claim_activity_reward('{aids['daily_checkin']}')"), fail=False).returncode, 0)
        sql(f"UPDATE activities SET start_time=now()+interval '1 day' WHERE id='{aids['login_first']}'")
        self.assertEqual(eligible(aids["login_first"]), "not_started")
        sql(f"UPDATE activities SET start_time=now()-interval '1 day',end_time=now() WHERE id='{aids['login_first']}'")
        self.assertEqual(eligible(aids["login_first"]), "expired")
        sql(f"UPDATE activities SET max_times=1 WHERE id='{aids['daily_checkin']}'")
        sql(f"UPDATE user_activities SET completed_times=1 WHERE user_id='{self.user}'")
        # 完整昨日回执，并非只回拨页面汇总时间。
        sql(f"UPDATE activity_reward_receipts SET period=to_char(now()-interval '1 day','YYYY-MM-DD') WHERE user_id='{self.user}'")
        self.assertEqual(eligible(aids["daily_checkin"]), "completed")

    def test_error_reports_own_receipt_rate_bound_no_query_or_credentials(self):
        key = str(uuid.uuid4())
        report = self.as_user(f"SELECT report_frontend_error('{key}','/activities')")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            rows = list(pool.map(lambda _: json.loads(sql(report).stdout), range(4)))
        self.assertEqual(len({row["id"] for row in rows}), 1)
        for _ in range(9):
            sql(self.as_user(f"SELECT report_frontend_error('{uuid.uuid4()}','/profile')"))
        self.assertNotEqual(sql(self.as_user(f"SELECT report_frontend_error('{uuid.uuid4()}','/profile')"), fail=False).returncode, 0)
        self.assertTrue(json.loads(sql(report).stdout)["ok"])
        for path in ("/profile?token=private", "https://example.com", "/profile#access_token"):
            self.assertNotEqual(sql(self.as_user(f"SELECT report_frontend_error('{uuid.uuid4()}','{path}')"), fail=False).returncode, 0)
        self.assertNotEqual(sql(self.as_user("INSERT INTO error_logs(source) VALUES('forged')"), fail=False).returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
