-- 停止后续派发，保留已在处理的任务和原扣费/退款记录。
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='shopro-video-workers';
