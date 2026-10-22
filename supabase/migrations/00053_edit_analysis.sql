BEGIN;
ALTER TABLE production_jobs DROP CONSTRAINT production_jobs_kind_check;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_kind_check CHECK(kind IN
  ('image','render','publish','metrics','tts','asr','voice_clone','avatar','lipsync','analysis',
   'knowledge_index','knowledge_search','intelligence_competitor','intelligence_products','product_import',
   'product_translate','edit_analysis'));
INSERT INTO credit_costs(action,cost,description) VALUES
 ('generate_edit_beats',0,'实际裁剪音轨节拍检测，最多10分钟'),
 ('generate_edit_subtitles',3,'实际裁剪音轨Whisper时间分段字幕，最多10分钟')
ON CONFLICT(action) DO NOTHING;

ALTER FUNCTION create_production_job(uuid,uuid,text,jsonb,uuid,uuid) RENAME TO create_production_job_before_edit;
REVOKE ALL ON FUNCTION create_production_job_before_edit(uuid,uuid,text,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION create_production_job(p_user_id uuid,p_request_key uuid,p_kind text,p_payload jsonb,
 p_project_id uuid DEFAULT NULL,p_version uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_cost int; v_charge jsonb; v_source jsonb;
BEGIN
 IF p_kind<>'edit_analysis' THEN
   RETURN create_production_job_before_edit(p_user_id,p_request_key,p_kind,p_payload,p_project_id,p_version);
 END IF;
 v_source:=p_payload->'source';
 IF p_request_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
   OR COALESCE(p_payload->>'mode','') NOT IN ('beats','subtitles')
   OR length(trim(COALESCE(p_payload->>'title',''))) NOT BETWEEN 1 AND 80
   OR jsonb_typeof(v_source) IS DISTINCT FROM 'object' OR COALESCE(v_source->>'type','') NOT IN ('video','audio')
   OR length(COALESCE(v_source->>'id','')) NOT BETWEEN 1 AND 200
   OR COALESCE(v_source->>'url','') !~ '^https://'
   OR jsonb_typeof(v_source->'start') IS DISTINCT FROM 'number'
   OR jsonb_typeof(v_source->'duration') IS DISTINCT FROM 'number'
   OR jsonb_typeof(v_source->'sourceStart') IS DISTINCT FROM 'number'
   OR jsonb_typeof(v_source->'speed') IS DISTINCT FROM 'number'
   OR (v_source->>'start')::numeric NOT BETWEEN 0 AND 600
   OR (v_source->>'duration')::numeric NOT BETWEEN .1 AND 600
   OR (v_source->>'start')::numeric+(v_source->>'duration')::numeric>600
   OR (v_source->>'sourceStart')::numeric NOT BETWEEN 0 AND 36000
   OR (v_source->>'speed')::numeric NOT BETWEEN .25 AND 4 THEN RAISE EXCEPTION '剪辑分析参数非法'; END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
 SELECT * INTO v_job FROM production_jobs WHERE user_id=p_user_id AND request_key=p_request_key;
 IF FOUND THEN
   IF v_job.kind IS DISTINCT FROM p_kind OR v_job.payload IS DISTINCT FROM p_payload
     OR v_job.project_id IS DISTINCT FROM p_project_id THEN
     RAISE EXCEPTION '同一请求标识不能用于不同任务';
   END IF;
   RETURN to_jsonb(v_job);
 END IF;
 IF p_project_id IS NOT NULL THEN
   PERFORM 1 FROM video_projects WHERE id=p_project_id AND user_id=p_user_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION '剪辑工程不存在或无权访问'; END IF;
 END IF;
 IF (SELECT count(*) FROM production_jobs WHERE user_id=p_user_id AND kind='edit_analysis'
   AND status IN ('pending','running','unknown'))>=3 THEN RAISE EXCEPTION '剪辑分析队列已满'; END IF;
 IF p_payload->>'mode'='subtitles' THEN
   PERFORM 1 FROM model_configs WHERE slot='audio.asr' AND enabled AND current_version_id=p_version FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION '字幕模型配置已更新或未启用'; END IF;
 ELSE
   IF p_version IS NOT NULL THEN RAISE EXCEPTION '节拍检测不使用供应商模型'; END IF;
 END IF;
 SELECT cost INTO v_cost FROM credit_costs WHERE action='generate_edit_'||(p_payload->>'mode');
 IF v_cost IS NULL OR v_cost<0 THEN RAISE EXCEPTION '剪辑分析计费配置缺失'; END IF;
 IF jsonb_typeof(p_payload->'confirmed_credit_cost') IS DISTINCT FROM 'number'
   OR (p_payload->>'confirmed_credit_cost')::numeric<>v_cost THEN RAISE EXCEPTION '计费价格已更新，请重新确认'; END IF;
 IF v_cost>0 THEN v_charge:=deduct_credits(p_user_id,v_cost,'generate_edit_'||(p_payload->>'mode')); END IF;
 INSERT INTO production_jobs(user_id,request_key,kind,payload,project_id,model_config_version_id,charge_id,credit_cost)
 VALUES(p_user_id,p_request_key,p_kind,p_payload,p_project_id,p_version,(v_charge->>'charge_id')::uuid,v_cost) RETURNING * INTO v_job;
 RETURN to_jsonb(v_job);
END;
$$;

ALTER FUNCTION claim_production_job(text,uuid) RENAME TO claim_production_job_before_edit;
REVOKE ALL ON FUNCTION claim_production_job_before_edit(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION claim_production_job(p_kind text,p_job_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE;
BEGIN
 IF p_kind NOT IN ('edit_prepare','edit_analysis') THEN RETURN claim_production_job_before_edit(p_kind,p_job_id); END IF;
 SELECT * INTO v_job FROM production_jobs WHERE kind='edit_analysis' AND status IN ('pending','running')
   AND (p_job_id IS NULL OR id=p_job_id) AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now())
   AND (p_kind='edit_prepare' AND evidence IS NULL AND resolution IS NULL
     OR p_kind='edit_analysis' AND (evidence IS NOT NULL OR resolution IS NOT NULL))
   ORDER BY next_run_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v_job.phase='executing' AND v_job.resolution IS NULL THEN
   UPDATE production_jobs SET status='unknown',error_message='字幕模型受理结果未知，需核对原请求',
     lease_token=NULL,lease_until=NULL WHERE id=v_job.id;
   RETURN NULL;
 END IF;
 UPDATE production_jobs SET status='running',attempts=attempts+1,lease_token=gen_random_uuid(),
   lease_until=now()+interval '180 seconds',phase=CASE WHEN phase='ready' THEN 'claimed' ELSE phase END
   WHERE id=v_job.id RETURNING * INTO v_job;
 RETURN to_jsonb(v_job);
END;
$$;
ALTER FUNCTION update_production_job(uuid,uuid,text,jsonb) RENAME TO update_production_job_before_edit;
REVOKE ALL ON FUNCTION update_production_job_before_edit(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION update_production_job(p_job_id uuid,p_lease uuid,p_event text,p_data jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_segment jsonb; v_last numeric:=-1; v_beat jsonb;
BEGIN
 SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id;
 IF v_job.kind<>'edit_analysis' THEN RETURN update_production_job_before_edit(p_job_id,p_lease,p_event,p_data); END IF;
 PERFORM 1 FROM user_plans WHERE user_id=v_job.user_id FOR UPDATE;
 SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id FOR UPDATE;
 IF v_job.status IN ('completed','failed') AND v_job.final_lease_token=p_lease THEN RETURN to_jsonb(v_job); END IF;
 IF v_job.status<>'running' OR p_lease IS NULL OR v_job.lease_token IS DISTINCT FROM p_lease THEN
   RAISE EXCEPTION '任务租约已失效'; END IF;
 IF p_event='retry' AND v_job.phase='executing' AND v_job.resolution IS NULL THEN RAISE EXCEPTION '不得重发结果未知请求'; END IF;
 IF p_event IN ('prepared','completed') THEN
   IF jsonb_typeof(p_data->'duration') IS DISTINCT FROM 'number'
     OR abs((p_data->>'duration')::numeric-(v_job.payload->'source'->>'duration')::numeric)>.05
     OR COALESCE(p_data->>'source_hash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION '原音轨证据不正确'; END IF;
 END IF;
 IF p_event='prepared' THEN
   IF v_job.evidence IS NOT NULL OR v_job.payload->>'mode'<>'subtitles'
     OR COALESCE(p_data->>'audio_url','') !~ '/storage/v1/object/authenticated/materials/' THEN
     RAISE EXCEPTION '字幕预处理证据不正确'; END IF;
   UPDATE production_jobs SET evidence=p_data,phase='accepted',status='pending',lease_token=NULL,lease_until=NULL,
     next_run_at=now(),progress=30,attempts=0 WHERE id=p_job_id RETURNING * INTO v_job;
   RETURN to_jsonb(v_job);
 END IF;
 IF p_event='completed' THEN
   IF p_data->'source' IS DISTINCT FROM v_job.payload->'source' OR p_data->>'mode' IS DISTINCT FROM v_job.payload->>'mode' THEN
     RAISE EXCEPTION '结果与原剪辑参数不一致'; END IF;
   IF v_job.payload->>'mode'='subtitles' THEN
     IF v_job.evidence IS NULL OR p_data->>'source_hash' IS DISTINCT FROM v_job.evidence->>'source_hash'
       OR p_data->>'asr_version' IS DISTINCT FROM v_job.model_config_version_id::text
       OR jsonb_typeof(p_data->'segments') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_data->'segments') NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION '字幕结果缺少原模型和分段'; END IF;
     FOR v_segment IN SELECT * FROM jsonb_array_elements(p_data->'segments') LOOP
       IF jsonb_typeof(v_segment->'start') IS DISTINCT FROM 'number' OR jsonb_typeof(v_segment->'end') IS DISTINCT FROM 'number'
         OR jsonb_typeof(v_segment->'text') IS DISTINCT FROM 'string' OR length(trim(v_segment->>'text')) NOT BETWEEN 1 AND 2000
         OR (v_segment->>'start')::numeric<greatest(0,v_last)
         OR (v_segment->>'end')::numeric<=(v_segment->>'start')::numeric
         OR (v_segment->>'end')::numeric>(p_data->>'duration')::numeric THEN RAISE EXCEPTION '字幕时间戳非法或重叠'; END IF;
       v_last:=(v_segment->>'end')::numeric;
     END LOOP;
   ELSE
     IF p_data->>'algorithm' IS DISTINCT FROM 'spectral-flux-v1' OR jsonb_typeof(p_data->'beats') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_data->'beats')>3000 OR jsonb_typeof(p_data->'confidence') IS DISTINCT FROM 'number'
       OR (p_data->>'confidence')::numeric NOT BETWEEN 0 AND 1 OR NOT(p_data ? 'bpm')
       OR (p_data->'bpm'<>'null'::jsonb AND (jsonb_typeof(p_data->'bpm')<>'number'
         OR (p_data->>'bpm')::numeric NOT BETWEEN 40 AND 240 OR jsonb_array_length(p_data->'beats')<8)) THEN
       RAISE EXCEPTION '节拍结果不正确'; END IF;
     FOR v_beat IN SELECT * FROM jsonb_array_elements(p_data->'beats') LOOP
       IF jsonb_typeof(v_beat)<>'number' OR (v_beat#>>'{}')::numeric<=v_last OR (v_beat#>>'{}')::numeric<0
         OR (v_beat#>>'{}')::numeric>=(p_data->>'duration')::numeric THEN RAISE EXCEPTION '节拍位置非法'; END IF;
       v_last:=(v_beat#>>'{}')::numeric;
     END LOOP;
   END IF;
 END IF;
 RETURN update_production_job_before_edit(p_job_id,p_lease,p_event,p_data);
END;
$$;
REVOKE ALL ON FUNCTION create_production_job(uuid,uuid,text,jsonb,uuid,uuid),claim_production_job(text,uuid),
 update_production_job(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION create_production_job(uuid,uuid,text,jsonb,uuid,uuid),claim_production_job(text,uuid),
 update_production_job(uuid,uuid,text,jsonb) TO service_role;
COMMIT;
