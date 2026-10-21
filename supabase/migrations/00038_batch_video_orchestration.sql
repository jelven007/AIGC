BEGIN;

ALTER TABLE public.batch_jobs
  ADD COLUMN request_key uuid,
  ADD COLUMN request_payload jsonb,
  ADD COLUMN provider text,
  ADD COLUMN credit_budget integer,
  ADD COLUMN unit_cost integer,
  ADD COLUMN cancellation_requested boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX batch_jobs_request_key ON public.batch_jobs(user_id,request_key) WHERE request_key IS NOT NULL;
ALTER TABLE public.batch_job_items
  ADD COLUMN video_job_id uuid REFERENCES public.video_jobs(id),
  ADD COLUMN position integer;
CREATE UNIQUE INDEX batch_items_video_job ON public.batch_job_items(video_job_id) WHERE video_job_id IS NOT NULL;
CREATE UNIQUE INDEX batch_items_position ON public.batch_job_items(batch_id,position) WHERE position IS NOT NULL;
-- 旧批次从未有服务端执行器，不能伪装为可以恢复的已计费任务。
UPDATE public.batch_jobs SET status='failed',updated_at=now()
  WHERE request_key IS NULL AND status IN ('pending','processing','paused');
UPDATE public.batch_job_items SET status='failed',error_message='旧批次未接入执行器，请重新确认创建'
  WHERE video_job_id IS NULL AND status IN ('pending','processing');
REVOKE ALL ON public.batch_jobs,public.batch_job_items FROM anon,authenticated;
GRANT SELECT ON public.batch_jobs,public.batch_job_items TO authenticated;
GRANT ALL ON public.batch_jobs,public.batch_job_items TO service_role;

CREATE FUNCTION public.batch_video_snapshot(p_user_id uuid,p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_batch public.batch_jobs%ROWTYPE; v_stats record; v_status text; v_items jsonb;
BEGIN
  SELECT * INTO v_batch FROM public.batch_jobs WHERE id=p_batch_id AND user_id=p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*)::int total,
    count(*) FILTER(WHERE v.status='completed')::int completed,
    count(*) FILTER(WHERE v.status='failed')::int failed,
    count(*) FILTER(WHERE v.status='cancelled')::int cancelled,
    count(*) FILTER(WHERE v.status IN ('pending','processing') AND v.submission_state='queued')::int queued,
    count(*) FILTER(WHERE v.status IN ('pending','processing') AND v.submission_state<>'queued')::int running,
    count(*) FILTER(WHERE v.status IN ('pending','processing') AND (v.needs_attention OR v.submission_state='unknown'))::int attention,
    COALESCE(sum(v.credit_cost) FILTER(WHERE v.billing_state='reserved'),0)::int reserved,
    COALESCE(sum(v.credit_cost) FILTER(WHERE v.billing_state='settled'),0)::int settled,
    COALESCE(sum(v.credit_cost) FILTER(WHERE v.billing_state='refunded'),0)::int refunded,
    COALESCE(round(avg(CASE WHEN v.status IN ('completed','failed','cancelled') THEN 100 ELSE v.progress END)),0)::int progress
    INTO v_stats FROM public.batch_job_items i JOIN public.video_jobs v ON v.id=i.video_job_id WHERE i.batch_id=p_batch_id;
  v_status := CASE WHEN v_batch.request_key IS NULL THEN v_batch.status
    WHEN v_stats.completed+v_stats.failed+v_stats.cancelled=v_stats.total THEN
      CASE WHEN v_stats.completed=v_stats.total THEN 'completed'
        WHEN v_stats.completed>0 THEN 'partial'
        WHEN v_stats.failed>0 THEN 'failed' ELSE 'cancelled' END
    WHEN v_batch.cancellation_requested THEN 'cancelling'
    ELSE v_batch.status END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',i.id,'product_id',i.product_id,'product_name',i.product_name,'video_job_id',i.video_job_id,
    'project_id',COALESCE(v.project_id,i.video_project_id),'status',COALESCE(v.status,i.status),
    'submission_state',v.submission_state,'billing_state',v.billing_state,'credit_cost',v.credit_cost,
    'progress',v.progress,'needs_attention',v.needs_attention,'video_url',v.result->>'video_url',
    'error_message',COALESCE(v.error_message,i.error_message)
  ) ORDER BY i.position NULLS LAST,i.created_at,i.id),'[]'::jsonb)
    INTO v_items FROM public.batch_job_items i LEFT JOIN public.video_jobs v ON v.id=i.video_job_id WHERE i.batch_id=p_batch_id;
  RETURN jsonb_build_object('id',v_batch.id,'name',v_batch.name,'provider',v_batch.provider,
    'status',v_status,'created_at',v_batch.created_at,'legacy',v_batch.request_key IS NULL,
    'total_count',CASE WHEN v_batch.request_key IS NULL THEN v_batch.total_count ELSE v_stats.total END,
    'completed_count',v_stats.completed,'failed_count',v_stats.failed,'cancelled_count',v_stats.cancelled,
    'queued_count',v_stats.queued,'running_count',v_stats.running,'attention_count',v_stats.attention,
    'reserved_credits',v_stats.reserved,'settled_credits',v_stats.settled,'refunded_credits',v_stats.refunded,
    'unit_cost',v_batch.unit_cost,'credit_budget',v_batch.credit_budget,'progress',v_stats.progress,'items',v_items);
