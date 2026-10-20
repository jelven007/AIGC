-- 可选：在支持 pg_cron、pg_net 与 Vault 的 Supabase SQL Editor 执行。
-- 先在 Vault 创建 supabase_url 与 video_worker_secret；值须与函数 Secrets 一致。
-- 不随业务迁移自动执行，不包含任何线上地址或密钥。
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
BEGIN;

DO $$
DECLARE v_url text; v_secret text;
BEGIN
  IF to_regprocedure('public.claim_video_job(uuid)') IS NULL
    OR to_regprocedure('public.checkpoint_video_job_result(uuid,uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '请先应用 00030_server_video_jobs.sql 并部署 video-job-worker';
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name='supabase_url') <> 1
    OR (SELECT count(*) FROM vault.decrypted_secrets WHERE name='video_worker_secret') <> 1 THEN
    RAISE EXCEPTION 'Vault 需要各一个 supabase_url 与 video_worker_secret，不能缺失或重名';
  END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name='supabase_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='video_worker_secret';
  IF v_url !~ '^https://[^/@?#[:space:]]+(/[^?#[:space:]]*)?$'
    OR length(v_secret) < 32 OR v_secret ~ '[[:space:]]' THEN
    RAISE EXCEPTION '请检查 Vault 中的项目 HTTPS 地址与执行器密钥（至少32字符）';
  END IF;
END;
$$;

-- 只保存请求编号及响应摘要，不保存 Authorization 或上游响应原文。
CREATE TABLE IF NOT EXISTS public.video_worker_dispatches (
  request_id bigint PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status_code integer,
  processed integer,
  error_code text
);
ALTER TABLE public.video_worker_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_worker_dispatches FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX IF NOT EXISTS video_worker_dispatches_inflight
  ON public.video_worker_dispatches(queued_at) WHERE finished_at IS NULL;

CREATE OR REPLACE FUNCTION public.dispatch_video_workers()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text; v_secret text; v_slots integer; v_due integer; v_request_id bigint;
BEGIN
  -- 同一调度周期与手动触发不会重复派发。
  IF NOT pg_try_advisory_xact_lock(8103021) THEN RETURN; END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name='supabase_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='video_worker_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN RAISE EXCEPTION 'Vault 缺少视频执行器配置'; END IF;

  UPDATE public.video_worker_dispatches d SET finished_at=now(),status_code=r.status_code,
    error_code=CASE WHEN r.timed_out THEN 'timeout'
      WHEN r.status_code IS NULL OR r.status_code <> 200 THEN 'http_error' END,
    processed=CASE WHEN r.status_code=200 AND r.content ~ '"processed"[[:space:]]*:[[:space:]]*1'
      THEN 1 WHEN r.status_code=200 THEN 0 END
  FROM net._http_response r WHERE d.request_id=r.id AND d.finished_at IS NULL;
  UPDATE public.video_worker_dispatches SET finished_at=now(),error_code='response_missing'
    WHERE finished_at IS NULL AND queued_at < now()-interval '180 seconds';
  DELETE FROM public.video_worker_dispatches WHERE queued_at < now()-interval '7 days';

  SELECT 4-count(*) INTO v_slots FROM public.video_worker_dispatches WHERE finished_at IS NULL;
  IF v_slots <= 0 THEN RETURN; END IF;
  SELECT count(*) INTO v_due FROM (
    SELECT id FROM public.video_jobs WHERE charge_id IS NOT NULL AND status IN ('pending','processing')
      AND submission_state IN ('queued','submitting','submitted') AND next_poll_at <= now()
      AND (lease_until IS NULL OR lease_until < now()) LIMIT v_slots
  ) due_jobs;
  FOR i IN 1..LEAST(v_slots,v_due) LOOP
    SELECT net.http_post(
      url := rtrim(v_url,'/') || '/functions/v1/video-job-worker',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),
      body := '{"action":"run"}'::jsonb, timeout_milliseconds := 150000
    ) INTO v_request_id;
    INSERT INTO public.video_worker_dispatches(request_id) VALUES (v_request_id);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_video_workers() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('shopro-video-workers','10 seconds','SELECT public.dispatch_video_workers()');
COMMIT;
