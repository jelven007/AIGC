-- 图片编辑复用原任务和generate_image/cover流水；校验发生在扣费前，旧请求原样返回。
ALTER FUNCTION public.create_production_job(uuid,uuid,text,jsonb,uuid,uuid) RENAME TO create_production_job_before_image_edit;
REVOKE ALL ON FUNCTION public.create_production_job_before_image_edit(uuid,uuid,text,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.create_production_job(p_user_id uuid,p_request_key uuid,p_kind text,p_payload jsonb,
 p_project_id uuid DEFAULT NULL,p_version uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior production_jobs%ROWTYPE; mode text; config jsonb; current_id uuid; enabled boolean; cost int; reference text; path text;
BEGIN
 IF p_kind<>'image' THEN RETURN create_production_job_before_image_edit(p_user_id,p_request_key,p_kind,p_payload,p_project_id,p_version); END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user_id FOR UPDATE;
 SELECT * INTO prior FROM production_jobs WHERE user_id=p_user_id AND request_key=p_request_key;
 IF FOUND THEN
  IF prior.kind IS DISTINCT FROM p_kind OR prior.payload IS DISTINCT FROM p_payload OR prior.project_id IS DISTINCT FROM p_project_id THEN
   RAISE EXCEPTION '同一请求标识不能用于不同任务';
  END IF;
  RETURN to_jsonb(prior);
 END IF;
 mode:=COALESCE(p_payload->>'mode',CASE WHEN COALESCE(p_payload->>'reference_image','')<>'' THEN 'reference' ELSE 'generate' END);
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR mode NOT IN ('generate','reference','inpaint','outpaint')
  OR jsonb_typeof(p_payload->'prompt') IS DISTINCT FROM 'string' OR length(trim(p_payload->>'prompt')) NOT BETWEEN 1 AND 8000
  OR COALESCE(p_payload->>'size','1024x1024') NOT IN ('1024x1024','1024x1536','1536x1024')
  OR COALESCE(p_payload->>'quality','auto') NOT IN ('auto','low','medium','high') THEN RAISE EXCEPTION '图片参数非法'; END IF;
 SELECT m.current_version_id,m.enabled,v.settings INTO current_id,enabled,config
  FROM model_configs m JOIN model_config_versions v ON v.id=m.current_version_id WHERE m.slot='image.primary' FOR SHARE OF m;
 IF current_id IS NULL OR NOT enabled OR p_version IS DISTINCT FROM current_id THEN RAISE EXCEPTION '图片模型配置已更新或未启用'; END IF;
 IF mode='generate' AND (COALESCE(p_payload->>'reference_image','')<>'' OR COALESCE(p_payload->>'mask_image','')<>'')
  OR mode IN ('generate','reference') AND COALESCE(p_payload->>'mask_image','')<>'' THEN RAISE EXCEPTION '图片掩码参数非法'; END IF;
 IF mode<>'generate' AND COALESCE(p_payload->>'reference_image','')='' THEN RAISE EXCEPTION '图片编辑素材缺失'; END IF;
 IF mode<>'generate' AND COALESCE(config->>'protocol','')<>'chat-image' AND NOT COALESCE((
  config->>'protocol'='openai-images' AND COALESCE(config->>'edit_endpoint','')<>'' AND config->>'model' IN (
   'gpt-image-1','gpt-image-1-mini','gpt-image-1.5','chatgpt-image-latest','gpt-image-2','gpt-image-2-2026-04-21',
   'gpt-image-2.5-sunburst','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare','gpt-image-2.5-flare-2026-09-08')
  AND config->>'edit_endpoint'=regexp_replace(config->>'endpoint','/images/generations$','/images/edits')
  AND config->>'endpoint' LIKE '%/images/generations'),false) THEN RAISE EXCEPTION '图片模型配置未支持编辑'; END IF;
 IF mode IN ('inpaint','outpaint') THEN
  IF config->>'protocol'<>'openai-images' OR COALESCE(p_payload->>'mask_image','')='' THEN RAISE EXCEPTION '图片掩码参数非法'; END IF;
  IF p_payload->>'confirmed_model_version' IS DISTINCT FROM current_id::text THEN RAISE EXCEPTION '图片模型配置已更新，请重新确认'; END IF;
  FOREACH reference IN ARRAY ARRAY[p_payload->>'reference_image',p_payload->>'mask_image'] LOOP
   path:=substring(reference FROM '^https://[^/]+/storage/v1/object/authenticated/materials/([^?#]+)$');
   IF path IS NULL OR path LIKE '%\%%' OR NOT can_read_media(p_user_id,'materials',path)
    OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='materials' AND name=path) THEN RAISE EXCEPTION '图片编辑素材不存在或无权访问'; END IF;
  END LOOP;
 END IF;
 SELECT c.cost INTO cost FROM credit_costs c WHERE action=CASE WHEN p_project_id IS NULL THEN 'generate_image' ELSE 'generate_cover' END FOR SHARE;
 IF mode IN ('inpaint','outpaint') OR p_payload ? 'confirmed_credit_cost' THEN
  IF jsonb_typeof(p_payload->'confirmed_credit_cost') IS DISTINCT FROM 'number'
   OR (p_payload->>'confirmed_credit_cost')::numeric IS DISTINCT FROM cost THEN RAISE EXCEPTION '图片价格已更新，请重新确认'; END IF;
 END IF;
 IF p_payload ? 'confirmed_model_version' AND p_payload->>'confirmed_model_version' IS DISTINCT FROM current_id::text THEN
  RAISE EXCEPTION '图片模型配置已更新，请重新确认';
 END IF;
 RETURN create_production_job_before_image_edit(p_user_id,p_request_key,p_kind,p_payload,p_project_id,p_version);
END; $$;
REVOKE ALL ON FUNCTION public.create_production_job(uuid,uuid,text,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_production_job(uuid,uuid,text,jsonb,uuid,uuid) TO service_role;
CREATE FUNCTION public.image_editing_schema_ready() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT to_regprocedure('public.create_production_job_before_image_edit(uuid,uuid,text,jsonb,uuid,uuid)') IS NOT NULL
  AND NOT has_function_privilege('authenticated','public.create_production_job(uuid,uuid,text,jsonb,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.create_production_job_before_image_edit(uuid,uuid,text,jsonb,uuid,uuid)','EXECUTE');
$$;
REVOKE ALL ON FUNCTION public.image_editing_schema_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.image_editing_schema_ready() TO service_role;
