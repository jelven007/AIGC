BEGIN;
CREATE TABLE public.render_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  request_key uuid NOT NULL,
  request_payload jsonb NOT NULL,
  source_project_id uuid REFERENCES public.video_projects(id) ON DELETE SET NULL,
  source_title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_key)
);
ALTER TABLE public.render_exports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.render_exports FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.render_exports TO service_role;
ALTER TABLE public.production_jobs ADD COLUMN export_id uuid REFERENCES public.render_exports(id);
CREATE INDEX production_jobs_export ON public.production_jobs(export_id) WHERE export_id IS NOT NULL;

-- 所有入口共用同一账户锁与队列上限；原请求恢复不受新限额影响。
ALTER FUNCTION public.create_production_job(uuid,uuid,text,jsonb,uuid,uuid)
  RENAME TO create_production_job_before_quota;
REVOKE ALL ON FUNCTION public.create_production_job_before_quota(uuid,uuid,text,jsonb,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.create_production_job(
  p_user_id uuid,p_request_key uuid,p_kind text,p_payload jsonb,p_project_id uuid DEFAULT NULL,p_version uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM 1 FROM user_plans WHERE user_id=p_user_id FOR UPDATE;
  IF p_kind='render' AND NOT EXISTS(
    SELECT 1 FROM production_jobs WHERE user_id=p_user_id AND request_key=p_request_key
  ) AND (SELECT count(*) FROM production_jobs WHERE user_id=p_user_id AND kind='render'
    AND status IN ('pending','running','unknown'))>=24 THEN
    RAISE EXCEPTION '当前渲染队列已满，请等待已有任务完成';
  END IF;
  RETURN create_production_job_before_quota(p_user_id,p_request_key,p_kind,p_payload,p_project_id,p_version);
END;
$$;
REVOKE ALL ON FUNCTION public.create_production_job(uuid,uuid,text,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_production_job(uuid,uuid,text,jsonb,uuid,uuid) TO service_role;

CREATE FUNCTION public.create_render_export(
  p_user_id uuid,p_request_key uuid,p_request jsonb,p_expected_source_url text,p_media_url text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_export public.render_exports%ROWTYPE; v_source public.video_projects%ROWTYPE;
  v_format jsonb; v_project uuid; v_job jsonb; v_title text; v_count int;
BEGIN
  IF p_request_key IS NULL OR p_request IS NULL OR jsonb_typeof(p_request)<>'object'
    OR jsonb_typeof(p_request->'formats') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '导出参数非法'; END IF;
  v_count:=jsonb_array_length(p_request->'formats');
  IF v_count<1 OR v_count>18 OR COALESCE(p_request->>'source_project_id','')='' THEN RAISE EXCEPTION '导出规格数量应为1–18'; END IF;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_request->'formats'))<>v_count THEN
    RAISE EXCEPTION '不能重复选择同一规格';
  END IF;
  FOR v_format IN SELECT value FROM jsonb_array_elements(p_request->'formats') LOOP
    IF jsonb_typeof(v_format)<>'object'
      OR COALESCE(v_format->>'ratio','') NOT IN ('9:16','16:9','1:1','4:3','3:4','4:5')
      OR COALESCE(v_format->>'height','') NOT IN ('720','1080','2160') THEN RAISE EXCEPTION '输出规格不支持'; END IF;
  END LOOP;
  PERFORM 1 FROM user_plans WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
  SELECT * INTO v_export FROM render_exports WHERE user_id=p_user_id AND request_key=p_request_key;
  IF FOUND THEN
    IF v_export.request_payload IS DISTINCT FROM p_request THEN RAISE EXCEPTION '同一请求标识不能用于不同导出'; END IF;
    RETURN v_export.id;
  END IF;
  IF (SELECT count(*) FROM production_jobs WHERE user_id=p_user_id AND kind='render'
    AND status IN ('pending','running','unknown'))+v_count>24 THEN
    RAISE EXCEPTION '当前渲染队列容量不足，请等待已有任务完成';
  END IF;
  SELECT * INTO v_source FROM video_projects
    WHERE id=(p_request->>'source_project_id')::uuid AND user_id=p_user_id FOR SHARE;
  IF NOT FOUND OR v_source.status<>'completed' OR v_source.video_url IS DISTINCT FROM p_expected_source_url
    OR v_source.duration IS NULL OR v_source.duration<1 OR v_source.duration>600
    OR COALESCE(p_media_url,'') !~ '^https://' THEN RAISE EXCEPTION '源作品已更新或不可导出，请重新选择'; END IF;
  INSERT INTO render_exports(user_id,request_key,request_payload,source_project_id,source_title)
    VALUES(p_user_id,p_request_key,p_request,v_source.id,v_source.title) RETURNING * INTO v_export;
  FOR v_format IN SELECT value FROM jsonb_array_elements(p_request->'formats') LOOP
    v_title:=left(v_source.title,55)||' '||(v_format->>'ratio')||' '||(v_format->>'height')||'p';
    INSERT INTO video_projects(user_id,title,status,duration)
      VALUES(p_user_id,v_title,'draft',v_source.duration) RETURNING id INTO v_project;
    v_job:=create_production_job(p_user_id,gen_random_uuid(),'render',
      jsonb_build_object('version',1,'title',v_title,'duration',v_source.duration,'ratio',v_format->>'ratio',
        'height',(v_format->>'height')::int,'fps',30,'tracks',jsonb_build_array(
          jsonb_build_object('id','source','type','video','start',0,'duration',v_source.duration,'url',p_media_url)
        )),v_project,NULL);
    UPDATE production_jobs SET export_id=v_export.id WHERE id=(v_job->>'id')::uuid;
  END LOOP;
  INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(p_user_id,'create_render_export','render_exports',v_export.id,
      jsonb_build_object('source_project_id',v_source.id,'formats',p_request->'formats'));
  RETURN v_export.id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_render_export(uuid,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_render_export(uuid,uuid,jsonb,text,text) TO service_role;
COMMIT;
