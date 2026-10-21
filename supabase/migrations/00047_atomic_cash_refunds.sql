-- 现金退款：原请求绑定、金额预占、租约/核对、到账与权益回收同事务。
-- 运营角色来源仅为 auth.users 服务端元数据或本表授权；profile.role 不参与。
BEGIN;

CREATE TABLE public.operator_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('finance','operations','risk','auditor')),
  scope_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX operator_grants_active ON public.operator_grants(operator_id,role,scope_user_id)
  NULLS NOT DISTINCT WHERE revoked_at IS NULL;
ALTER TABLE public.operator_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_grants FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.operator_grants TO service_role;

CREATE FUNCTION public.operator_can(p_actor uuid,p_permission text,p_scope uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor
    AND (u.banned_until IS NULL OR u.banned_until<=now())
    AND (u.raw_app_meta_data->>'role'='admin' OR EXISTS(
      SELECT 1 FROM public.operator_grants g WHERE g.operator_id=u.id AND g.revoked_at IS NULL
        AND (g.scope_user_id IS NULL OR g.scope_user_id=p_scope)
        AND CASE g.role
          WHEN 'finance' THEN p_permission IN ('orders:read','refunds:write','credits:read')
          WHEN 'operations' THEN p_permission IN ('customers:read','jobs:read','budgets:write')
          WHEN 'risk' THEN p_permission='risk:read'
          WHEN 'auditor' THEN p_permission IN ('orders:read','credits:read','customers:read','jobs:read','risk:read','audit:read')
          ELSE false END
    )));
