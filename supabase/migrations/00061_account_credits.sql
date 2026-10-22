-- 余额与权益使用同一权威快照。只读，不改写历史积分、套餐或流水。
CREATE FUNCTION public.get_my_credits() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid:=auth.uid(); result jsonb; n timestamptz:=clock_timestamp();
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION '请先登录'; END IF;
 SELECT jsonb_build_object(
   'user_id',u.user_id,'plan_id',u.plan_id,'plan_name',p.name,'configured_plan_level',p.level,
   'plan_level',CASE WHEN u.status='active' AND (u.expires_at IS NULL OR u.expires_at>n) THEN p.level ELSE 0 END,
   'entitlement_active',u.status='active' AND (u.expires_at IS NULL OR u.expires_at>n),
   'credits_total',u.credits_total,'credits_used',u.credits_used,
   'credits_left',greatest(0,u.credits_total::bigint-u.credits_used::bigint),
   'status',u.status,'expires_at',u.expires_at,'cycle_start',u.cycle_start,'cycle_end',u.cycle_end,
   'server_time',n)
 INTO result FROM user_plans u JOIN plans p ON p.id=u.plan_id WHERE u.user_id=uid;
 IF result IS NULL THEN RAISE EXCEPTION '积分账户尚未初始化，请重试或联系支持'; END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_my_credits() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_credits() TO authenticated;

CREATE FUNCTION public.account_credits_schema_ready() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT to_regprocedure('public.get_my_credits()') IS NOT NULL
   AND has_function_privilege('authenticated','public.get_my_credits()','EXECUTE')
   AND NOT has_function_privilege('anon','public.get_my_credits()','EXECUTE');
$$;
REVOKE ALL ON FUNCTION public.account_credits_schema_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_credits_schema_ready() TO service_role;
