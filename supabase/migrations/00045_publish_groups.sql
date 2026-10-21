BEGIN;
CREATE TABLE public.publish_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  request_key uuid NOT NULL,
  request jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_key)
);
ALTER TABLE publish_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON publish_groups FROM PUBLIC,anon,authenticated;
GRANT ALL ON publish_groups TO service_role;
ALTER TABLE publish_tasks ADD COLUMN group_id uuid REFERENCES publish_groups(id);
CREATE INDEX publish_tasks_group ON publish_tasks(group_id) WHERE group_id IS NOT NULL;
CREATE UNIQUE INDEX publish_group_account ON publish_tasks(group_id,connection_id) WHERE group_id IS NOT NULL;

-- 单账号与发布组共用24个未结案名额；统一用户→作品的锁顺序。
ALTER FUNCTION create_platform_publish(uuid,uuid,uuid,uuid,text,text,text[],jsonb,timestamptz)
  RENAME TO create_platform_publish_before_groups;
REVOKE ALL ON FUNCTION create_platform_publish_before_groups(uuid,uuid,uuid,uuid,text,text,text[],jsonb,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.create_platform_publish(
  p_user_id uuid,p_request uuid,p_project uuid,p_connection uuid,p_title text,
  p_description text,p_tags text[],p_options jsonb,p_schedule timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM 1 FROM user_plans WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
  IF NOT EXISTS(SELECT 1 FROM publish_tasks WHERE user_id=p_user_id AND request_key=p_request) THEN
    IF (SELECT count(*) FROM production_jobs WHERE user_id=p_user_id AND kind='publish'
        AND status IN ('pending','running','unknown'))>=24 THEN
      RAISE EXCEPTION '最多保留24个未结案发布任务';
    END IF;
    PERFORM 1 FROM video_projects WHERE id=p_project AND user_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '作品不存在或无权访问'; END IF;
  END IF;
  RETURN create_platform_publish_before_groups(p_user_id,p_request,p_project,p_connection,
    p_title,p_description,p_tags,p_options,p_schedule);
END;
$$;

CREATE FUNCTION public.create_publish_group(
  p_user uuid,p_request uuid,p_payload jsonb,p_source text,p_duration numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_group publish_groups%ROWTYPE; v_project video_projects%ROWTYPE; v_target jsonb;
  v_task jsonb; v_count int; v_schedule timestamptz; v_field text;
BEGIN
  IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload->'targets') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '发布组参数无效';
  END IF;
  v_count:=jsonb_array_length(p_payload->'targets');
  IF v_count<1 OR v_count>10 THEN RAISE EXCEPTION '一次选择1至10个账号'; END IF;
  -- 账号顺序不影响请求身份。
  p_payload:=jsonb_set(p_payload,'{targets}',
    (SELECT jsonb_agg(value ORDER BY value->>'connection_id') FROM jsonb_array_elements(p_payload->'targets')));
  PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
  SELECT * INTO v_group FROM publish_groups WHERE user_id=p_user AND request_key=p_request;
  IF FOUND THEN
    IF v_group.request IS DISTINCT FROM p_payload THEN RAISE EXCEPTION '同一请求标识不能用于不同发布'; END IF;
    RETURN v_group.id;
  END IF;
  IF jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'title'))<1
    OR length(p_payload->>'title')>150 OR jsonb_typeof(p_payload->'description') IS DISTINCT FROM 'string'
    OR length(p_payload->>'description')>1000 OR jsonb_typeof(p_payload->'tags') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '发布内容不完整';
  END IF;
  IF jsonb_array_length(p_payload->'tags')>10 OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_payload->'tags') WHERE jsonb_typeof(value)<>'string' OR length(value#>>'{}')>30
  ) THEN RAISE EXCEPTION '标签超出限制'; END IF;
  IF (SELECT count(DISTINCT (value->>'connection_id')::uuid) FROM jsonb_array_elements(p_payload->'targets'))<>v_count THEN
    RAISE EXCEPTION '不能重复选择同一账号';
  END IF;
  v_schedule:=(p_payload->>'scheduled_at')::timestamptz;
  IF v_schedule IS NOT NULL AND (v_schedule<=now() OR v_schedule>now()+interval '30 days') THEN
    RAISE EXCEPTION '定时发布应在未来30天以内';
  END IF;
  SELECT * INTO STRICT v_project FROM video_projects
    WHERE id=(p_payload->>'project_id')::uuid AND user_id=p_user AND status='completed' FOR UPDATE;
  IF v_project.video_url IS NULL OR v_project.video_url IS DISTINCT FROM p_source
    OR v_project.duration IS DISTINCT FROM p_duration OR p_duration IS NULL OR p_duration<=0 THEN
    RAISE EXCEPTION '成片已变化，请重新预览';
  END IF;
  IF p_payload->>'source_url' IS DISTINCT FROM p_source
    OR (p_payload->>'duration')::numeric IS DISTINCT FROM p_duration THEN
    RAISE EXCEPTION '成片已变化，请重新预览';
  END IF;
  IF (SELECT count(*) FROM production_jobs WHERE user_id=p_user AND kind='publish'
      AND status IN ('pending','running','unknown'))+v_count>24 THEN
    RAISE EXCEPTION '最多保留24个未结案发布任务';
  END IF;
  INSERT INTO publish_groups(user_id,request_key,request) VALUES(p_user,p_request,p_payload) RETURNING * INTO v_group;
  FOR v_target IN SELECT value FROM jsonb_array_elements(p_payload->'targets') LOOP
    IF v_target->'options'->'consent' IS DISTINCT FROM 'true'::jsonb
      OR jsonb_typeof(v_target->'options'->'privacy_level') IS DISTINCT FROM 'string'
      OR length(v_target->'options'->>'privacy_level')=0 THEN RAISE EXCEPTION '请逐账号确认发布与可见范围'; END IF;
    FOREACH v_field IN ARRAY ARRAY['disable_comment','disable_duet','disable_stitch',
      'brand_content_toggle','brand_organic_toggle','is_aigc'] LOOP
      IF jsonb_typeof(v_target->'options'->v_field) IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION '发布选项不完整';
      END IF;
    END LOOP;
    PERFORM 1 FROM platform_connections WHERE id=(v_target->>'connection_id')::uuid
      AND user_id=p_user AND status='active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION '账号已断开或无权访问'; END IF;
    v_task:=create_platform_publish(p_user,gen_random_uuid(),v_project.id,(v_target->>'connection_id')::uuid,
      p_payload->>'title',p_payload->>'description',ARRAY(SELECT jsonb_array_elements_text(p_payload->'tags')),
      v_target->'options',v_schedule);
    UPDATE publish_tasks SET group_id=v_group.id WHERE id=(v_task->>'id')::uuid;
  END LOOP;
  INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(p_user,'create_publish_group','publish_groups',v_group.id,
      jsonb_build_object('accounts',v_count,'project_id',v_project.id));
  RETURN v_group.id;
END;
$$;
REVOKE ALL ON FUNCTION create_platform_publish(uuid,uuid,uuid,uuid,text,text,text[],jsonb,timestamptz),
  create_publish_group(uuid,uuid,jsonb,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION create_platform_publish(uuid,uuid,uuid,uuid,text,text,text[],jsonb,timestamptz),
  create_publish_group(uuid,uuid,jsonb,text,numeric) TO service_role;
COMMIT;
