-- 火山方舟视频纳入原子任务创建，旧任务和扣费语义保持兼容。
BEGIN;
CREATE OR REPLACE FUNCTION public.create_video_job(
  p_user_id uuid, p_request_key uuid, p_provider text, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job public.video_jobs%ROWTYPE;
  v_charge jsonb;
  v_cost integer;
  v_project_id uuid;
BEGIN
  IF p_request_key IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR p_provider IS NULL OR p_provider NOT IN ('ArkSeedance','MiniMax','SeedanceMini','Wan3','HappyHorse','Kling','Seedance')
    OR length(trim(COALESCE(p_payload->>'prompt',''))) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION '视频任务参数非法';
  END IF;
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
REVOKE ALL ON FUNCTION public.create_video_job(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_video_job(uuid,uuid,text,jsonb) TO service_role;
COMMIT;