$$;
REVOKE ALL ON FUNCTION public.operator_can(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.operator_can(uuid,text,uuid) TO service_role;

CREATE FUNCTION public.require_operator(p_actor uuid,p_permission text,p_scope uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.operator_can(p_actor,p_permission,p_scope) THEN
    RAISE EXCEPTION '无运营权限' USING ERRCODE='42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.require_operator(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.require_operator(uuid,text,uuid) TO service_role;

ALTER TABLE public.orders ADD COLUMN grant_cycle_start timestamptz,
  ADD COLUMN entitlement_revoked_credits integer NOT NULL DEFAULT 0 CHECK(entitlement_revoked_credits>=0);
ALTER TABLE public.user_plans ADD COLUMN active_order_id uuid REFERENCES public.orders(id);
-- 历史记录只绑定能与当前周期明确对应的订单；无法确定的记录必须人工核对。
UPDATE public.orders SET grant_cycle_start=entitlement_granted_at
  WHERE entitlement_granted_at IS NOT NULL AND (plan_snapshot->>'level')::int>=0;
UPDATE public.user_plans up SET active_order_id=o.id FROM public.orders o
  WHERE up.user_id=o.user_id AND up.cycle_start=o.grant_cycle_start;
UPDATE public.orders o SET grant_cycle_start=up.cycle_start FROM public.user_plans up
  WHERE o.user_id=up.user_id AND (o.plan_snapshot->>'level')::int<0
    AND o.entitlement_granted_at>=up.cycle_start AND o.entitlement_granted_at<up.cycle_end;

ALTER TABLE public.alipay_refunds
  ADD COLUMN request_key uuid,
  ADD COLUMN operator_id uuid REFERENCES auth.users(id),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN next_query_at timestamptz,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN needs_attention boolean NOT NULL DEFAULT false,
  ADD COLUMN evidence jsonb,
  ADD COLUMN applied_at timestamptz,
  ADD COLUMN revoked_credits integer NOT NULL DEFAULT 0 CHECK(revoked_credits>=0);
CREATE UNIQUE INDEX alipay_refunds_request_key ON public.alipay_refunds(request_key) WHERE request_key IS NOT NULL;
UPDATE public.alipay_refunds SET needs_attention=true,next_query_at=now() WHERE status<>'init';
CREATE INDEX alipay_refunds_due ON public.alipay_refunds(next_query_at)
  WHERE status IN ('requested','unknown');
REVOKE ALL ON public.alipay_refunds FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.alipay_refunds TO service_role;
-- 用户仅能读取自己的安全回执，不暴露供应商证据或运营主体。
CREATE VIEW public.cash_refund_receipts WITH (security_barrier=true) AS
  SELECT r.id,r.order_id,r.out_request_no,r.refund_amount,r.status,r.created_at,r.updated_at,
    r.applied_at,r.revoked_credits,r.needs_attention
  FROM public.alipay_refunds r JOIN public.orders o ON o.id=r.order_id WHERE o.user_id=auth.uid();
REVOKE ALL ON public.cash_refund_receipts FROM PUBLIC,anon;
GRANT SELECT ON public.cash_refund_receipts TO authenticated,service_role;

-- 套餐入账统一先锁账户再锁订单；换周期保留现金退款造成的欠额。
CREATE OR REPLACE FUNCTION public.finalize_paid_order(
  p_order_no text,p_pay_channel text,p_trade_no text,p_amount numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_order public.orders%ROWTYPE; v_up public.user_plans%ROWTYPE;
  v_credits int; v_level int; v_balance int; v_now timestamptz:=clock_timestamp(); v_cycle timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可入账' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE order_no=p_order_no;
  IF NOT FOUND THEN RAISE EXCEPTION '订单不存在'; END IF;
  SELECT * INTO STRICT v_up FROM public.user_plans WHERE user_id=v_order.user_id FOR UPDATE;
  SELECT * INTO STRICT v_order FROM public.orders WHERE order_no=p_order_no FOR UPDATE;
  IF p_pay_channel IS NULL OR p_pay_channel NOT IN ('alipay','wechat') OR v_order.pay_channel<>p_pay_channel
    OR p_amount IS NULL OR p_amount<=0 OR v_order.total_amount<>p_amount
    OR p_trade_no IS NULL OR btrim(p_trade_no)='' THEN RAISE EXCEPTION '支付渠道、金额或交易号校验失败'; END IF;
  IF v_order.provider_trade_no IS NOT NULL AND v_order.provider_trade_no<>p_trade_no THEN
    RAISE EXCEPTION '支付交易号与已有记录不符';
  END IF;
  IF v_order.entitlement_granted_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome','already_processed','user_id',v_order.user_id);
  END IF;
  IF v_order.status<>'pending' THEN RAISE EXCEPTION '订单状态不允许入账，请核对历史权益发放记录'; END IF;
  IF v_order.plan_snapshot IS NULL OR NOT(v_order.plan_snapshot ?& ARRAY['id','name','credits','level'])
    OR (v_order.plan_snapshot->>'id')::uuid IS DISTINCT FROM v_order.plan_id THEN RAISE EXCEPTION '套餐快照非法'; END IF;
  v_credits:=(v_order.plan_snapshot->>'credits')::int; v_level:=(v_order.plan_snapshot->>'level')::int;
  IF v_credits IS NULL OR v_credits<0 OR v_level IS NULL THEN RAISE EXCEPTION '套餐快照非法'; END IF;
  IF v_level<0 THEN
    v_cycle:=v_up.cycle_start;
    UPDATE public.user_plans SET credits_total=credits_total+v_credits,updated_at=v_now
      WHERE user_id=v_order.user_id RETURNING credits_total-credits_used INTO v_balance;
  ELSE
    v_cycle:=v_now;
    UPDATE public.user_plans SET plan_id=v_order.plan_id,
      credits_total=v_credits-greatest(v_up.credits_used-v_up.credits_total,0),credits_used=0,
      cycle_start=v_now,cycle_end=v_now+interval '1 month',expires_at=v_now+interval '1 month',
      status='active',active_order_id=v_order.id,updated_at=v_now
      WHERE user_id=v_order.user_id RETURNING credits_total-credits_used INTO v_balance;
  END IF;
  INSERT INTO public.credit_logs(user_id,amount,type,action,description,credits_after,balance_after,order_id,billing_cycle_start)
  VALUES(v_order.user_id,v_credits,'purchase',CASE WHEN v_level<0 THEN 'booster_purchase' ELSE 'plan_purchase' END,
    format('%s购买：%s（订单 %s）',p_pay_channel,v_order.plan_snapshot->>'name',p_order_no),
    v_balance,v_balance,v_order.id,v_cycle);
  UPDATE public.orders SET status='paid',paid_at=v_now,updated_at=v_now,entitlement_granted_at=v_now,
    grant_cycle_start=v_cycle,provider_trade_no=p_trade_no,
    alipay_trade_no=CASE WHEN p_pay_channel='alipay' THEN p_trade_no ELSE alipay_trade_no END WHERE id=v_order.id;
  RETURN jsonb_build_object('outcome','granted','user_id',v_order.user_id,'balance',v_balance);
END;
$$;

CREATE FUNCTION public.reserve_cash_refund(p_actor uuid,p_order_no text,p_request_key uuid,p_amount numeric,p_reason text)
RETURNS public.alipay_refunds LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders%ROWTYPE; v_row public.alipay_refunds%ROWTYPE; v_reserved numeric; v_success numeric;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_no=p_order_no;
  IF NOT FOUND THEN RAISE EXCEPTION '订单不存在'; END IF;
  PERFORM public.require_operator(p_actor,'refunds:write',v_order.user_id);
  PERFORM 1 FROM public.user_plans WHERE user_id=v_order.user_id FOR UPDATE;
  SELECT * INTO STRICT v_order FROM public.orders WHERE id=v_order.id FOR UPDATE;
  IF p_request_key IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
    OR p_amount<=0 OR p_amount<>round(p_amount,2) OR p_reason IS NULL
    OR length(btrim(p_reason)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '退款金额、原因或请求标识非法'; END IF;
  SELECT * INTO v_row FROM public.alipay_refunds WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_row.order_id<>v_order.id OR v_row.refund_amount<>p_amount OR v_row.refund_reason<>btrim(p_reason) THEN
      RAISE EXCEPTION '同一请求标识不能修改订单、退款金额或原因';
    END IF;
    RETURN v_row;
  END IF;
  IF v_order.pay_channel<>'alipay' OR v_order.status NOT IN ('paid','partial_refunded')
    OR v_order.entitlement_granted_at IS NULL OR v_order.grant_cycle_start IS NULL
    OR v_order.provider_trade_no IS NULL THEN RAISE EXCEPTION '仅可信已支付支付宝订单可退款，历史权益需人工核对'; END IF;
  SELECT coalesce(sum(refund_amount),0),coalesce(sum(refund_amount) FILTER(WHERE status='success'),0)
    INTO v_reserved,v_success FROM public.alipay_refunds WHERE order_id=v_order.id;
  IF v_success<>v_order.refunded_amount THEN RAISE EXCEPTION '历史累计退款不一致，需要人工核对'; END IF;
  IF v_reserved+p_amount>v_order.total_amount THEN RAISE EXCEPTION '累计退款和待确认退款不得超过实付金额'; END IF;
  INSERT INTO public.alipay_refunds(order_id,out_trade_no,out_request_no,request_key,refund_amount,refund_reason,operator_id)
    VALUES(v_order.id,v_order.order_no,'RF-'||p_request_key::text,p_request_key,p_amount,btrim(p_reason),p_actor)
    RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(p_actor,'cash_refund_reserved','alipay_refunds',v_row.id,
      jsonb_build_object('order_id',v_order.id,'amount',p_amount,'request_key',p_request_key));
  RETURN v_row;
END;
$$;

CREATE FUNCTION public.claim_cash_refund(p_actor uuid,p_order_no text,p_request_no text,p_submit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders%ROWTYPE; v_row public.alipay_refunds%ROWTYPE; v_mode text; v_now timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_no=p_order_no;
  IF NOT FOUND THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF p_actor IS NULL THEN
    IF auth.role() IS DISTINCT FROM 'service_role' OR p_submit IS DISTINCT FROM false THEN
      RAISE EXCEPTION '内部调度仅可核对退款' USING ERRCODE='42501';
    END IF;
  ELSE PERFORM public.require_operator(p_actor,'refunds:write',v_order.user_id);
  END IF;
  PERFORM 1 FROM public.user_plans WHERE user_id=v_order.user_id FOR UPDATE;
  PERFORM 1 FROM public.orders WHERE id=v_order.id FOR UPDATE;
  SELECT * INTO v_row FROM public.alipay_refunds WHERE out_request_no=p_request_no AND order_id=v_order.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '退款记录不存在'; END IF;
  IF v_row.status='success' AND v_row.applied_at IS NOT NULL THEN
    RETURN jsonb_build_object('mode','done','refund',to_jsonb(v_row));
  END IF;
  IF v_row.lease_until>v_now OR v_row.next_query_at>v_now THEN
    RETURN jsonb_build_object('mode','wait','refund',to_jsonb(v_row));
  END IF;
  -- 重试先查询，查询后仍未知才允许以原编号重发；金额始终取原申请。
  v_mode:=CASE WHEN p_submit AND (v_row.status='init' OR v_row.evidence->>'method'='query')
    THEN 'refund' ELSE 'query' END;
  UPDATE public.alipay_refunds SET status=CASE WHEN status='success' THEN status ELSE 'requested' END,
    lease_token=gen_random_uuid(),lease_until=v_now+interval '60 seconds',
    next_query_at=v_now+interval '1 second'*least(600,10*power(2,least(attempts,6))),
    needs_attention=true,attempts=attempts+1,updated_at=v_now WHERE id=v_row.id RETURNING * INTO v_row;
  RETURN jsonb_build_object('mode',v_mode,'refund',to_jsonb(v_row),'trade_no',v_order.provider_trade_no);
END;
$$;

CREATE FUNCTION public.finish_cash_refund(p_refund uuid,p_lease uuid,p_evidence jsonb)
RETURNS public.alipay_refunds LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_row public.alipay_refunds%ROWTYPE; v_order public.orders%ROWTYPE; v_up public.user_plans%ROWTYPE;
  v_total numeric; v_target int; v_delta int; v_active_delta int; v_balance int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可确认退款' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.alipay_refunds WHERE id=p_refund;
  IF NOT FOUND THEN RAISE EXCEPTION '退款记录不存在'; END IF;
  SELECT * INTO STRICT v_order FROM public.orders WHERE id=v_row.order_id;
  SELECT * INTO STRICT v_up FROM public.user_plans WHERE user_id=v_order.user_id FOR UPDATE;
  SELECT * INTO STRICT v_order FROM public.orders WHERE id=v_order.id FOR UPDATE;
  SELECT * INTO STRICT v_row FROM public.alipay_refunds WHERE id=p_refund FOR UPDATE;
  IF v_row.applied_at IS NOT NULL THEN RETURN v_row; END IF;
  IF p_lease IS NULL OR v_row.lease_token IS DISTINCT FROM p_lease OR v_row.lease_until<clock_timestamp() THEN
    RAISE EXCEPTION '退款租约已失效';
  END IF;
  IF p_evidence IS NULL OR length(p_evidence::text)>2000
    OR coalesce(p_evidence->>'outcome','') NOT IN ('success','unknown') THEN RAISE EXCEPTION '退款证据非法'; END IF;
  IF p_evidence->>'outcome'<>'success' THEN
    UPDATE public.alipay_refunds SET status=CASE WHEN status='success' THEN status ELSE 'unknown' END,
      needs_attention=true,evidence=p_evidence,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
      WHERE id=p_refund RETURNING * INTO v_row;
    RETURN v_row;
  END IF;
  -- RPC 再绑定查询结果：无 code/交易号/订单号/精确金额，绝不能入账。
  IF p_evidence->>'code' IS DISTINCT FROM '10000' OR p_evidence->>'verified' IS DISTINCT FROM 'true'
    OR p_evidence->>'trade_no' IS DISTINCT FROM v_order.provider_trade_no
    OR p_evidence->>'out_trade_no' IS DISTINCT FROM v_order.order_no
    OR p_evidence->>'out_request_no' IS DISTINCT FROM v_row.out_request_no
    OR (p_evidence->>'amount')::numeric IS DISTINCT FROM v_row.refund_amount
    OR (p_evidence->>'method'='query' AND p_evidence->>'refund_status' IS DISTINCT FROM 'REFUND_SUCCESS')
    OR (p_evidence->>'method'='refund' AND p_evidence->>'fund_change' IS DISTINCT FROM 'Y')
    OR coalesce(p_evidence->>'method','') NOT IN ('refund','query') THEN RAISE EXCEPTION '退款到账证据与原申请不符'; END IF;
  SELECT coalesce(sum(refund_amount),0) INTO v_total FROM public.alipay_refunds
    WHERE order_id=v_order.id AND status='success' AND id<>p_refund;
  v_total:=v_total+v_row.refund_amount;
  IF v_total>v_order.total_amount OR v_total<v_order.refunded_amount OR v_order.grant_cycle_start IS NULL
    OR v_order.entitlement_granted_at IS NULL THEN RAISE EXCEPTION '退款累计或历史权益需要人工核对'; END IF;
  v_target:=floor((v_order.plan_snapshot->>'credits')::numeric*v_total/v_order.total_amount)::int;
  v_delta:=v_target-v_order.entitlement_revoked_credits;
  IF v_delta<0 THEN RAISE EXCEPTION '权益回收累计异常'; END IF;
  -- 已换周期的权益已失效；不能扣走新套餐。当前周期允许负余额表示已消费欠额，
  -- 下一次充值抵扣该欠额，禁止把负余额裁为零而丢失债务。
  v_active_delta:=CASE WHEN v_up.cycle_start=v_order.grant_cycle_start THEN v_delta ELSE 0 END;
  UPDATE public.user_plans SET credits_total=credits_total-v_active_delta,
    plan_id=CASE WHEN v_total=v_order.total_amount AND active_order_id=v_order.id
      THEN (SELECT id FROM public.plans WHERE level=0 AND price=0 ORDER BY created_at LIMIT 1) ELSE plan_id END,
    active_order_id=CASE WHEN v_total=v_order.total_amount AND active_order_id=v_order.id THEN NULL ELSE active_order_id END,
    expires_at=CASE WHEN v_total=v_order.total_amount AND active_order_id=v_order.id THEN clock_timestamp() ELSE expires_at END,
    updated_at=clock_timestamp() WHERE user_id=v_order.user_id RETURNING credits_total-credits_used INTO v_balance;
  IF v_delta>0 THEN
    INSERT INTO public.credit_logs(user_id,amount,type,action,description,credits_after,balance_after,billing_cycle_start)
      VALUES(v_order.user_id,-v_active_delta,'deduct','cash_refund_revoke',
        format('现金退款 %s：回收 %s 积分；本周期扣回 %s',v_row.out_request_no,v_delta,v_active_delta),
        v_balance,v_balance,v_order.grant_cycle_start);
  END IF;
  UPDATE public.orders SET refunded_amount=v_total,
    status=CASE WHEN v_total=total_amount THEN 'refunded'::public.order_status ELSE 'partial_refunded'::public.order_status END,
    entitlement_revoked_credits=v_target,updated_at=clock_timestamp() WHERE id=v_order.id;
  UPDATE public.alipay_refunds SET status='success',applied_at=clock_timestamp(),revoked_credits=v_delta,
    evidence=p_evidence,needs_attention=false,fund_change=p_evidence->>'fund_change',
    alipay_trade_no=v_order.provider_trade_no,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE id=p_refund RETURNING * INTO v_row;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(v_row.operator_id,'cash_refund_applied','alipay_refunds',v_row.id,
      jsonb_build_object('amount',v_row.refund_amount,'cumulative',v_total,'revoked_credits',v_delta,'active_delta',v_active_delta));
  RETURN v_row;
END;
$$;

CREATE FUNCTION public.close_paid_order_guarded(p_actor uuid,p_order_no text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可关闭订单' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE order_no=p_order_no FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF v_order.user_id<>p_actor THEN PERFORM public.require_operator(p_actor,'refunds:write',v_order.user_id); END IF;
  IF v_order.status='pending' THEN
    UPDATE public.orders SET status='cancelled',updated_at=clock_timestamp() WHERE id=v_order.id;
    INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
      VALUES(p_actor,'cash_order_closed','orders',v_order.id,'{"status":"cancelled"}');
    RETURN 'cancelled';
  END IF;
  RETURN v_order.status;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_cash_refund(uuid,text,uuid,numeric,text),
  public.claim_cash_refund(uuid,text,text,boolean),public.finish_cash_refund(uuid,uuid,jsonb),
  public.close_paid_order_guarded(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_cash_refund(uuid,text,uuid,numeric,text),
  public.claim_cash_refund(uuid,text,text,boolean),public.finish_cash_refund(uuid,uuid,jsonb),
  public.close_paid_order_guarded(uuid,text) TO service_role;
COMMIT;
