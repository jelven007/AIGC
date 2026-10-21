-- 真实运营控制台：按用户范围授权、分页/安全字段、日预算与角色变更审计。
BEGIN;
CREATE TABLE public.operator_mutations (
  request_key uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.operator_mutations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_mutations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.operator_mutations TO service_role;
CREATE INDEX credit_logs_daily_budget ON public.credit_logs(user_id,created_at) WHERE type='deduct';

CREATE FUNCTION public.operator_access(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_permissions jsonb; v_grants jsonb; v_root boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可读取运营身份' USING ERRCODE='42501'; END IF;
  SELECT raw_app_meta_data->>'role'='admin' INTO v_root FROM auth.users
    WHERE id=p_actor AND (banned_until IS NULL OR banned_until<=now());
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'role',role,'scope_user_id',scope_user_id)),'[]'::jsonb)
    INTO v_grants FROM public.operator_grants WHERE operator_id=p_actor AND revoked_at IS NULL;
  SELECT coalesce(jsonb_agg(permission),'[]'::jsonb) INTO v_permissions FROM unnest(
    ARRAY['orders:read','refunds:write','credits:read','customers:read','jobs:read','budgets:write','risk:read','audit:read','operators:write']
  ) permission WHERE public.operator_can(p_actor,permission,NULL) OR EXISTS(
    SELECT 1 FROM public.operator_grants WHERE operator_id=p_actor AND revoked_at IS NULL
      AND public.operator_can(p_actor,permission,scope_user_id));
  RETURN jsonb_build_object('root',coalesce(v_root,false),'permissions',v_permissions,'grants',v_grants);
END;
$$;

