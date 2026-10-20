"""真实 PostgreSQL 验证 Cron 派发；平台 Cron/HTTP/Vault 用隔离替身，不发网络请求。"""
from pathlib import Path
import concurrent.futures
import unittest
import test_finance as finance

sql = finance.sql

ROOT = Path(__file__).resolve().parents[1]
SCHEDULE = (ROOT / "supabase/ops/video_worker_schedule.sql").read_text()
SCHEDULE = "\n".join(line for line in SCHEDULE.splitlines() if not line.startswith("CREATE EXTENSION"))


class ScheduleDatabaseTest(unittest.TestCase):
    as_service = finance.FinanceTest.as_service
    create_job_sql = finance.FinanceTest.create_job_sql

    @classmethod
    def setUpClass(cls):
        finance.FinanceTest.setUpClass.__func__(cls)
        sql("""
          CREATE SCHEMA vault;
          CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text);
          CREATE SCHEMA cron;
          CREATE TABLE cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text,command text,active bool);
          CREATE FUNCTION cron.schedule(p_name text,p_schedule text,p_command text) RETURNS bigint
          LANGUAGE plpgsql AS $$
          DECLARE v_id bigint;
          BEGIN
            INSERT INTO cron.job(jobname,schedule,command,active) VALUES(p_name,p_schedule,p_command,true)
              ON CONFLICT(jobname) DO UPDATE SET schedule=excluded.schedule,command=excluded.command,active=true
              RETURNING jobid INTO v_id;
            RETURN v_id;
          END; $$;
          CREATE SCHEMA net;
          CREATE TABLE net._http_response(id bigint,status_code int,timed_out bool,content text);
          CREATE TABLE net.test_requests(id bigserial PRIMARY KEY,url text,headers jsonb,body jsonb,timeout_ms int);
          CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int)
          RETURNS bigint LANGUAGE sql AS $$
            INSERT INTO net.test_requests(url,headers,body,timeout_ms)
              VALUES(url,headers,body,timeout_milliseconds) RETURNING id;
          $$;
        """)

    def setUp(self):
        finance.FinanceTest.setUp(self)
        sql("""
          TRUNCATE vault.decrypted_secrets,net._http_response,net.test_requests,cron.job;
          DELETE FROM public.video_jobs;
          INSERT INTO vault.decrypted_secrets VALUES
            ('supabase_url','https://project.example'),
            ('video_worker_secret','isolated_test_secret_01234567890123456789');
          UPDATE user_plans SET credits_total=200;
        """)
        if sql("SELECT to_regclass('public.video_worker_dispatches');").stdout.strip():
            sql("TRUNCATE public.video_worker_dispatches")

    def install(self):
        sql(SCHEDULE)

    def create_jobs(self, count):
        for _ in range(count):
            sql(self.create_job_sql())

    def dispatch(self):
        sql("SELECT public.dispatch_video_workers()")

    def test_install_requires_credentials_and_is_idempotent(self):
        sql("DELETE FROM vault.decrypted_secrets WHERE name='video_worker_secret'")
        self.assertNotEqual(sql(SCHEDULE, fail=False).returncode, 0)
        self.assertEqual(sql("SELECT count(*) FROM cron.job").stdout.strip(), "0")
        sql("INSERT INTO vault.decrypted_secrets VALUES('video_worker_secret','isolated_test_secret_01234567890123456789')")
        self.install()
        self.install()
        self.assertEqual(sql("SELECT count(*) FROM cron.job WHERE jobname='shopro-video-workers'").stdout.strip(), "1")
        for statement in (
            "SET ROLE authenticated; SELECT public.dispatch_video_workers();",
            "SET ROLE authenticated; SELECT * FROM public.video_worker_dispatches;",
        ):
            self.assertNotEqual(sql(statement, fail=False).returncode, 0)

    def test_empty_queue_does_not_send_requests(self):
        self.install()
        self.dispatch()
        self.assertEqual(sql("SELECT count(*) FROM net.test_requests").stdout.strip(), "0")
        self.create_jobs(2)
        self.dispatch()
        self.assertEqual(sql("SELECT count(*) FROM net.test_requests").stdout.strip(), "2")

    def test_concurrent_ticks_cap_inflight_and_reuse_finished_slots(self):
        self.install()
        self.create_jobs(8)
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(lambda _: self.dispatch(), range(6)))
        self.assertEqual(sql("SELECT count(*) FROM net.test_requests").stdout.strip(), "4")
        sql("""INSERT INTO net._http_response
          SELECT request_id,200,false,'{"processed":1}' FROM public.video_worker_dispatches
          ORDER BY request_id LIMIT 2""")
        self.dispatch()
        self.assertEqual(sql("SELECT count(*) FROM net.test_requests").stdout.strip(), "6")
        self.assertEqual(sql("SELECT count(*) FROM public.video_worker_dispatches WHERE finished_at IS NULL").stdout.strip(), "4")
        self.assertEqual(sql("SELECT sum(processed) FROM public.video_worker_dispatches WHERE finished_at IS NOT NULL").stdout.strip(), "2")

    def test_stale_request_recovery_and_log_retention(self):
        self.install()
        self.create_jobs(6)
        self.dispatch()
        sql("""UPDATE public.video_worker_dispatches SET queued_at=now()-interval '181 seconds';
          INSERT INTO public.video_worker_dispatches(request_id,queued_at,finished_at)
          VALUES(-1,now()-interval '8 days',now()-interval '8 days');""")
        self.dispatch()
        self.assertEqual(sql("SELECT count(*) FROM public.video_worker_dispatches WHERE error_code='response_missing'").stdout.strip(), "4")
        self.assertEqual(sql("SELECT count(*) FROM public.video_worker_dispatches WHERE request_id=-1").stdout.strip(), "0")
        self.assertEqual(sql("SELECT count(*) FROM public.video_worker_dispatches WHERE finished_at IS NULL").stdout.strip(), "4")


if __name__ == "__main__":
    unittest.main(verbosity=2)
