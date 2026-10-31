-- Supabase PG预装pg_safeupdate；模型版本变更按原契约清空旧缓存。
-- 只修正此已审查语句，不关闭平台的无条件删除保护。
DO $compatibility$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef('public.save_model_config(text,uuid,jsonb,boolean,text,uuid,boolean)'::regprocedure);
  IF position('DELETE FROM llm_cache;' IN definition)>0 THEN
    EXECUTE replace(definition,'DELETE FROM llm_cache;','DELETE FROM llm_cache WHERE true;');
  ELSIF position('DELETE FROM public.llm_cache;' IN definition)>0 THEN
    EXECUTE replace(definition,'DELETE FROM public.llm_cache;','DELETE FROM public.llm_cache WHERE true;');
  ELSIF position('DELETE FROM llm_cache WHERE true;' IN definition)=0
    AND position('DELETE FROM public.llm_cache WHERE true;' IN definition)=0 THEN
    RAISE EXCEPTION 'model cache compatibility statement changed';
  END IF;
END
$compatibility$;

-- 前端余额和作品/素材页面实际订阅的表；幂等补齐平台发布清单。
DO $realtime$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['video_projects','materials','user_plans','credit_logs','plans']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=table_name) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',table_name);
    END IF;
  END LOOP;
END
$realtime$;

-- 缓存包含各账号模型输出，仅可信管理员可监控和清理，保留表ACL。
CREATE OR REPLACE FUNCTION public.manage_llm_cache(p_action text,p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $cache$
DECLARE result jsonb; changed integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=auth.uid() AND raw_app_meta_data->>'role'='admin') THEN
    RAISE EXCEPTION '仅管理员可管理模型缓存' USING ERRCODE='42501';
  END IF;
  IF p_action='list' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb) INTO result FROM (
      SELECT id,action,coalesce(prompt_hash,cache_key) AS prompt_hash,
        coalesce(response_text,response::text) AS response_text,hit_count,created_at,expires_at,model,tokens_saved
      FROM llm_cache ORDER BY hit_count DESC,created_at DESC LIMIT 50
    ) AS item;
    RETURN jsonb_build_object('entries',result);
  ELSIF p_action='delete' AND p_id IS NOT NULL THEN
    DELETE FROM llm_cache WHERE id=p_id;
  ELSIF p_action='clear_expired' THEN
    DELETE FROM llm_cache WHERE expires_at<now();
  ELSE
    RAISE EXCEPTION '缓存操作参数无效';
  END IF;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN jsonb_build_object('ok',true,'changed',changed);
END
$cache$;
REVOKE ALL ON FUNCTION public.manage_llm_cache(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_llm_cache(text,uuid) TO authenticated;
