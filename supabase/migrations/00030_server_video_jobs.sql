-- 第三轮：持久化队列、一次提交、服务端确认失败与逐笔退款。
BEGIN;

ALTER TABLE public.video_projects ADD COLUMN IF NOT EXISTS aspect_ratio text DEFAULT '16:9';

ALTER TABLE public.video_jobs
  ADD COLUMN request_key uuid,
  ADD COLUMN provider text,
  ADD COLUMN provider_task_id text,
  ADD COLUMN charge_id uuid REFERENCES public.credit_logs(id),
  ADD COLUMN credit_cost integer,
  ADD COLUMN billing_state text CHECK (billing_state IN ('reserved','settled','refunded')),
  ADD COLUMN submission_state text CHECK (submission_state IN ('queued','submitting','submitted','unknown')),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN resolution_event jsonb,
  ADD COLUMN next_poll_at timestamptz DEFAULT now(),
  ADD COLUMN poll_errors integer NOT NULL DEFAULT 0,
  ADD COLUMN needs_attention boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX video_jobs_request_key ON public.video_jobs(user_id, request_key) WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX video_jobs_charge_id ON public.video_jobs(charge_id) WHERE charge_id IS NOT NULL;
CREATE UNIQUE INDEX video_jobs_provider_task ON public.video_jobs(provider, provider_task_id) WHERE provider_task_id IS NOT NULL;
CREATE INDEX video_jobs_due ON public.video_jobs(next_poll_at)
  WHERE status IN ('pending','processing') AND charge_id IS NOT NULL;

-- 关联任务的档案状态由执行器维护；允许用户改标题/封面，阻止伪造结果或删除进行中档案。
CREATE FUNCTION public.guard_server_video_project()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.video_jobs WHERE project_id=OLD.id AND charge_id IS NOT NULL) THEN
    IF TG_OP='DELETE' THEN
      IF EXISTS (SELECT 1 FROM public.video_jobs WHERE project_id=OLD.id AND status IN ('pending','processing')) THEN
        RAISE EXCEPTION '生成任务仍在处理，暂不能删除作品';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.progress IS DISTINCT FROM OLD.progress
      OR NEW.video_url IS DISTINCT FROM OLD.video_url OR NEW.prompt_text IS DISTINCT FROM OLD.prompt_text
      OR NEW.duration IS DISTINCT FROM OLD.duration OR NEW.resolution IS DISTINCT FROM OLD.resolution
      OR NEW.aspect_ratio IS DISTINCT FROM OLD.aspect_ratio OR NEW.video_style IS DISTINCT FROM OLD.video_style THEN
      RAISE EXCEPTION '生成任务状态和原始参数由服务端维护';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER video_projects_guard_server_task BEFORE UPDATE OR DELETE ON public.video_projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_server_video_project();

UPDATE public.credit_costs SET cost = 10, description = '视频生成：提交预占，成功结算，确定失败释放'
  WHERE action = 'generate_video';

