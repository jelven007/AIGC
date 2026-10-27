-- 原脚本请求/结果持久回执与实际模型尝试。资金仍由原积分事务负责。
-- 现有编辑器写入这些业务字段；历史迁移未包含，新增兼容列并保留旧数据。
ALTER TABLE public.scripts
  ADD COLUMN title text NOT NULL DEFAULT '',
  ADD COLUMN pain_points text[] NOT NULL DEFAULT '{}',
  ADD COLUMN full_content text NOT NULL DEFAULT '';
UPDATE public.scripts SET title=product_name||' 四层脚本' WHERE title='';

CREATE TABLE public.ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  request_body jsonb NOT NULL,
  status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','result_ready','completed','invalid','unknown')),
  charge_id uuid REFERENCES public.credit_logs(id),
  credits_cost integer NOT NULL DEFAULT 0,
  raw_content text,
  raw_sha256 text,
  result jsonb,
  script_id uuid NOT NULL DEFAULT gen_random_uuid(),
  error_msg text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_key)
);
ALTER TABLE public.ai_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ai_requests TO authenticated;
GRANT ALL ON public.ai_requests TO service_role;
CREATE POLICY ai_requests_read ON public.ai_requests FOR SELECT TO authenticated USING(user_id=auth.uid());

CREATE FUNCTION public.begin_script_request(p_user uuid,p_key uuid,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.ai_requests%ROWTYPE; v_cost integer; v_charge jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
  IF p_user IS NULL OR p_key IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object'
     OR length(p_body::text)>60000 OR NULLIF(btrim(p_body->>'product_name'),'') IS NULL
     THEN RAISE EXCEPTION '脚本请求参数不正确'; END IF;
  -- 同账号所有原请求串行到资金入口；与现有user/team预算使用相同事务。
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,63001));
  SELECT * INTO v_row FROM ai_requests WHERE user_id=p_user AND request_key=p_key FOR UPDATE;
  IF FOUND THEN
    IF v_row.request_body IS DISTINCT FROM p_body THEN RAISE EXCEPTION '原请求内容冲突'; END IF;
    RETURN to_jsonb(v_row)||jsonb_build_object('created',false);
  END IF;
  IF p_body->>'product_id' IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM products WHERE id=(p_body->>'product_id')::uuid AND user_id=p_user)
    THEN RAISE EXCEPTION '商品不存在或无权访问' USING ERRCODE='42501'; END IF;
  SELECT cost INTO v_cost FROM credit_costs WHERE action='generate_script_four_layer';
  IF v_cost IS NULL OR v_cost<0 THEN RAISE EXCEPTION '脚本计费配置不可用'; END IF;
  IF v_cost>0 THEN v_charge:=deduct_credits(p_user,v_cost,'generate_script_four_layer'); END IF;
  INSERT INTO ai_requests(user_id,request_key,request_body,charge_id,credits_cost)
    VALUES(p_user,p_key,p_body,(v_charge->>'charge_id')::uuid,v_cost) RETURNING * INTO v_row;
  RETURN to_jsonb(v_row)||jsonb_build_object('created',true);
END $$;

