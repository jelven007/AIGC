BEGIN;
ALTER TABLE production_jobs DROP CONSTRAINT production_jobs_kind_check;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_kind_check
  CHECK(kind IN ('image','render','publish','metrics','tts','asr','voice_clone','avatar','lipsync','analysis'));
INSERT INTO credit_costs(action,cost,description) VALUES
  ('generate_analysis',6,'真实视频分析（最多10分钟/100MB，抽帧、转录与模型分析）')
ON CONFLICT(action) DO NOTHING;

ALTER FUNCTION create_production_job(uuid,uuid,text,jsonb,uuid,uuid) RENAME TO create_production_job_before_analysis;
REVOKE ALL ON FUNCTION create_production_job_before_analysis(uuid,uuid,text,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION create_production_job(
  p_user_id uuid,p_request_key uuid,p_kind text,p_payload jsonb,p_project_id uuid DEFAULT NULL,p_version uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_cost int; v_charge jsonb; v_asr uuid;
BEGIN
  IF p_kind<>'analysis' THEN
    RETURN create_production_job_before_analysis(p_user_id,p_request_key,p_kind,p_payload,p_project_id,p_version);
  END IF;
  IF p_request_key IS NULL OR p_project_id IS NOT NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR p_payload->>'mode' IS NULL OR p_payload->>'mode' NOT IN ('live','style') OR length(trim(COALESCE(p_payload->>'title','')))<1 THEN
    RAISE EXCEPTION '分析任务参数非法';
  END IF;
  PERFORM 1 FROM user_plans WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
  SELECT * INTO v_job FROM production_jobs WHERE user_id=p_user_id AND request_key=p_request_key;
  IF FOUND THEN
    IF v_job.kind IS DISTINCT FROM p_kind OR (v_job.payload-'asr_version') IS DISTINCT FROM (p_payload-'asr_version') THEN
      RAISE EXCEPTION '同一请求标识不能用于不同任务';
    END IF;
    RETURN to_jsonb(v_job);
  END IF;
  IF (SELECT count(*) FROM production_jobs WHERE user_id=p_user_id AND kind='analysis'
    AND status IN ('pending','running','unknown'))>=3 THEN RAISE EXCEPTION '视频分析队列已满'; END IF;
  PERFORM 1 FROM model_configs WHERE slot='text.primary' AND enabled AND current_version_id=p_version FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '文本模型配置已更新或未启用'; END IF;
  v_asr:=(p_payload->>'asr_version')::uuid;
  PERFORM 1 FROM model_configs WHERE slot='audio.asr' AND enabled AND current_version_id=v_asr FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '语音模型配置已更新或未启用'; END IF;
  SELECT cost INTO v_cost FROM credit_costs WHERE action='generate_analysis';
  IF NOT FOUND OR v_cost IS NULL OR v_cost<0 THEN RAISE EXCEPTION '分析计费配置缺失'; END IF;
  IF p_payload->>'confirmed_credit_cost' IS NULL OR (p_payload->>'confirmed_credit_cost')::int<>v_cost THEN
    RAISE EXCEPTION '计费价格已更新，请刷新确认后提交';
  END IF;
  IF v_cost>0 THEN v_charge:=deduct_credits(p_user_id,v_cost,'generate_analysis'); END IF;
  INSERT INTO production_jobs(user_id,request_key,kind,payload,model_config_version_id,charge_id,credit_cost)
    VALUES(p_user_id,p_request_key,p_kind,p_payload,p_version,(v_charge->>'charge_id')::uuid,v_cost) RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;

CREATE OR REPLACE FUNCTION claim_production_job(p_kind text,p_job_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM production_jobs
    WHERE kind=CASE WHEN p_kind='analysis_prepare' THEN 'analysis' ELSE p_kind END
    AND status IN ('pending','running') AND (p_job_id IS NULL OR id=p_job_id)
    AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now())
    AND (p_kind NOT IN ('analysis','analysis_prepare')
      OR p_kind='analysis_prepare' AND evidence IS NULL AND resolution IS NULL
      OR p_kind='analysis' AND (evidence IS NOT NULL OR resolution IS NOT NULL))
    ORDER BY next_run_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_job.kind IN ('image','publish','tts','asr','voice_clone','avatar','lipsync','analysis')
    AND v_job.phase='executing' AND v_job.resolution IS NULL THEN
    UPDATE production_jobs SET status='unknown',error_message='上游受理结果未知，禁止重复提交，需核对',
      lease_token=NULL,lease_until=NULL WHERE id=v_job.id;
    RETURN NULL;
  END IF;
  UPDATE production_jobs SET status='running',attempts=attempts+1,lease_token=gen_random_uuid(),
    lease_until=now()+interval '180 seconds',phase=CASE WHEN phase='ready' THEN 'claimed' ELSE phase END
    WHERE id=v_job.id RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;
ALTER FUNCTION update_production_job(uuid,uuid,text,jsonb) RENAME TO update_production_job_before_analysis;
REVOKE ALL ON FUNCTION update_production_job_before_analysis(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION update_production_job(p_job_id uuid,p_lease uuid,p_event text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_uid uuid; v_result jsonb;
BEGIN
  SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id;
  IF v_job.kind<>'analysis' THEN RETURN update_production_job_before_analysis(p_job_id,p_lease,p_event,p_data); END IF;
  v_uid:=v_job.user_id;
  PERFORM 1 FROM user_plans WHERE user_id=v_uid FOR UPDATE;
  SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.status IN ('completed','failed') AND v_job.final_lease_token=p_lease THEN RETURN to_jsonb(v_job); END IF;
  IF v_job.status<>'running' OR p_lease IS NULL OR v_job.lease_token IS DISTINCT FROM p_lease THEN RAISE EXCEPTION '任务租约已失效'; END IF;
  IF p_event='retry' AND v_job.phase='executing' AND v_job.resolution IS NULL THEN RAISE EXCEPTION '不得重发结果未知请求'; END IF;
  IF p_event='prepared' THEN
    IF v_job.evidence IS NOT NULL OR jsonb_typeof(p_data->'duration') IS DISTINCT FROM 'number'
      OR (p_data->>'duration')::numeric NOT BETWEEN 0.1 AND 600 OR COALESCE(p_data->>'source_hash','') !~ '^[a-f0-9]{64}$'
      OR jsonb_typeof(p_data->'frames') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'frames') NOT BETWEEN 1 AND 8
      OR jsonb_typeof(p_data->'has_audio') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION '缺少真实视频预处理证据'; END IF;
    UPDATE production_jobs SET evidence=p_data,phase='accepted',status='pending',lease_token=NULL,lease_until=NULL,
      next_run_at=now(),progress=25,attempts=0 WHERE id=p_job_id RETURNING * INTO v_job;
    RETURN to_jsonb(v_job);
  END IF;
  IF p_event='completed' THEN
    IF v_job.evidence IS NULL OR p_data->>'source_hash' IS NULL OR p_data->'duration' IS NULL
      OR p_data->>'source_url' IS DISTINCT FROM v_job.payload->>'source_url'
      OR p_data->>'mode' IS DISTINCT FROM v_job.payload->>'mode' OR p_data->>'source_hash' IS DISTINCT FROM v_job.evidence->>'source_hash'
      OR p_data->'duration' IS DISTINCT FROM v_job.evidence->'duration'
      OR p_data->'model_versions'->>'text' IS DISTINCT FROM v_job.model_config_version_id::text
      OR p_data->'model_versions'->>'asr' IS DISTINCT FROM v_job.payload->>'asr_version'
      OR (v_job.payload->>'mode'='live' AND (jsonb_typeof(p_data->'highlights') IS DISTINCT FROM 'array'
        OR jsonb_array_length(p_data->'highlights')<1))
      OR (v_job.payload->>'mode'='style' AND jsonb_typeof(p_data->'report') IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION '缺少可追溯分析结果';
    END IF;
  END IF;
  v_result:=update_production_job_before_analysis(p_job_id,p_lease,p_event,p_data);
  IF p_event='completed' AND v_job.payload->>'mode'='style' THEN
    INSERT INTO style_analyses(id,user_id,source_type,file_url,rhythm,transitions,subtitle_style,color_tone,pacing,report_data,status)
      VALUES(v_job.id,v_uid,'upload',v_job.payload->>'source_url',p_data->'report'->>'rhythm',
        ARRAY(SELECT jsonb_array_elements_text(p_data->'report'->'transitions')),p_data->'report'->>'subtitle_style',
        p_data->'report'->>'color_tone',p_data->'report'->>'pacing',p_data->'report','done');
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION create_production_job(uuid,uuid,text,jsonb,uuid,uuid),update_production_job(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION create_production_job(uuid,uuid,text,jsonb,uuid,uuid),update_production_job(uuid,uuid,text,jsonb) TO service_role;
COMMIT;
