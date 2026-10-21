BEGIN;
CREATE TABLE public.model_configs (
  slot text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  current_version_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.model_config_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot text NOT NULL REFERENCES public.model_configs(slot),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings)='object'),
  key_ciphertext text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(slot,id)
);
ALTER TABLE public.model_configs ADD CONSTRAINT model_current_version
  FOREIGN KEY(slot,current_version_id) REFERENCES public.model_config_versions(slot,id);
ALTER TABLE public.model_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_config_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_configs, public.model_config_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.model_configs TO service_role;
GRANT SELECT,INSERT ON public.model_config_versions TO service_role;
CREATE FUNCTION public.immutable_model_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '模型配置版本不可修改或删除'; END;
$$;
CREATE TRIGGER model_version_immutable BEFORE UPDATE OR DELETE ON public.model_config_versions
  FOR EACH ROW EXECUTE FUNCTION public.immutable_model_version();

CREATE FUNCTION public.save_model_config(
  p_slot text, p_expected_version uuid, p_settings jsonb, p_enabled boolean,
  p_key_ciphertext text, p_actor uuid, p_replace_key boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_current uuid; v_cipher text; v_new uuid;
BEGIN
  IF p_slot NOT IN ('text.primary','text.fallback','image.primary','audio.tts','audio.asr',
    'reader.primary','video.ArkSeedance','video.MiniMax','video.SeedanceMini','video.Wan3',
    'video.HappyHorse','video.Kling','video.Seedance') OR p_slot IS NULL THEN
    RAISE EXCEPTION '不支持的模型配置项';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_actor AND raw_app_meta_data->>'role'='admin') THEN
    RAISE EXCEPTION '仅平台管理员可修改模型配置';
  END IF;
  INSERT INTO public.model_configs(slot) VALUES (p_slot) ON CONFLICT DO NOTHING;
  SELECT current_version_id INTO v_current FROM public.model_configs WHERE slot=p_slot FOR UPDATE;
  IF v_current IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION '配置已被更新，请刷新后重试'; END IF;
  IF p_replace_key THEN v_cipher := p_key_ciphertext;
  ELSE SELECT key_ciphertext INTO v_cipher FROM public.model_config_versions WHERE id=v_current; END IF;
  IF p_enabled AND p_slot <> 'reader.primary' AND COALESCE(v_cipher,'')='' THEN
    RAISE EXCEPTION '启用前请填写 API Key';
  END IF;
  INSERT INTO public.model_config_versions(slot,settings,key_ciphertext,created_by)
    VALUES(p_slot,p_settings,v_cipher,p_actor) RETURNING id INTO v_new;
  UPDATE public.model_configs SET current_version_id=v_new,enabled=p_enabled,updated_at=now() WHERE slot=p_slot;
  -- 不把旧模型生成的缓存当作新模型的输出。
  DELETE FROM public.llm_cache;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(p_actor,'save_model_config','model_configs',v_new,
      jsonb_build_object('slot',p_slot,'enabled',p_enabled,'version_id',v_new));
  RETURN v_new;
END;
$$;

ALTER TABLE public.video_jobs ADD COLUMN model_config_version_id uuid REFERENCES public.model_config_versions(id);
DROP INDEX public.video_jobs_provider_task;
CREATE UNIQUE INDEX video_jobs_version_task ON public.video_jobs(model_config_version_id,provider_task_id)
  WHERE provider_task_id IS NOT NULL AND model_config_version_id IS NOT NULL;