END;
$$;

CREATE FUNCTION public.create_batch_video_jobs(
  p_user_id uuid,p_request_key uuid,p_name text,p_provider text,p_request jsonb,p_items jsonb,
  p_config_version uuid,p_expected_unit_cost integer,p_budget integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_batch public.batch_jobs%ROWTYPE; v_item jsonb; v_product public.products%ROWTYPE;
  v_job jsonb; v_cost integer; v_total integer; v_position integer := 0;
BEGIN
  IF p_request_key IS NULL OR jsonb_typeof(p_request) IS DISTINCT FROM 'object'
    OR length(trim(COALESCE(p_name,''))) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION '批次参数非法'; END IF;
  -- 同一账户的批次、单任务、退款统一锁账户；任何子任务失败将回滚整批预占与档案。
  PERFORM 1 FROM public.user_plans WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
  SELECT * INTO v_batch FROM public.batch_jobs WHERE user_id=p_user_id AND request_key=p_request_key;
  IF FOUND THEN
    IF v_batch.request_payload IS DISTINCT FROM p_request OR v_batch.provider IS DISTINCT FROM p_provider
      OR v_batch.name IS DISTINCT FROM p_name THEN RAISE EXCEPTION '同一请求标识不能用于不同批次'; END IF;
    RETURN public.batch_video_snapshot(p_user_id,v_batch.id);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_plans u JOIN public.plans p ON p.id=u.plan_id
    WHERE u.user_id=p_user_id AND p.level>=1 AND u.status='active'
    AND (u.expires_at IS NULL OR u.expires_at>now())) THEN
    RAISE EXCEPTION '批量功能需要有效专业版或企业版套餐';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION '每批应包含 1–50 个商品';
  END IF;
  IF (SELECT count(DISTINCT item->>'product_id') FROM jsonb_array_elements(p_items) item)<>jsonb_array_length(p_items) THEN
    RAISE EXCEPTION '批次商品不能重复';
  END IF;
  SELECT cost INTO v_cost FROM public.credit_costs WHERE action='generate_video' FOR SHARE;
  v_total := v_cost*jsonb_array_length(p_items);
  IF v_cost IS NULL OR v_cost<=0 OR v_cost IS DISTINCT FROM p_expected_unit_cost THEN
    RAISE EXCEPTION '积分价格已更新，请重新确认预算';
  END IF;
  IF p_budget IS NULL OR p_budget<v_total OR p_budget>100000 THEN RAISE EXCEPTION '批次预算不足或非法'; END IF;
  IF (SELECT credits_total-credits_used FROM public.user_plans WHERE user_id=p_user_id)<v_total THEN
    RAISE EXCEPTION '积分不足，整批需要 % 积分',v_total;
  END IF;
  IF (SELECT count(*) FROM public.batch_jobs b WHERE b.user_id=p_user_id AND EXISTS(
    SELECT 1 FROM public.batch_job_items i JOIN public.video_jobs v ON v.id=i.video_job_id
    WHERE i.batch_id=b.id AND v.status IN ('pending','processing')))>=5 THEN
    RAISE EXCEPTION '最多同时处理 5 个批次，请等待已有任务';
  END IF;
  INSERT INTO public.batch_jobs(user_id,name,status,request_key,request_payload,provider,credit_budget,unit_cost,total_count)
    VALUES(p_user_id,trim(p_name),'processing',p_request_key,p_request,p_provider,p_budget,v_cost,jsonb_array_length(p_items))
    RETURNING * INTO v_batch;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id=(v_item->>'product_id')::uuid AND user_id=p_user_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION '商品不存在或无权使用'; END IF;
    v_job := public.create_video_job(p_user_id,gen_random_uuid(),p_provider,v_item->'input',p_config_version);
    INSERT INTO public.batch_job_items(batch_id,product_id,product_name,video_project_id,video_job_id,position,config)
      VALUES(v_batch.id,v_product.id,v_product.name,(v_job->>'project_id')::uuid,(v_job->>'id')::uuid,
        v_position,jsonb_build_object('model_config_version_id',p_config_version));
    v_position := v_position+1;
  END LOOP;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(p_user_id,'create_batch_video','batch_jobs',v_batch.id,
      jsonb_build_object('total',v_position,'reserved_credits',v_total,'config_version',p_config_version));
  RETURN public.batch_video_snapshot(p_user_id,v_batch.id);
END;
$$;

