-- 调度摘要，只读且不展示 Vault 密钥或请求 Authorization。
SELECT jobname,schedule,active FROM cron.job WHERE jobname='shopro-video-workers';

SELECT start_time,end_time,status,
  CASE WHEN status='failed' THEN '调度失败，请检查平台 Cron 日志' ELSE NULL END AS error
FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname='shopro-video-workers')
ORDER BY start_time DESC LIMIT 10;

SELECT request_id,queued_at,finished_at,status_code,processed,error_code
FROM public.video_worker_dispatches ORDER BY queued_at DESC LIMIT 20;

SELECT status,submission_state,billing_state,count(*) AS jobs
FROM public.video_jobs WHERE charge_id IS NOT NULL
GROUP BY status,submission_state,billing_state ORDER BY status,submission_state;
