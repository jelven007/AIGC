BEGIN;
ALTER TABLE production_jobs DROP CONSTRAINT production_jobs_kind_check;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_kind_check
  CHECK(kind IN ('image','render','publish','metrics','tts','asr','voice_clone','avatar','lipsync'));
INSERT INTO credit_costs(action,cost,description) VALUES
  ('generate_tts',2,'后台配音（每请求最多8000字）'),
  ('generate_asr',2,'后台语音识别（每请求最多20MB）'),
  ('generate_voice_clone',10,'ElevenLabs即时声纹克隆'),
  ('generate_avatar',10,'照片口播（使用已有音频）'),
  ('generate_lipsync',10,'视频口型同步（使用已有音频）')
ON CONFLICT(action) DO NOTHING;
CREATE TABLE voice_clones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  job_id uuid NOT NULL UNIQUE REFERENCES production_jobs(id),
  name text NOT NULL,
  provider_voice_id text NOT NULL,
  model_config_version_id uuid NOT NULL REFERENCES model_config_versions(id),
  requires_verification boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE voice_clones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON voice_clones FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,user_id,job_id,name,requires_verification,created_at) ON voice_clones TO authenticated;
GRANT ALL ON voice_clones TO service_role;
CREATE POLICY voice_clones_own ON voice_clones FOR SELECT TO authenticated USING(user_id=auth.uid());

CREATE OR REPLACE FUNCTION save_model_config(
  p_slot text,p_expected_version uuid,p_settings jsonb,p_enabled boolean,
  p_key_ciphertext text,p_actor uuid,p_replace_key boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_current uuid; v_cipher text; v_new uuid;
BEGIN
  IF p_slot IS NULL OR p_slot NOT IN ('text.primary','text.fallback','image.primary','audio.tts','audio.asr',
    'audio.voice_clone','avatar.photo','avatar.lipsync','reader.primary','video.ArkSeedance','video.MiniMax',
    'video.SeedanceMini','video.Wan3','video.HappyHorse','video.Kling','video.Seedance') THEN
    RAISE EXCEPTION '不支持的模型配置项';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND raw_app_meta_data->>'role'='admin') THEN
    RAISE EXCEPTION '仅平台管理员可修改模型配置';
  END IF;
  INSERT INTO model_configs(slot) VALUES(p_slot) ON CONFLICT DO NOTHING;
  SELECT current_version_id INTO v_current FROM model_configs WHERE slot=p_slot FOR UPDATE;
  IF v_current IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION '配置已被更新，请刷新后重试'; END IF;
  IF p_replace_key THEN v_cipher:=p_key_ciphertext;
  ELSE SELECT key_ciphertext INTO v_cipher FROM model_config_versions WHERE id=v_current; END IF;
  IF p_enabled AND p_slot<>'reader.primary' AND COALESCE(v_cipher,'')='' THEN RAISE EXCEPTION '启用前请填写 API Key'; END IF;
  INSERT INTO model_config_versions(slot,settings,key_ciphertext,created_by)
    VALUES(p_slot,p_settings,v_cipher,p_actor) RETURNING id INTO v_new;
  UPDATE model_configs SET current_version_id=v_new,enabled=p_enabled,updated_at=now() WHERE slot=p_slot;
  DELETE FROM llm_cache;
  INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(p_actor,'save_model_config','model_configs',v_new,jsonb_build_object('slot',p_slot,'enabled',p_enabled,'version_id',v_new));
  RETURN v_new;