CREATE FUNCTION public.create_video_job(p_user_id uuid, p_request_key uuid, p_provider text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job public.video_jobs%ROWTYPE;
  v_charge jsonb;
  v_cost integer;
  v_project_id uuid;
BEGIN
  IF p_request_key IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR p_provider IS NULL OR p_provider NOT IN ('MiniMax','SeedanceMini','Wan3','HappyHorse','Kling','Seedance')
    OR length(trim(COALESCE(p_payload->>'prompt',''))) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION '视频任务参数非法';
  END IF;
  -- 与扣费/退款统一先锁账户，序列化同一用户的幂等创建。
  PERFORM 1 FROM public.user_plans WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
  SELECT * INTO v_job FROM public.video_jobs WHERE user_id = p_user_id AND request_key = p_request_key;
  IF FOUND THEN
    IF v_job.provider IS DISTINCT FROM p_provider OR v_job.payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION '同一请求标识不能用于不同任务';
    END IF;
    RETURN to_jsonb(v_job);
  END IF;
  SELECT cost INTO v_cost FROM public.credit_costs WHERE action = 'generate_video';
  IF v_cost IS NULL OR v_cost <= 0 THEN RAISE EXCEPTION '视频积分价格未配置'; END IF;
  v_charge := public.deduct_credits(p_user_id, v_cost, 'generate_video');
  INSERT INTO public.video_projects(user_id,title,status,prompt_text,video_style,duration,aspect_ratio,resolution,progress)
  VALUES (p_user_id, left(COALESCE(NULLIF(p_payload->>'title',''),p_payload->>'prompt'),80),
    'processing', p_payload->>'prompt', p_provider, (p_payload->>'duration')::integer,
    p_payload->>'ratio', p_payload->>'resolution', 0)
  RETURNING id INTO v_project_id;
  INSERT INTO public.video_jobs(user_id,project_id,request_key,provider,payload,charge_id,credit_cost,
    billing_state,submission_state,max_attempts)
  VALUES (p_user_id,v_project_id,p_request_key,p_provider,p_payload,(v_charge->>'charge_id')::uuid,
    v_cost,'reserved','queued',1) RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;

-- 多个 Worker/浏览器查询共享租约，只有第一次 queued 可领取为提交。
CREATE FUNCTION public.claim_video_job(p_job_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.video_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.video_jobs
  WHERE charge_id IS NOT NULL AND status IN ('pending','processing')
    AND (p_job_id IS NULL OR id = p_job_id)
    AND submission_state IN ('queued','submitting','submitted')
    AND next_poll_at <= now() AND (lease_until IS NULL OR lease_until < now())
  ORDER BY next_poll_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_job.submission_state = 'submitting' AND v_job.resolution_event IS NULL THEN
    -- 崩溃发生在 POST 前后无法判定，不能重提或凭超时退款。
    UPDATE public.video_jobs SET submission_state='unknown',needs_attention=true,
      error_message='提交执行器中断，需核对上游受理结果',lease_token=NULL,lease_until=NULL
    WHERE id=v_job.id;
    RETURN NULL;
  END IF;
  UPDATE public.video_jobs SET status='processing',
    submission_state=CASE WHEN submission_state='queued' THEN 'submitting' ELSE submission_state END,
    attempts=attempts + CASE WHEN submission_state='queued' THEN 1 ELSE 0 END,
    started_at=COALESCE(started_at,now()), lease_token=gen_random_uuid(),
    lease_until=now()+interval '180 seconds'
  WHERE id=v_job.id RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;

-- 先持久化可信上游终态证据，再做资金事务。退款/归档故障不丢失重试依据。
CREATE FUNCTION public.checkpoint_video_job_result(
  p_job_id uuid, p_lease_token uuid, p_event text, p_video_url text DEFAULT NULL, p_error text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.video_jobs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_job FROM public.video_jobs WHERE id=p_job_id FOR UPDATE;
  IF p_lease_token IS NULL OR v_job.lease_token IS DISTINCT FROM p_lease_token
    OR v_job.status <> 'processing' THEN RAISE EXCEPTION '任务执行租约已失效'; END IF;
  IF p_event IS NULL THEN RAISE EXCEPTION '缺少上游终态证据'; END IF;
  IF NOT ((p_event='submit_rejected' AND v_job.submission_state='submitting')
    OR (p_event IN ('completed','failed') AND v_job.submission_state='submitted')) THEN
    RAISE EXCEPTION '非法上游终态证据';
  END IF;
  IF p_event='completed' AND (p_video_url IS NULL OR p_video_url !~ '^https://') THEN
    RAISE EXCEPTION '成片地址非法';
  END IF;
  UPDATE public.video_jobs SET resolution_event=jsonb_build_object(
    'event',p_event,'video_url',p_video_url,'error',p_error)
  WHERE id=p_job_id;
END;
$$;

-- 状态、档案、退款同事务；过期执行器不能覆盖新租约或终态。
CREATE FUNCTION public.record_video_job_event(
  p_job_id uuid, p_lease_token uuid, p_event text,
  p_task_id text DEFAULT NULL, p_video_url text DEFAULT NULL,
  p_error text DEFAULT NULL, p_progress integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.video_jobs%ROWTYPE; v_user uuid; v_refund jsonb;
BEGIN
  SELECT user_id INTO v_user FROM public.video_jobs WHERE id=p_job_id;
  PERFORM 1 FROM public.user_plans WHERE user_id=v_user FOR UPDATE;
  SELECT * INTO STRICT v_job FROM public.video_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.status IN ('completed','failed','cancelled') THEN RETURN to_jsonb(v_job); END IF;
  IF p_lease_token IS NULL OR v_job.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION '任务执行租约已失效';
  END IF;
  IF v_job.resolution_event IS NOT NULL AND (
    p_event IS DISTINCT FROM v_job.resolution_event->>'event'
    OR p_video_url IS DISTINCT FROM v_job.resolution_event->>'video_url'
  ) THEN RAISE EXCEPTION '不得覆盖已保存的上游终态证据'; END IF;
  IF p_event = 'accepted' AND v_job.submission_state='submitting' AND length(p_task_id) BETWEEN 1 AND 256 THEN
    UPDATE public.video_jobs SET provider_task_id=p_task_id,submission_state='submitted',
      progress=5,error_message=NULL,next_poll_at=now()+interval '10 seconds'
    WHERE id=p_job_id;
  ELSIF p_event = 'submit_unknown' AND v_job.submission_state='submitting' THEN
    UPDATE public.video_jobs SET submission_state='unknown',needs_attention=true,error_message=left(p_error,500)
    WHERE id=p_job_id;
  ELSIF (p_event='submit_rejected' AND v_job.submission_state='submitting')
    OR (p_event='failed' AND v_job.submission_state='submitted' AND v_job.provider_task_id IS NOT NULL) THEN
    v_refund := public.refund_credit_charge(v_user,v_job.charge_id,COALESCE(p_error,'视频任务确定失败'));
    UPDATE public.video_jobs SET status='failed',billing_state='refunded',needs_attention=false,
      error_message=left(COALESCE(p_error,'视频生成失败'),500),completed_at=now()
    WHERE id=p_job_id;
    UPDATE public.video_projects SET status='failed',progress=0,error_message=left(p_error,500)
    WHERE id=v_job.project_id AND user_id=v_user;
  ELSIF p_event='completed' AND v_job.submission_state='submitted'
    AND p_video_url ~ '^https://' THEN
    UPDATE public.video_jobs SET status='completed',billing_state='settled',progress=100,
      result=jsonb_build_object('video_url',p_video_url),completed_at=now(),needs_attention=false,error_message=NULL
    WHERE id=p_job_id;
    UPDATE public.video_projects SET status='completed',progress=100,video_url=p_video_url,error_message=NULL
    WHERE id=v_job.project_id AND user_id=v_user;
  ELSIF p_event IN ('pending','query_error') AND v_job.submission_state='submitted' THEN
    UPDATE public.video_jobs SET
      progress=GREATEST(progress,LEAST(95,COALESCE(p_progress,progress))),
      poll_errors=CASE WHEN p_event='query_error' THEN LEAST(poll_errors+1,10) ELSE 0 END,
      error_message=CASE WHEN p_event='query_error' THEN left(p_error,500) ELSE NULL END,
      needs_attention=started_at < now()-interval '24 hours',
      next_poll_at=now()+make_interval(secs => CASE
        WHEN started_at < now()-interval '24 hours' THEN 3600
        WHEN p_event='query_error' THEN LEAST(600,30 * (2^LEAST(poll_errors,4))::int)
        ELSE 15 END)
    WHERE id=p_job_id;
    UPDATE public.video_projects SET progress=GREATEST(progress,LEAST(95,COALESCE(p_progress,progress)))
    WHERE id=v_job.project_id AND user_id=v_user;
  ELSE
    RAISE EXCEPTION '非法任务状态转换：% / %',v_job.submission_state,p_event;
  END IF;
  UPDATE public.video_jobs SET lease_token=NULL,lease_until=NULL,resolution_event=NULL
    WHERE id=p_job_id RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;

-- 仅运维可用：未知提交查到上游 ID 后恢复查询；核对确未受理则释放。
CREATE FUNCTION public.reconcile_video_submission(p_job_id uuid, p_task_id text, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.video_jobs%ROWTYPE; v_token uuid := gen_random_uuid(); v_user uuid;
BEGIN
  IF length(trim(COALESCE(p_note,''))) < 10 THEN RAISE EXCEPTION '请提供核对依据（至少10字）'; END IF;
  SELECT user_id INTO v_user FROM public.video_jobs WHERE id=p_job_id;
  PERFORM 1 FROM public.user_plans WHERE user_id=v_user FOR UPDATE;
  SELECT * INTO STRICT v_job FROM public.video_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.submission_state <> 'unknown' OR v_job.status <> 'processing' THEN
    RAISE EXCEPTION '仅能核对受理结果未知的任务';
  END IF;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES (v_user,'reconcile_video_submission','video_jobs',p_job_id,
      jsonb_build_object('task_id',p_task_id,'evidence',p_note));
  UPDATE public.video_jobs SET submission_state='submitting',lease_token=v_token,needs_attention=false WHERE id=p_job_id;
  RETURN public.record_video_job_event(p_job_id,v_token,
    CASE WHEN p_task_id IS NULL THEN 'submit_rejected' ELSE 'accepted' END,p_task_id,NULL,p_note);
END;
$$;

REVOKE ALL ON FUNCTION public.create_video_job(uuid,uuid,text,jsonb),
  public.claim_video_job(uuid),
  public.checkpoint_video_job_result(uuid,uuid,text,text,text),
  public.record_video_job_event(uuid,uuid,text,text,text,text,integer),
  public.reconcile_video_submission(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_video_job(uuid,uuid,text,jsonb),
  public.claim_video_job(uuid),
  public.checkpoint_video_job_result(uuid,uuid,text,text,text),
  public.record_video_job_event(uuid,uuid,text,text,text,text,integer),
  public.reconcile_video_submission(uuid,text,text) TO service_role;

COMMIT;
