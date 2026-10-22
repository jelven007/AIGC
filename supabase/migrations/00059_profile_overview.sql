-- 本人概览按完整数据聚合；头像也参与对象引用保护。
CREATE INDEX IF NOT EXISTS video_projects_owner_created ON public.video_projects(user_id,created_at);
CREATE FUNCTION public.get_my_profile_overview(p_timezone text DEFAULT 'UTC') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE owner_id uuid:=auth.uid(); first_day date; activity jsonb;
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION '请先登录' USING ERRCODE='42501'; END IF;
  IF p_timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN
    RAISE EXCEPTION '时区无效';
  END IF;
  first_day:=(now() AT TIME ZONE p_timezone)::date-29;
  SELECT jsonb_agg(jsonb_build_object('date',to_char(d.day,'YYYY-MM-DD'),'count',COALESCE(a.total,0)) ORDER BY d.day)
    INTO activity
    FROM generate_series(first_day::timestamp,first_day::timestamp+interval '29 days',interval '1 day') d(day)
    LEFT JOIN (
      SELECT (created_at AT TIME ZONE p_timezone)::date AS day,count(*) AS total FROM video_projects
      WHERE user_id=owner_id AND created_at>=(first_day::timestamp AT TIME ZONE p_timezone)
        AND created_at<((first_day+30)::timestamp AT TIME ZONE p_timezone) GROUP BY 1
    ) a ON a.day=d.day::date;
  RETURN jsonb_build_object(
    'videos',(SELECT count(*) FROM video_projects WHERE user_id=owner_id),
    'completed',(SELECT count(*) FROM video_projects WHERE user_id=owner_id AND status='completed' AND NULLIF(video_url,'') IS NOT NULL),
    'materials',(SELECT count(*) FROM materials WHERE user_id=owner_id),
    'products',(SELECT count(*) FROM products WHERE user_id=owner_id),
    'published',(SELECT count(*) FROM publish_tasks WHERE user_id=owner_id AND status='published'),
    'timezone',p_timezone,'activity',activity);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_profile_overview(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_profile_overview(text) TO authenticated;

CREATE TRIGGER lifecycle_media_refs AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_media_references();
INSERT INTO public.media_references
  SELECT bucket,path,'profiles',r.id FROM public.profiles r,
  LATERAL public.media_tree_objects(public.media_reference_tree('profiles',to_jsonb(r)))
  ON CONFLICT DO NOTHING;

CREATE FUNCTION public.profile_overview_schema_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT to_regprocedure('public.get_my_profile_overview(text)') IS NOT NULL
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.profiles'::regclass
      AND tgname='lifecycle_media_refs' AND NOT tgisinternal AND tgenabled='O');
$$;
REVOKE ALL ON FUNCTION public.profile_overview_schema_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.profile_overview_schema_ready() TO service_role;