END;
$$;
ALTER FUNCTION create_production_job(uuid,uuid,text,jsonb,uuid,uuid) RENAME TO create_production_job_before_audio;
REVOKE ALL ON FUNCTION create_production_job_before_audio(uuid,uuid,text,jsonb,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION create_production_job(
  p_user_id uuid,p_request_key uuid,p_kind text,p_payload jsonb,p_project_id uuid DEFAULT NULL,p_version uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_slot text; v_current uuid; v_enabled boolean;
  v_clone voice_clones%ROWTYPE; v_cost int; v_charge jsonb; v_project uuid:=p_project_id;
BEGIN
  IF p_kind NOT IN ('tts','asr','voice_clone','avatar','lipsync') THEN
    RETURN create_production_job_before_audio(p_user_id,p_request_key,p_kind,p_payload,p_project_id,p_version);
  END IF;
  IF p_request_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '任务参数非法'; END IF;
  PERFORM 1 FROM user_plans WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
  SELECT * INTO v_job FROM production_jobs WHERE user_id=p_user_id AND request_key=p_request_key;
  IF FOUND THEN
    IF v_job.kind IS DISTINCT FROM p_kind OR v_job.payload IS DISTINCT FROM p_payload
      OR (p_project_id IS NOT NULL AND v_job.project_id IS DISTINCT FROM p_project_id) THEN
      RAISE EXCEPTION '同一请求标识不能用于不同任务';
    END IF;
    RETURN to_jsonb(v_job);
  END IF;
  IF (SELECT count(*) FROM production_jobs WHERE user_id=p_user_id
    AND kind IN ('tts','asr','voice_clone','avatar','lipsync') AND status IN ('pending','running','unknown'))>=10 THEN
    RAISE EXCEPTION '当前语音与数字人队列已满，请等待已有任务完成';
  END IF;
  v_slot:=CASE p_kind WHEN 'tts' THEN 'audio.tts' WHEN 'asr' THEN 'audio.asr'
    WHEN 'voice_clone' THEN 'audio.voice_clone' WHEN 'avatar' THEN 'avatar.photo' ELSE 'avatar.lipsync' END;
  IF p_kind='tts' AND p_payload->>'voice_clone_id' IS NOT NULL THEN
    SELECT * INTO v_clone FROM voice_clones WHERE id=(p_payload->>'voice_clone_id')::uuid AND user_id=p_user_id;
    IF NOT FOUND OR v_clone.requires_verification OR v_clone.model_config_version_id IS DISTINCT FROM p_version THEN
      RAISE EXCEPTION '声纹不存在、未验证或配置版本不匹配';
    END IF;
    v_slot:='audio.voice_clone';
  END IF;
  SELECT enabled,current_version_id INTO v_enabled,v_current FROM model_configs WHERE slot=v_slot FOR SHARE;
  IF NOT FOUND OR NOT v_enabled OR p_version IS NULL
    OR (v_clone.id IS NULL AND p_version IS DISTINCT FROM v_current) THEN RAISE EXCEPTION '模型配置已更新或未启用'; END IF;
  IF NOT EXISTS(SELECT 1 FROM model_config_versions WHERE id=p_version AND slot=v_slot) THEN RAISE EXCEPTION '模型版本不匹配'; END IF;
  IF p_kind='voice_clone' AND p_payload->>'consent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '需确认样本声音授权'; END IF;
  IF p_kind='tts' AND (length(trim(COALESCE(p_payload->>'input','')))<1 OR length(p_payload->>'input')>8000) THEN
    RAISE EXCEPTION '配音文本应为1–8000字';
  END IF;
  IF p_kind IN ('avatar','lipsync') THEN
    IF v_project IS NULL THEN
      INSERT INTO video_projects(user_id,title,status,duration)
        VALUES(p_user_id,left(COALESCE(NULLIF(p_payload->>'title',''),'数字人口播'),100),'draft',0) RETURNING id INTO v_project;
    ELSIF NOT EXISTS(SELECT 1 FROM video_projects WHERE id=v_project AND user_id=p_user_id) THEN
      RAISE EXCEPTION '作品不存在或无权访问';
    END IF;
    PERFORM 1 FROM video_projects WHERE id=v_project FOR UPDATE;
    IF EXISTS(SELECT 1 FROM production_jobs WHERE project_id=v_project AND status IN ('pending','running','unknown')) THEN
      RAISE EXCEPTION '此工程已有生产任务';
    END IF;
  ELSIF v_project IS NOT NULL THEN RAISE EXCEPTION '语音任务不关联视频工程';
  END IF;
  SELECT cost INTO v_cost FROM credit_costs WHERE action='generate_'||p_kind;
  IF NOT FOUND OR v_cost IS NULL OR v_cost<0 THEN RAISE EXCEPTION '任务计费配置缺失'; END IF;
  IF p_payload->>'confirmed_credit_cost' IS NOT NULL AND (p_payload->>'confirmed_credit_cost')::int<>v_cost THEN
    RAISE EXCEPTION '计费价格已更新，请刷新确认后提交';
  END IF;
  IF v_cost>0 THEN v_charge:=deduct_credits(p_user_id,v_cost,'generate_'||p_kind); END IF;
  INSERT INTO production_jobs(user_id,request_key,kind,payload,project_id,model_config_version_id,charge_id,credit_cost)
    VALUES(p_user_id,p_request_key,p_kind,p_payload,v_project,p_version,(v_charge->>'charge_id')::uuid,v_cost) RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;
CREATE OR REPLACE FUNCTION claim_production_job(p_kind text,p_job_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM production_jobs WHERE kind=p_kind AND status IN ('pending','running')
    AND (p_job_id IS NULL OR id=p_job_id) AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now())
    ORDER BY next_run_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_job.kind IN ('image','publish','tts','asr','voice_clone','avatar','lipsync')
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
ALTER FUNCTION update_production_job(uuid,uuid,text,jsonb) RENAME TO update_production_job_before_audio;
REVOKE ALL ON FUNCTION update_production_job_before_audio(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION update_production_job(p_job_id uuid,p_lease uuid,p_event text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_result jsonb; v_clone uuid; v_uid uuid;
BEGIN
  SELECT user_id INTO STRICT v_uid FROM production_jobs WHERE id=p_job_id;
  PERFORM 1 FROM user_plans WHERE user_id=v_uid FOR UPDATE;
  PERFORM 1 FROM video_projects WHERE id=(SELECT project_id FROM production_jobs WHERE id=p_job_id) FOR UPDATE;
  SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.kind NOT IN ('tts','asr','voice_clone','avatar','lipsync') THEN
    RETURN update_production_job_before_audio(p_job_id,p_lease,p_event,p_data);
  END IF;
  IF v_job.status IN ('completed','failed') AND v_job.final_lease_token=p_lease THEN RETURN to_jsonb(v_job); END IF;
  IF v_job.status<>'running' OR p_lease IS NULL OR v_job.lease_token IS DISTINCT FROM p_lease THEN RAISE EXCEPTION '任务租约已失效'; END IF;
  IF p_event='retry' AND v_job.phase='executing' AND v_job.resolution IS NULL THEN RAISE EXCEPTION '不得重发结果未知请求'; END IF;
  IF p_event='completed' THEN
    IF v_job.kind='asr' AND (jsonb_typeof(p_data->'text') IS DISTINCT FROM 'string'
      OR length(trim(p_data->>'text'))<1 OR length(p_data->>'text')>100000) THEN RAISE EXCEPTION '缺少真实识别文本'; END IF;
    IF v_job.kind IN ('tts','avatar','lipsync') AND COALESCE(p_data->>'url','') !~ '/storage/v1/object/authenticated/materials/' THEN
      RAISE EXCEPTION '缺少私有归档媒体';
    END IF;
    IF v_job.kind='voice_clone' THEN
      IF COALESCE(p_data->>'voice_id','')='' OR jsonb_typeof(p_data->'requires_verification') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION '缺少声纹供应商结果';
      END IF;
      INSERT INTO voice_clones(user_id,job_id,name,provider_voice_id,model_config_version_id,requires_verification)
        VALUES(v_uid,v_job.id,v_job.payload->>'name',p_data->>'voice_id',v_job.model_config_version_id,
          (p_data->>'requires_verification')::boolean) RETURNING id INTO v_clone;
      p_data:=(p_data-'voice_id')||jsonb_build_object('voice_clone_id',v_clone);
    END IF;
  END IF;
  v_result:=update_production_job_before_audio(p_job_id,p_lease,p_event,p_data);
  IF p_event='completed' AND v_job.kind='tts' THEN
    INSERT INTO materials(user_id,name,type,url,size,tags) VALUES(v_uid,left(v_job.payload->>'input',80),
      'audio',p_data->>'url',(p_data->>'size')::bigint,ARRAY['AI配音']);
  ELSIF p_event='completed' AND v_job.kind IN ('avatar','lipsync') THEN
    INSERT INTO materials(user_id,name,type,url,size,duration_sec,tags) VALUES(v_uid,v_job.payload->>'title',
      'video',p_data->>'url',(p_data->>'size')::bigint,(p_data->>'duration')::numeric,ARRAY['数字人']);
    UPDATE video_projects SET status='completed',progress=100,video_url=p_data->>'url',
      duration=CASE WHEN p_data->>'duration' IS NULL THEN NULL ELSE ceil((p_data->>'duration')::numeric) END
      WHERE id=v_job.project_id;
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION create_production_job(uuid,uuid,text,jsonb,uuid,uuid),update_production_job(uuid,uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION create_production_job(uuid,uuid,text,jsonb,uuid,uuid),update_production_job(uuid,uuid,text,jsonb)
  TO service_role;
CREATE OR REPLACE FUNCTION guard_production_project() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF auth.role()='service_role' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM production_jobs WHERE project_id=OLD.id AND status IN ('pending','running','unknown')) THEN
      RAISE EXCEPTION '生产任务仍在处理，暂不能删除工程';
    END IF;
    RETURN OLD;
  END IF;
  IF EXISTS(SELECT 1 FROM production_jobs WHERE project_id=OLD.id AND kind IN ('render','avatar','lipsync'))
    AND (NEW.video_url IS DISTINCT FROM OLD.video_url OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.progress IS DISTINCT FROM OLD.progress) THEN RAISE EXCEPTION '成片状态由服务端维护'; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION reconcile_production_job(p_job uuid,p_evidence jsonb,p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_uid uuid; v_valid boolean;
BEGIN
  IF length(trim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION '需提供上游核对证据说明'; END IF;
  SELECT user_id INTO STRICT v_uid FROM production_jobs WHERE id=p_job;
  PERFORM 1 FROM user_plans WHERE user_id=v_uid FOR UPDATE;
  PERFORM 1 FROM video_projects WHERE id=(SELECT project_id FROM production_jobs WHERE id=p_job) FOR UPDATE;
  SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job FOR UPDATE;
  IF v_job.status<>'unknown' THEN RAISE EXCEPTION '只核对结果未知任务'; END IF;
  IF p_evidence IS NULL THEN
    UPDATE production_jobs SET resolution=jsonb_build_object('event','failed','data',jsonb_build_object('error',p_note)),
      status='pending',phase='accepted',next_run_at=now() WHERE id=p_job;
  ELSE
    v_valid:=CASE v_job.kind
      WHEN 'image' THEN COALESCE(p_evidence->'data'->0->>'url',p_evidence->'data'->0->>'b64_json') IS NOT NULL
      WHEN 'publish' THEN COALESCE(p_evidence->>'publish_id',p_evidence->>'item_id') IS NOT NULL
      WHEN 'tts' THEN length(p_evidence->>'audio_b64') BETWEEN 1 AND 7000000 AND p_evidence->>'type' IN ('audio/mpeg','audio/wav','audio/ogg')
      WHEN 'asr' THEN length(trim(p_evidence->>'text')) BETWEEN 1 AND 100000
      WHEN 'voice_clone' THEN length(p_evidence->>'voice_id')>0 AND jsonb_typeof(p_evidence->'requires_verification')='boolean'
      WHEN 'avatar' THEN length(p_evidence->>'provider_task_id') BETWEEN 1 AND 200
      WHEN 'lipsync' THEN length(p_evidence->>'provider_task_id') BETWEEN 1 AND 200 ELSE false END;
    IF NOT COALESCE(v_valid,false) THEN RAISE EXCEPTION '核对结果缺少原生成对象或供应商任务标识'; END IF;
    UPDATE production_jobs SET evidence=p_evidence,status='pending',phase='accepted',attempts=0,next_run_at=now() WHERE id=p_job;
  END IF;
  INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(v_uid,'reconcile_production_job','production_jobs',p_job,jsonb_build_object('note',p_note,'confirmed_rejected',p_evidence IS NULL));
END;
$$;
COMMIT;
