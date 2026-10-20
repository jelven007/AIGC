-- 火山新环境显式开放 Data API；表可达权限与 RLS 行权限分别配置。
BEGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
      AND c.relname NOT IN (
        'user_plans','credit_logs','orders','video_jobs','plans','credit_costs','llm_cache',
        'activities','user_activities','rate_limit_windows','audit_logs','model_calls','risk_events',
        'error_logs','alipay_notify_events','alipay_refunds'
      )
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', item.relname);
  END LOOP;
END;
$$;
ALTER VIEW public.user_stats SET (security_invoker = true);
ALTER VIEW public.active_video_projects SET (security_invoker = true);
ALTER VIEW public.public_profiles SET (security_invoker = true);
GRANT SELECT ON public.user_stats TO authenticated;
REVOKE ALL ON public.rate_limit_windows, public.audit_logs, public.model_calls,
  public.risk_events, public.error_logs, public.alipay_notify_events, public.alipay_refunds
  FROM anon, authenticated;
GRANT SELECT ON public.audit_logs, public.model_calls, public.risk_events TO authenticated;
GRANT SELECT, INSERT ON public.error_logs TO authenticated;
COMMIT;
