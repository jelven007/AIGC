-- 可选：在支持 pg_cron、pg_net 与 Vault 的 Supabase SQL Editor 执行。
-- 先在 Vault 创建 supabase_url 与 video_worker_secret；值须与函数 Secrets 一致。
-- 不随业务迁移自动执行，不包含任何线上地址或密钥。
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.dispatch_video_workers()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text; v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='video_worker_secret' LIMIT 1;
  IF v_url IS NULL OR v_secret IS NULL THEN RAISE EXCEPTION 'Vault 缺少视频执行器配置'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.video_jobs WHERE charge_id IS NOT NULL AND status IN ('pending','processing')
      AND submission_state IN ('queued','submitting','submitted') AND next_poll_at <= now()
      AND (lease_until IS NULL OR lease_until < now())
  ) THEN
    PERFORM net.http_post(
      url := rtrim(v_url,'/') || '/functions/v1/video-job-worker',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),
      body := '{}'::jsonb, timeout_milliseconds := 150000
    ) FROM generate_series(1,4);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_video_workers() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('shopro-video-workers','10 seconds','SELECT public.dispatch_video_workers()');