-- 保留原资金事务，外层绑定配置并在同一事务内检查启用状态。
ALTER FUNCTION public.create_video_job(uuid,uuid,text,jsonb) RENAME TO create_video_job_without_config;
REVOKE ALL ON FUNCTION public.create_video_job_without_config(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.create_video_job(
  p_user_id uuid, p_request_key uuid, p_provider text, p_payload jsonb, p_config_version uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_existing public.video_jobs%ROWTYPE; v_current uuid; v_enabled boolean; v_job jsonb;
BEGIN
  PERFORM 1 FROM public.user_plans WHERE user_id=p_user_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.video_jobs WHERE user_id=p_user_id AND request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.provider IS DISTINCT FROM p_provider OR v_existing.payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION '同一请求标识不能用于不同任务';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;
  SELECT current_version_id,enabled INTO v_current,v_enabled FROM public.model_configs
    WHERE slot='video.'||p_provider FOR SHARE;
  IF NOT FOUND OR NOT v_enabled OR v_current IS DISTINCT FROM p_config_version OR p_config_version IS NULL THEN
    RAISE EXCEPTION '模型配置已更新或未启用，请重新提交';
  END IF;
  v_job := public.create_video_job_without_config(p_user_id,p_request_key,p_provider,p_payload);
  UPDATE public.video_jobs SET model_config_version_id=p_config_version
    WHERE id=(v_job->>'id')::uuid RETURNING to_jsonb(video_jobs.*) INTO v_job;
  RETURN v_job;
END;
$$;
-- 迁移前已有受理任务需人工确认原配置；新配置不能自动替代旧账号。
UPDATE public.video_jobs SET needs_attention=true,error_message='旧任务需绑定原模型配置版本后继续处理'
  WHERE charge_id IS NOT NULL AND status IN ('pending','processing') AND model_config_version_id IS NULL;
CREATE OR REPLACE FUNCTION public.claim_video_job(p_job_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job public.video_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.video_jobs
  WHERE charge_id IS NOT NULL AND (model_config_version_id IS NOT NULL OR resolution_event IS NOT NULL)
    AND status IN ('pending','processing')
    AND (p_job_id IS NULL OR id=p_job_id)
    AND submission_state IN ('queued','submitting','submitted')
    AND next_poll_at<=now() AND (lease_until IS NULL OR lease_until<now())
  ORDER BY next_poll_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_job.submission_state='submitting' AND v_job.resolution_event IS NULL THEN
    UPDATE public.video_jobs SET submission_state='unknown',needs_attention=true,
      error_message='提交执行器中断，需核对上游受理结果',lease_token=NULL,lease_until=NULL WHERE id=v_job.id;
    RETURN NULL;
  END IF;
  UPDATE public.video_jobs SET status='processing',
    submission_state=CASE WHEN submission_state='queued' THEN 'submitting' ELSE submission_state END,
    attempts=attempts+CASE WHEN submission_state='queued' THEN 1 ELSE 0 END,
    started_at=COALESCE(started_at,now()),lease_token=gen_random_uuid(),lease_until=now()+interval '180 seconds'
  WHERE id=v_job.id RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;
CREATE FUNCTION public.bind_legacy_video_config(p_job_id uuid,p_version uuid,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job public.video_jobs%ROWTYPE;
BEGIN
  IF length(trim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION '请记录原账号与接口核对依据'; END IF;
  SELECT * INTO STRICT v_job FROM public.video_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.model_config_version_id IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM public.model_config_versions WHERE id=p_version AND slot='video.'||v_job.provider
  ) OR (v_job.lease_until IS NOT NULL AND v_job.lease_until>now()) THEN RAISE EXCEPTION '配置不匹配或任务正在执行'; END IF;
  UPDATE public.video_jobs SET model_config_version_id=p_version,next_poll_at=now(),needs_attention=false,error_message=NULL WHERE id=p_job_id;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(v_job.user_id,'bind_legacy_video_config','video_jobs',p_job_id,
      jsonb_build_object('version_id',p_version,'evidence',p_note));
END;
$$;
REVOKE ALL ON FUNCTION public.save_model_config(text,uuid,jsonb,boolean,text,uuid,boolean),
  public.create_video_job(uuid,uuid,text,jsonb,uuid),public.bind_legacy_video_config(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_model_config(text,uuid,jsonb,boolean,text,uuid,boolean),
  public.create_video_job(uuid,uuid,text,jsonb,uuid),public.bind_legacy_video_config(uuid,uuid,text) TO service_role;
COMMIT;