CREATE FUNCTION public.read_script_request(p_user uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.ai_requests%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM ai_requests WHERE id=p_id AND user_id=p_user;
  IF NOT FOUND THEN RAISE EXCEPTION '原请求不存在或无权访问' USING ERRCODE='42501'; END IF;
  RETURN to_jsonb(v_row);
END $$;

CREATE FUNCTION public.checkpoint_script_result(p_user uuid,p_id uuid,p_content text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.ai_requests%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM ai_requests WHERE id=p_id AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '原请求不存在或无权访问' USING ERRCODE='42501'; END IF;
  IF p_content IS NULL OR length(p_content)>100000 THEN RAISE EXCEPTION '模型结果过大'; END IF;
  IF v_row.raw_content IS NOT NULL THEN
    IF v_row.raw_content IS DISTINCT FROM p_content OR v_row.result IS DISTINCT FROM p_result THEN
      RAISE EXCEPTION '原模型结果不可覆盖';
    END IF;
    RETURN to_jsonb(v_row);
  END IF;
  IF v_row.status<>'started' THEN RAISE EXCEPTION '原请求状态不允许写入结果'; END IF;
  IF p_result IS NULL AND v_row.charge_id IS NOT NULL THEN
    PERFORM refund_credit_charge(p_user,v_row.charge_id,'模型脚本结构无效，原结果已核对');
  END IF;
  UPDATE ai_requests SET raw_content=p_content,raw_sha256=encode(sha256(convert_to(p_content,'UTF8')),'hex'),
    result=p_result,status=CASE WHEN p_result IS NULL THEN 'invalid' ELSE 'result_ready' END,updated_at=now()
    WHERE id=p_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

CREATE FUNCTION public.save_script_request(p_user uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.ai_requests%ROWTYPE; v_scene jsonb; v_index integer:=0; v_field text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM ai_requests WHERE id=p_id AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '原请求不存在或无权访问' USING ERRCODE='42501'; END IF;
  IF v_row.status='completed' THEN RETURN to_jsonb(v_row); END IF;
  IF v_row.status<>'result_ready' THEN RAISE EXCEPTION '原模型结果尚不可保存'; END IF;
  IF jsonb_typeof(v_row.result->'scenes') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_row.result->'scenes') NOT BETWEEN 1 AND 50
    OR NULLIF(btrim(v_row.result->>'prompt_text'),'') IS NULL
    OR length(v_row.result->>'prompt_text')>12000 THEN RAISE EXCEPTION '脚本结果结构不正确'; END IF;
  FOR v_scene IN SELECT value FROM jsonb_array_elements(v_row.result->'scenes') LOOP
    v_index:=v_index+1;
    IF jsonb_typeof(v_scene->'order') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_scene->'duration') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_scene->'layer') IS DISTINCT FROM 'string'
      OR (v_scene->>'order')::numeric IS DISTINCT FROM v_index
      OR (v_scene->>'duration')::numeric NOT BETWEEN 1 AND 120
      OR trunc((v_scene->>'duration')::numeric) IS DISTINCT FROM (v_scene->>'duration')::numeric
      OR v_scene->>'layer' NOT IN ('selling_point','pain_point','hook','cta') THEN RAISE EXCEPTION '脚本场景不正确'; END IF;
    FOREACH v_field IN ARRAY ARRAY['scene','visual','dialogue','prompt'] LOOP
      IF jsonb_typeof(v_scene->v_field) IS DISTINCT FROM 'string'
        OR NULLIF(btrim(v_scene->>v_field),'') IS NULL OR length(v_scene->>v_field)>8000
        THEN RAISE EXCEPTION '脚本文本不正确'; END IF;
    END LOOP;
  END LOOP;
  INSERT INTO scripts(id,user_id,product_id,product_name,selling_points,target_audience,platform,
                      scenes,prompt_text,status,title,pain_points,full_content)
    VALUES(v_row.script_id,p_user,(v_row.request_body->>'product_id')::uuid,v_row.request_body->>'product_name',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_row.request_body->'selling_points','[]'))),
      COALESCE(v_row.request_body->>'audience',''),
      CASE WHEN v_row.request_body->>'platform'='tiktok' THEN 'tiktok' ELSE 'douyin' END,
      v_row.result->'scenes',v_row.result->>'prompt_text','draft',v_row.request_body->>'product_name'||' 四层脚本',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_row.request_body->'pain_points','[]'))),v_row.raw_content);
  UPDATE ai_requests SET status='completed',updated_at=now() WHERE id=p_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