-- 未提交子任务先共享锁父批次，再领取子任务；暂停/取消排他锁父批次，阻止竞态提交。
-- 已提交、未知提交及结果证据恢复不受暂停影响，持续查询/核对，不凭取消返还已受理费用。
ALTER FUNCTION public.claim_video_job(uuid) RENAME TO claim_video_job_without_batch;
REVOKE ALL ON FUNCTION public.claim_video_job_without_batch(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.claim_video_job(p_job_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_candidate record; v_job jsonb;
BEGIN
  FOR v_candidate IN
    SELECT v.id,v.submission_state,i.batch_id FROM public.video_jobs v
      LEFT JOIN public.batch_job_items i ON i.video_job_id=v.id
      LEFT JOIN public.batch_jobs b ON b.id=i.batch_id
    WHERE v.charge_id IS NOT NULL AND v.status IN ('pending','processing')
      AND (v.model_config_version_id IS NOT NULL OR v.resolution_event IS NOT NULL)
      AND (p_job_id IS NULL OR v.id=p_job_id)
      AND v.submission_state IN ('queued','submitting','submitted')
      AND v.next_poll_at<=now() AND (v.lease_until IS NULL OR v.lease_until<now())
      AND (v.submission_state<>'queued' OR i.batch_id IS NULL OR b.status IN ('pending','processing'))
    ORDER BY v.next_poll_at,v.created_at,v.id LIMIT 50
  LOOP
    IF v_candidate.batch_id IS NOT NULL AND v_candidate.submission_state='queued' THEN
      PERFORM 1 FROM public.batch_jobs WHERE id=v_candidate.batch_id AND status IN ('pending','processing')
        AND NOT cancellation_requested FOR SHARE SKIP LOCKED;
      IF NOT FOUND THEN CONTINUE; END IF;
    END IF;
    v_job := public.claim_video_job_without_batch(v_candidate.id);
    IF v_job IS NOT NULL THEN RETURN v_job; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.control_batch_video(p_user_id uuid,p_batch_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_batch public.batch_jobs%ROWTYPE; v_job public.video_jobs%ROWTYPE; v_snapshot jsonb;
BEGIN
  PERFORM 1 FROM public.user_plans WHERE user_id=p_user_id FOR UPDATE;
  SELECT * INTO v_batch FROM public.batch_jobs WHERE id=p_batch_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_batch.request_key IS NULL THEN RAISE EXCEPTION '批次不存在或旧批次不能操作'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('pause','resume','cancel') THEN RAISE EXCEPTION '非法批次操作'; END IF;
  v_snapshot := public.batch_video_snapshot(p_user_id,p_batch_id);
  IF v_snapshot->>'status' IN ('completed','partial','failed','cancelled') THEN RETURN v_snapshot; END IF;
  IF p_action IN ('pause','resume') THEN
    IF v_batch.cancellation_requested THEN RAISE EXCEPTION '已取消批次不能恢复'; END IF;
    UPDATE public.batch_jobs SET status=CASE WHEN p_action='pause' THEN 'paused' ELSE 'processing' END,updated_at=now()
      WHERE id=p_batch_id;
  ELSE
    UPDATE public.batch_jobs SET status='cancelled',cancellation_requested=true,updated_at=now() WHERE id=p_batch_id;
    FOR v_job IN SELECT v.* FROM public.video_jobs v JOIN public.batch_job_items i ON i.video_job_id=v.id
      WHERE i.batch_id=p_batch_id AND v.status IN ('pending','processing') AND v.submission_state='queued'
      AND v.provider_task_id IS NULL AND v.resolution_event IS NULL
      ORDER BY v.id FOR UPDATE OF v
    LOOP
      PERFORM public.refund_credit_charge(p_user_id,v_job.charge_id,'用户取消尚未提交的批量任务');
      UPDATE public.video_jobs SET status='cancelled',billing_state='refunded',lease_token=NULL,lease_until=NULL,
        completed_at=now(),error_message='用户取消，尚未向模型提交' WHERE id=v_job.id;
      UPDATE public.video_projects SET status='failed',progress=0,error_message='用户取消，尚未向模型提交' WHERE id=v_job.project_id;
    END LOOP;
  END IF;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(p_user_id,'batch_'||p_action,'batch_jobs',p_batch_id,'{}');
  RETURN public.batch_video_snapshot(p_user_id,p_batch_id);
END;
$$;
REVOKE ALL ON FUNCTION public.batch_video_snapshot(uuid,uuid),
  public.create_batch_video_jobs(uuid,uuid,text,text,jsonb,jsonb,uuid,integer,integer),
  public.control_batch_video(uuid,uuid,text),public.claim_video_job(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.batch_video_snapshot(uuid,uuid),
  public.create_batch_video_jobs(uuid,uuid,text,text,jsonb,jsonb,uuid,integer,integer),
  public.control_batch_video(uuid,uuid,text),public.claim_video_job(uuid) TO service_role;
COMMIT;