CREATE FUNCTION public.operator_list(p_actor uuid,p_domain text,p_page int DEFAULT 1,p_user uuid DEFAULT NULL,p_keyword text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_permission text; v_items jsonb; v_total bigint; v_offset int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可读取运营数据' USING ERRCODE='42501'; END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000 OR length(coalesce(p_keyword,''))>64 THEN RAISE EXCEPTION '分页或搜索非法'; END IF;
  v_offset:=(p_page-1)*25;
  v_permission:=CASE p_domain WHEN 'orders' THEN 'orders:read' WHEN 'refunds' THEN 'orders:read'
    WHEN 'customers' THEN 'customers:read' WHEN 'jobs' THEN 'jobs:read' WHEN 'risk' THEN 'risk:read'
    WHEN 'audit' THEN 'audit:read' WHEN 'operators' THEN 'operators:write' ELSE NULL END;
  IF v_permission IS NULL THEN RAISE EXCEPTION '运营域不支持'; END IF;
  IF NOT public.operator_can(p_actor,v_permission,p_user) AND NOT EXISTS(SELECT 1 FROM public.operator_grants
    WHERE operator_id=p_actor AND revoked_at IS NULL AND (p_user IS NULL OR scope_user_id=p_user)
      AND public.operator_can(p_actor,v_permission,scope_user_id)) THEN RAISE EXCEPTION '无运营权限' USING ERRCODE='42501'; END IF;
  IF p_domain='orders' THEN
    SELECT count(*) INTO v_total FROM public.orders o WHERE public.operator_can(p_actor,v_permission,o.user_id)
      AND (p_user IS NULL OR o.user_id=p_user) AND position(coalesce(p_keyword,'') in o.order_no)>0;
    SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') INTO v_items FROM (
      SELECT o.id,o.order_no,o.user_id,o.total_amount,o.refunded_amount,o.status,o.pay_channel,
        o.plan_snapshot->>'name' AS plan_name,o.entitlement_revoked_credits,o.created_at,o.paid_at
      FROM public.orders o WHERE public.operator_can(p_actor,v_permission,o.user_id)
        AND (p_user IS NULL OR o.user_id=p_user) AND position(coalesce(p_keyword,'') in o.order_no)>0
      ORDER BY o.created_at DESC,o.id DESC LIMIT 25 OFFSET v_offset
    ) t;
  ELSIF p_domain='refunds' THEN
    SELECT count(*) INTO v_total FROM public.alipay_refunds r JOIN public.orders o ON o.id=r.order_id
      WHERE public.operator_can(p_actor,v_permission,o.user_id) AND (p_user IS NULL OR o.user_id=p_user)
        AND position(coalesce(p_keyword,'') in o.order_no)>0;
    SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') INTO v_items FROM (
      SELECT r.id,r.request_key,r.out_request_no,r.refund_amount,r.refund_reason,r.status,r.needs_attention,
        r.applied_at,r.revoked_credits,r.next_query_at,r.created_at,o.order_no,o.user_id
      FROM public.alipay_refunds r JOIN public.orders o ON o.id=r.order_id
        WHERE public.operator_can(p_actor,v_permission,o.user_id) AND (p_user IS NULL OR o.user_id=p_user)
          AND position(coalesce(p_keyword,'') in o.order_no)>0
      ORDER BY r.created_at DESC,r.id DESC LIMIT 25 OFFSET v_offset
    ) t;
  ELSIF p_domain='customers' THEN
    SELECT count(*) INTO v_total FROM public.profiles p WHERE public.operator_can(p_actor,v_permission,p.id)
      AND (p_user IS NULL OR p.id=p_user) AND (position(coalesce(p_keyword,'') in p.username)>0 OR position(coalesce(p_keyword,'') in p.email)>0);
    SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') INTO v_items FROM (
      SELECT p.id,p.username,p.email,p.created_at,up.credits_total-up.credits_used AS credit_balance,up.daily_credit_budget,
        up.plan_id,up.status AS plan_status FROM public.profiles p JOIN public.user_plans up ON up.user_id=p.id
      WHERE public.operator_can(p_actor,v_permission,p.id) AND (p_user IS NULL OR p.id=p_user)
        AND (position(coalesce(p_keyword,'') in p.username)>0 OR position(coalesce(p_keyword,'') in p.email)>0)
      ORDER BY p.created_at DESC,p.id DESC LIMIT 25 OFFSET v_offset
    ) t;
  ELSIF p_domain='jobs' THEN
    WITH jobs AS (
      SELECT id,user_id,status,action AS kind,created_at,billing_state,needs_attention FROM public.video_jobs
      UNION ALL SELECT j.id,j.user_id,j.status,j.kind,j.created_at,
        CASE WHEN j.charge_id IS NULL THEN NULL WHEN EXISTS(SELECT 1 FROM public.credit_logs c WHERE c.original_charge_id=j.charge_id)
          THEN 'refunded' WHEN j.status='completed' THEN 'settled' ELSE 'reserved' END,j.status='unknown' FROM public.production_jobs j
    ) SELECT count(*) INTO v_total FROM jobs WHERE public.operator_can(p_actor,v_permission,user_id)
      AND (p_user IS NULL OR user_id=p_user) AND position(coalesce(p_keyword,'') in kind)>0;
    WITH jobs AS (
      SELECT id,user_id,status,action AS kind,created_at,billing_state,needs_attention FROM public.video_jobs
      UNION ALL SELECT j.id,j.user_id,j.status,j.kind,j.created_at,
        CASE WHEN j.charge_id IS NULL THEN NULL WHEN EXISTS(SELECT 1 FROM public.credit_logs c WHERE c.original_charge_id=j.charge_id)
          THEN 'refunded' WHEN j.status='completed' THEN 'settled' ELSE 'reserved' END,j.status='unknown' FROM public.production_jobs j
    ) SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') INTO v_items FROM (
      SELECT * FROM jobs WHERE public.operator_can(p_actor,v_permission,user_id) AND (p_user IS NULL OR user_id=p_user)
        AND position(coalesce(p_keyword,'') in kind)>0 ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET v_offset
    ) t;
  ELSIF p_domain='risk' THEN
    SELECT count(*) INTO v_total FROM public.risk_events WHERE public.operator_can(p_actor,v_permission,user_id)
      AND (p_user IS NULL OR user_id=p_user) AND position(coalesce(p_keyword,'') in coalesce(action,''))>0;
    SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') INTO v_items FROM (
      SELECT id,user_id,source,action,decision,category,confidence,created_at FROM public.risk_events
      WHERE public.operator_can(p_actor,v_permission,user_id) AND (p_user IS NULL OR user_id=p_user)
        AND position(coalesce(p_keyword,'') in coalesce(action,''))>0 ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET v_offset
    ) t;
  ELSIF p_domain='audit' THEN
    PERFORM public.require_operator(p_actor,'audit:read',NULL);
    SELECT count(*) INTO v_total FROM public.audit_logs WHERE position(coalesce(p_keyword,'') in action)>0;
    SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') INTO v_items FROM (
      SELECT id,user_id,action,table_name,record_id,created_at FROM public.audit_logs
      WHERE position(coalesce(p_keyword,'') in action)>0 ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET v_offset
    ) t;
  ELSE
    PERFORM public.require_operator(p_actor,'operators:write',NULL);
    SELECT count(*) INTO v_total FROM public.operator_grants WHERE revoked_at IS NULL;
    SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') INTO v_items FROM (
      SELECT id,operator_id,role,scope_user_id,created_at FROM public.operator_grants WHERE revoked_at IS NULL
      ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET v_offset
    ) t;
  END IF;
  RETURN jsonb_build_object('items',v_items,'total',v_total,'page',p_page,'page_size',25,'observed_at',clock_timestamp());
END;
$$;