CREATE TABLE public.model_attempts (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid NOT NULL,
  action text NOT NULL,
  slot text NOT NULL,
  config_version_id uuid NOT NULL REFERENCES model_config_versions(id),
  model text NOT NULL,
  status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','success','error','unknown','interrupted')),
  context_versions jsonb NOT NULL DEFAULT '{}',
  upstream_id text,
  prompt_tokens bigint CHECK(prompt_tokens>=0),
  completion_tokens bigint CHECK(completion_tokens>=0),
  total_tokens bigint CHECK(total_tokens>=0),
  usage jsonb,
  -- 实际现金成本由供应商对账提供；缺失保持NULL，不能用积分伪造现金成本。
  cash_cost numeric CHECK(cash_cost>=0),
  currency text,
  latency_ms integer CHECK(latency_ms>=0),
  error_msg text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX model_attempts_request ON model_attempts(request_id,created_at);
CREATE INDEX model_attempts_pending ON model_attempts(created_at) WHERE status='started';
ALTER TABLE public.model_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.model_attempts TO authenticated;
GRANT ALL ON public.model_attempts TO service_role;
CREATE POLICY model_attempts_read ON public.model_attempts FOR SELECT TO authenticated USING(user_id=auth.uid());

CREATE FUNCTION public.begin_model_attempt(p_user uuid,p_request uuid,p_action text,p_slot text,
  p_version uuid,p_model text,p_attempt uuid,p_context jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
  INSERT INTO model_attempts(id,user_id,request_id,action,slot,config_version_id,model,context_versions)
    VALUES(p_attempt,p_user,p_request,p_action,p_slot,p_version,p_model,COALESCE(p_context,'{}'))
    ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM model_attempts WHERE id=p_attempt AND request_id=p_request
      AND user_id IS NOT DISTINCT FROM p_user AND config_version_id=p_version AND slot=p_slot AND action=p_action)
    THEN RAISE EXCEPTION '原模型尝试内容冲突'; END IF;
  RETURN p_attempt;
END $$;

CREATE FUNCTION public.finish_model_attempt(p_attempt uuid,p_status text,p_latency integer,
  p_upstream text,p_usage jsonb,p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
  IF p_status NOT IN ('success','error','unknown','interrupted') OR p_latency<0 THEN RAISE EXCEPTION '尝试结果不正确'; END IF;
  UPDATE model_attempts SET status=p_status,latency_ms=p_latency,upstream_id=left(p_upstream,200),
    usage=p_usage,prompt_tokens=(p_usage->>'prompt_tokens')::bigint,
    completion_tokens=(p_usage->>'completion_tokens')::bigint,total_tokens=(p_usage->>'total_tokens')::bigint,
    error_msg=left(p_error,300),completed_at=now()
    WHERE id=p_attempt AND status='started';
  IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM model_attempts WHERE id=p_attempt AND status=p_status)
    THEN RAISE EXCEPTION '模型尝试不存在或已结案'; END IF;
  RETURN true;
END $$;

ALTER TABLE public.risk_events ADD COLUMN request_id uuid, ADD COLUMN image_sha256 text
  CHECK(image_sha256 IS NULL OR image_sha256 ~ '^[0-9a-f]{64}$');

CREATE FUNCTION public.reject_script_request(p_user uuid,p_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.ai_requests%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM ai_requests WHERE id=p_id AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '原请求不存在或无权访问' USING ERRCODE='42501'; END IF;
  IF v_row.status='invalid' THEN RETURN to_jsonb(v_row); END IF;
  IF v_row.status NOT IN ('started','unknown') OR EXISTS(
    SELECT 1 FROM model_attempts WHERE request_id=p_id AND status<>'error') THEN
    RAISE EXCEPTION '模型受理未知或已有结果，不允许按拒绝补偿';
  END IF;
  IF v_row.charge_id IS NOT NULL THEN PERFORM refund_credit_charge(p_user,v_row.charge_id,p_reason); END IF;
  UPDATE ai_requests SET status='invalid',error_msg=left(p_reason,300),updated_at=now()
    WHERE id=p_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;

REVOKE ALL ON FUNCTION public.begin_script_request(uuid,uuid,jsonb),
  public.read_script_request(uuid,uuid),public.reject_script_request(uuid,uuid,text),public.checkpoint_script_result(uuid,uuid,text,jsonb),
  public.save_script_request(uuid,uuid),public.begin_model_attempt(uuid,uuid,text,text,uuid,text,uuid,jsonb),
  public.finish_model_attempt(uuid,text,integer,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_script_request(uuid,uuid,jsonb),
  public.read_script_request(uuid,uuid),public.reject_script_request(uuid,uuid,text),public.checkpoint_script_result(uuid,uuid,text,jsonb),
  public.save_script_request(uuid,uuid),public.begin_model_attempt(uuid,uuid,text,text,uuid,text,uuid,jsonb),
  public.finish_model_attempt(uuid,text,integer,text,jsonb,text) TO service_role;