CREATE FUNCTION public.operator_mutate(p_actor uuid,p_key uuid,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_prior public.operator_mutations%ROWTYPE; v_scope uuid; v_permission text;
  v_result jsonb; v_value int; v_id uuid;
BEGIN
  IF p_key IS NULL OR p_payload IS NULL OR length(p_payload::text)>2000 THEN RAISE EXCEPTION '运营申请非法'; END IF;
  v_permission:=CASE p_action WHEN 'budget' THEN 'budgets:write' WHEN 'grant' THEN 'operators:write'
    WHEN 'revoke' THEN 'operators:write' ELSE NULL END;
  IF v_permission IS NULL THEN RAISE EXCEPTION '运营写操作不支持'; END IF;
  v_scope:=CASE WHEN p_action='budget' THEN (p_payload->>'user_id')::uuid ELSE NULL END;
  PERFORM public.require_operator(p_actor,v_permission,v_scope);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,471));
  SELECT * INTO v_prior FROM public.operator_mutations WHERE request_key=p_key;
  IF FOUND THEN
    IF v_prior.actor_id<>p_actor OR v_prior.action<>p_action OR v_prior.payload<>p_payload THEN
      RAISE EXCEPTION '同一运营申请不能修改参数';
    END IF;
    RETURN v_prior.result;
  END IF;
  IF p_action='budget' THEN
    IF v_scope IS NULL OR NOT(p_payload ?& ARRAY['expected','amount']) THEN RAISE EXCEPTION '日预算参数非法'; END IF;
    v_value:=(p_payload->>'amount')::int;
    IF v_value IS NULL OR v_value NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION '日预算必须为0至1000000整数'; END IF;
    PERFORM 1 FROM public.user_plans WHERE user_id=v_scope FOR UPDATE;
    UPDATE public.user_plans SET daily_credit_budget=v_value WHERE user_id=v_scope
      AND daily_credit_budget=(p_payload->>'expected')::int RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION '预算版本已变化，请刷新后重试'; END IF;
    v_result:=jsonb_build_object('user_id',v_scope,'daily_credit_budget',v_value);
  ELSIF p_action='grant' THEN
    IF coalesce(p_payload->>'role','') NOT IN ('finance','operations','risk','auditor') THEN RAISE EXCEPTION '角色非法'; END IF;
    INSERT INTO public.operator_grants(operator_id,role,scope_user_id,granted_by)
      VALUES((p_payload->>'operator_id')::uuid,p_payload->>'role',(p_payload->>'scope_user_id')::uuid,p_actor)
      ON CONFLICT(operator_id,role,scope_user_id) WHERE revoked_at IS NULL DO UPDATE SET revoked_at=NULL
      RETURNING id INTO v_id;
    v_result:=jsonb_build_object('grant_id',v_id);
  ELSE
    UPDATE public.operator_grants SET revoked_at=clock_timestamp() WHERE id=(p_payload->>'grant_id')::uuid
      AND revoked_at IS NULL RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION '角色授权不存在或已撤销'; END IF;
    v_result:=jsonb_build_object('grant_id',v_id,'revoked',true);
  END IF;
  INSERT INTO public.operator_mutations(request_key,actor_id,action,payload,result) VALUES(p_key,p_actor,p_action,p_payload,v_result);
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(p_actor,'operator_'||p_action,CASE WHEN p_action='budget' THEN 'user_plans' ELSE 'operator_grants' END,v_id,v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.deduct_credits(p_user_id uuid,p_amount int,p_action text DEFAULT 'AI视频生成')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_plan public.user_plans%ROWTYPE; v_charge uuid; v_left int; v_day_used bigint;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION '扣费积分必须为正整数'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION '禁止操作其他用户积分' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_plan FROM public.user_plans WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '未找到用户套餐计划'; END IF;
  v_left:=v_plan.credits_total-v_plan.credits_used;
  IF v_left<p_amount THEN RAISE EXCEPTION '积分不足：当前剩余 %，需要 %',v_left,p_amount; END IF;
  IF v_plan.daily_credit_budget>0 THEN
    SELECT coalesce(sum(-amount),0) INTO v_day_used FROM public.credit_logs WHERE user_id=p_user_id AND type='deduct'
      AND amount<0 AND action IS DISTINCT FROM 'cash_refund_revoke'
      AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    IF v_day_used+p_amount>v_plan.daily_credit_budget THEN RAISE EXCEPTION '日积分预算不足：当前已预占 %，上限 %',v_day_used,v_plan.daily_credit_budget; END IF;
  END IF;
  UPDATE public.user_plans SET credits_used=credits_used+p_amount WHERE user_id=p_user_id;
  INSERT INTO public.credit_logs(user_id,amount,type,action,description,credits_after,balance_after,billing_cycle_start)
    VALUES(p_user_id,-p_amount,'deduct',p_action,coalesce(p_action,'功能使用'),v_left-p_amount,v_left-p_amount,v_plan.cycle_start)
    RETURNING id INTO v_charge;
  RETURN jsonb_build_object('ok',true,'credits_left',v_left-p_amount,'charge_id',v_charge);
END;
$$;
REVOKE ALL ON FUNCTION public.operator_access(uuid),public.operator_list(uuid,text,int,uuid,text),
  public.operator_mutate(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.operator_access(uuid),public.operator_list(uuid,text,int,uuid,text),
  public.operator_mutate(uuid,uuid,text,jsonb) TO service_role;
COMMIT;
