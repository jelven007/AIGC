-- 微信完整交易链与两渠道共用退款权益事务。保留alipay_refunds表名以兼容历史账与接口。
BEGIN;
ALTER TABLE public.orders ADD COLUMN wechat_expires_at timestamptz,
  ADD COLUMN wechat_close_requested_at timestamptz;
CREATE TABLE public.wechat_transactions (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id),
  mchid text, appid text,
  lease_token uuid, lease_until timestamptz,
  next_query_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  needs_attention boolean NOT NULL DEFAULT false,
  evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wechat_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wechat_transactions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.wechat_transactions TO service_role;
CREATE INDEX wechat_transactions_due ON public.wechat_transactions(next_query_at);
-- 无原商户证据的历史订单禁止按新配置猜测外呼。签名成功通知仍可恢复原支付入账。
INSERT INTO public.wechat_transactions(order_id,needs_attention)
  SELECT id,true FROM public.orders WHERE pay_channel='wechat';

CREATE FUNCTION public.claim_wechat_order(p_actor uuid,p_order_no text,p_mchid text,p_appid text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%ROWTYPE; t public.wechat_transactions%ROWTYPE; n timestamptz:=clock_timestamp(); m text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_action NOT IN ('create','query','close')
    OR p_action IS NULL OR p_mchid IS NULL OR p_appid IS NULL THEN
    RAISE EXCEPTION '微信交易参数或权限非法' USING ERRCODE='42501';
  END IF;
  SELECT * INTO o FROM public.orders WHERE order_no=p_order_no FOR UPDATE;
  IF NOT FOUND OR o.pay_channel<>'wechat' THEN RAISE EXCEPTION '微信订单不存在'; END IF;
  IF p_actor IS NULL THEN
    IF p_action<>'query' THEN RAISE EXCEPTION '调度仅可核对原订单' USING ERRCODE='42501'; END IF;
  ELSIF o.user_id<>p_actor THEN PERFORM public.require_operator(p_actor,'refunds:write',o.user_id);
  ELSIF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND (banned_until IS NULL OR banned_until<=n)) THEN
    RAISE EXCEPTION '账号不可用' USING ERRCODE='42501';
  END IF;
  IF o.status<>'pending' THEN RETURN jsonb_build_object('mode','done','order',to_jsonb(o)); END IF;
  SELECT * INTO t FROM public.wechat_transactions WHERE order_id=o.id FOR UPDATE;
  IF NOT FOUND THEN
    IF p_action<>'create' OR p_actor IS NULL OR o.checkout_request_key IS NULL THEN
      RAISE EXCEPTION '原微信商户需要人工核对';
    END IF;
    UPDATE public.orders SET wechat_expires_at=o.created_at+interval '30 minutes' WHERE id=o.id RETURNING * INTO o;
    INSERT INTO public.wechat_transactions(order_id,mchid,appid) VALUES(o.id,p_mchid,p_appid) RETURNING * INTO t;
  END IF;
  IF t.mchid IS DISTINCT FROM p_mchid OR t.appid IS DISTINCT FROM p_appid THEN
    RAISE EXCEPTION '原微信商户或应用不匹配，需要人工核对' USING ERRCODE='22023';
  END IF;
  IF p_action='close' THEN
    UPDATE public.orders SET wechat_close_requested_at=coalesce(wechat_close_requested_at,n)
      WHERE id=o.id RETURNING * INTO o;
  END IF;
  IF p_action='create' AND o.wechat_pay_url IS NOT NULL
    AND o.wechat_expires_at>n AND o.wechat_close_requested_at IS NULL THEN
    RETURN jsonb_build_object('mode','done','order',to_jsonb(o));
  END IF;
  IF t.lease_until>n OR t.next_query_at>n AND p_action<>'close' THEN
    RETURN jsonb_build_object('mode','wait','order',to_jsonb(o));
  END IF;
  m:=CASE WHEN p_action='create' AND t.attempts=0 AND o.wechat_expires_at>n
    AND o.wechat_close_requested_at IS NULL THEN 'create' ELSE 'query' END;
  UPDATE public.wechat_transactions SET lease_token=gen_random_uuid(),lease_until=n+interval '90 seconds',
    next_query_at=n+interval '1 second'*least(600,10*power(2,least(attempts,6))),
    attempts=attempts+1,needs_attention=true WHERE order_id=o.id RETURNING * INTO t;
  RETURN jsonb_build_object('mode',m,'order',to_jsonb(o),'transaction',to_jsonb(t));
END;
$$;

CREATE FUNCTION public.finish_wechat_order(p_order uuid,p_lease uuid,p_evidence jsonb,p_code_url text DEFAULT NULL)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%ROWTYPE; t public.wechat_transactions%ROWTYPE; s text; n timestamptz:=clock_timestamp();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可核对微信订单' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT o FROM public.orders WHERE id=p_order FOR UPDATE;
  SELECT * INTO STRICT t FROM public.wechat_transactions WHERE order_id=p_order FOR UPDATE;
  IF p_lease IS NULL OR t.lease_token IS DISTINCT FROM p_lease OR t.lease_until<=n THEN RAISE EXCEPTION '微信订单租约已失效'; END IF;
  IF p_evidence IS NULL OR length(p_evidence::text)>2000 THEN RAISE EXCEPTION '微信订单证据非法'; END IF;
  s:=p_evidence->>'trade_state';
  IF s='CLOSED' THEN
    IF p_evidence->>'verified' IS DISTINCT FROM 'true'
      OR p_evidence->>'out_trade_no' IS DISTINCT FROM o.order_no
      OR p_evidence->>'mchid' IS DISTINCT FROM t.mchid
      OR p_evidence->>'appid' IS DISTINCT FROM t.appid THEN RAISE EXCEPTION '微信关闭证据不匹配'; END IF;
    IF o.status='pending' THEN
      UPDATE public.orders SET status='cancelled',wechat_pay_url=NULL,updated_at=n WHERE id=o.id RETURNING * INTO o;
      INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
        VALUES(o.user_id,'wechat_order_closed','orders',o.id,'{"status":"cancelled"}');
    END IF;
  END IF;
  IF p_code_url IS NOT NULL THEN
    IF p_evidence->>'verified' IS DISTINCT FROM 'true' OR p_code_url!~'^weixin://wxpay/bizpayurl[?]'
      OR length(p_code_url)>2048 THEN RAISE EXCEPTION '微信二维码证据非法'; END IF;
    IF o.status='pending' AND o.wechat_expires_at>n AND o.wechat_close_requested_at IS NULL THEN
      UPDATE public.orders SET wechat_pay_url=p_code_url,updated_at=n WHERE id=o.id RETURNING * INTO o;
    END IF;
  END IF;
  UPDATE public.wechat_transactions SET lease_token=NULL,lease_until=NULL,evidence=p_evidence,
    needs_attention=coalesce(p_evidence->>'verified','false')<>'true'
      OR coalesce(s,'') NOT IN ('NOTPAY','SUCCESS','CLOSED') AND p_code_url IS NULL,
    next_query_at=CASE WHEN o.status<>'pending' THEN n+interval '100 years'
      WHEN p_code_url IS NOT NULL OR s='NOTPAY' THEN n+interval '30 seconds' ELSE next_query_at END
    WHERE order_id=o.id;
  RETURN o;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_paid_order_guarded(p_actor uuid,p_order_no text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可关闭订单' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM public.orders WHERE order_no=p_order_no FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF o.user_id<>p_actor THEN PERFORM public.require_operator(p_actor,'refunds:write',o.user_id); END IF;
  IF o.pay_channel='wechat' THEN RAISE EXCEPTION '微信关单必须核对签名CLOSED结果'; END IF;
  IF o.status='pending' THEN
    UPDATE public.orders SET status='cancelled',updated_at=clock_timestamp() WHERE id=o.id;
    INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
      VALUES(p_actor,'cash_order_closed','orders',o.id,'{"status":"cancelled"}');
    RETURN 'cancelled';
  END IF;
  RETURN o.status;
END;
$$;

-- 服务端已验证的真实成功回调可以纠正关闭回执，迟到的关闭不能覆盖已发放/退款权益。
CREATE OR REPLACE FUNCTION public.finalize_paid_order(p_order_no text,p_pay_channel text,p_trade_no text,p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%ROWTYPE; u public.user_plans%ROWTYPE; c int; l int; b int;
  n timestamptz:=clock_timestamp(); cycle timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可入账' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM public.orders WHERE order_no=p_order_no;
  IF NOT FOUND THEN RAISE EXCEPTION '订单不存在'; END IF;
  SELECT * INTO STRICT u FROM public.user_plans WHERE user_id=o.user_id FOR UPDATE;
  SELECT * INTO STRICT o FROM public.orders WHERE order_no=p_order_no FOR UPDATE;
  IF p_pay_channel IS NULL OR p_pay_channel NOT IN ('alipay','wechat') OR o.pay_channel<>p_pay_channel
    OR p_amount IS NULL OR p_amount<=0 OR o.total_amount<>p_amount
    OR p_trade_no IS NULL OR btrim(p_trade_no)='' THEN RAISE EXCEPTION '支付渠道、金额或交易号校验失败'; END IF;
  IF o.provider_trade_no IS NOT NULL AND o.provider_trade_no<>p_trade_no THEN RAISE EXCEPTION '支付交易号与已有记录不符'; END IF;
  IF o.entitlement_granted_at IS NOT NULL THEN RETURN jsonb_build_object('outcome','already_processed','user_id',o.user_id); END IF;
  IF o.status<>'pending' AND NOT(o.status='cancelled' AND p_pay_channel='wechat') THEN
    RAISE EXCEPTION '订单状态不允许入账，请核对历史权益发放记录';
  END IF;
  IF o.plan_snapshot IS NULL OR NOT(o.plan_snapshot ?& ARRAY['id','name','credits','level'])
    OR (o.plan_snapshot->>'id')::uuid IS DISTINCT FROM o.plan_id THEN RAISE EXCEPTION '套餐快照非法'; END IF;
  c:=(o.plan_snapshot->>'credits')::int; l:=(o.plan_snapshot->>'level')::int;
  IF c IS NULL OR c<0 OR l IS NULL THEN RAISE EXCEPTION '套餐快照非法'; END IF;
  IF l<0 THEN
    cycle:=u.cycle_start;
    UPDATE public.user_plans SET credits_total=credits_total+c,updated_at=n
      WHERE user_id=o.user_id RETURNING credits_total-credits_used INTO b;
  ELSE
    cycle:=n;
    UPDATE public.user_plans SET plan_id=o.plan_id,credits_total=c-greatest(u.credits_used-u.credits_total,0),credits_used=0,
      cycle_start=n,cycle_end=n+interval '1 month',expires_at=n+interval '1 month',
      status='active',active_order_id=o.id,updated_at=n WHERE user_id=o.user_id RETURNING credits_total-credits_used INTO b;
  END IF;
  INSERT INTO public.credit_logs(user_id,amount,type,action,description,credits_after,balance_after,order_id,billing_cycle_start)
    VALUES(o.user_id,c,'purchase',CASE WHEN l<0 THEN 'booster_purchase' ELSE 'plan_purchase' END,
      format('%s购买：%s（订单 %s）',p_pay_channel,o.plan_snapshot->>'name',p_order_no),b,b,o.id,cycle);
  UPDATE public.orders SET status='paid',paid_at=n,updated_at=n,entitlement_granted_at=n,grant_cycle_start=cycle,
    provider_trade_no=p_trade_no,wechat_pay_url=NULL,
    alipay_trade_no=CASE WHEN p_pay_channel='alipay' THEN p_trade_no ELSE alipay_trade_no END WHERE id=o.id;
  RETURN jsonb_build_object('outcome','granted','user_id',o.user_id,'balance',b);
END;
$$;

ALTER TABLE public.alipay_refunds ADD COLUMN pay_channel text NOT NULL DEFAULT 'alipay'
  CHECK(pay_channel IN ('alipay','wechat')), ADD COLUMN provider_refund_id text, ADD COLUMN submitted_at timestamptz;
ALTER TABLE public.alipay_refunds DROP CONSTRAINT alipay_refunds_status_check;
ALTER TABLE public.alipay_refunds ADD CONSTRAINT alipay_refunds_status_check
  CHECK(status IN ('init','requested','success','unknown','closed'));
COMMENT ON TABLE public.alipay_refunds IS '两渠道共用现金退款预占、原申请与到账回执；保留历史表名以兼容支付宝旧账';
CREATE OR REPLACE VIEW public.cash_refund_receipts WITH (security_barrier=true) AS
  SELECT r.id,r.order_id,r.out_request_no,r.refund_amount,r.status,r.created_at,r.updated_at,
    r.applied_at,r.revoked_credits,r.needs_attention,r.pay_channel
  FROM public.alipay_refunds r JOIN public.orders o ON o.id=r.order_id WHERE o.user_id=auth.uid();

CREATE OR REPLACE FUNCTION public.reserve_cash_refund(p_actor uuid,p_order_no text,p_request_key uuid,p_amount numeric,p_reason text)
RETURNS public.alipay_refunds LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%ROWTYPE; r public.alipay_refunds%ROWTYPE; reserved numeric; success numeric;
BEGIN
  SELECT * INTO o FROM public.orders WHERE order_no=p_order_no;
  IF NOT FOUND THEN RAISE EXCEPTION '订单不存在'; END IF;
  PERFORM public.require_operator(p_actor,'refunds:write',o.user_id);
  PERFORM 1 FROM public.user_plans WHERE user_id=o.user_id FOR UPDATE;
  SELECT * INTO STRICT o FROM public.orders WHERE id=o.id FOR UPDATE;
  IF p_request_key IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
    OR p_amount<=0 OR p_amount<>round(p_amount,2) OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION '退款金额、原因或请求标识非法';
  END IF;
  SELECT * INTO r FROM public.alipay_refunds WHERE request_key=p_request_key;
  IF FOUND THEN
    IF r.order_id<>o.id OR r.refund_amount<>p_amount OR r.refund_reason<>btrim(p_reason) THEN
      RAISE EXCEPTION '同一请求标识不能修改订单、退款金额或原因';
    END IF;
    RETURN r;
  END IF;
  IF o.pay_channel NOT IN ('alipay','wechat') OR o.status NOT IN ('paid','partial_refunded')
    OR o.entitlement_granted_at IS NULL OR o.grant_cycle_start IS NULL OR o.provider_trade_no IS NULL THEN
    RAISE EXCEPTION '仅可信已支付订单可退款，历史权益需人工核对';
  END IF;
  IF o.pay_channel='wechat' AND (o.paid_at<clock_timestamp()-interval '365 days'
    OR NOT EXISTS(SELECT 1 FROM public.wechat_transactions WHERE order_id=o.id AND mchid IS NOT NULL AND appid IS NOT NULL)
    OR (SELECT count(*) FROM public.alipay_refunds WHERE order_id=o.id)>=50) THEN
    RAISE EXCEPTION '微信原商户、365天期限或50次退款上限需要核对';
  END IF;
  SELECT coalesce(sum(refund_amount) FILTER(WHERE status<>'closed'),0),
    coalesce(sum(refund_amount) FILTER(WHERE status='success'),0) INTO reserved,success
    FROM public.alipay_refunds WHERE order_id=o.id;
  IF success<>o.refunded_amount THEN RAISE EXCEPTION '历史累计退款不一致，需要人工核对'; END IF;
  IF reserved+p_amount>o.total_amount THEN RAISE EXCEPTION '累计退款和待确认退款不得超过实付金额'; END IF;
  INSERT INTO public.alipay_refunds(order_id,out_trade_no,out_request_no,request_key,refund_amount,refund_reason,operator_id,pay_channel)
    VALUES(o.id,o.order_no,'RF-'||p_request_key::text,p_request_key,p_amount,btrim(p_reason),p_actor,o.pay_channel) RETURNING * INTO r;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(p_actor,'cash_refund_reserved','alipay_refunds',r.id,jsonb_build_object('order_id',o.id,'amount',p_amount,'request_key',p_request_key,'channel',o.pay_channel));
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_cash_refund(p_actor uuid,p_order_no text,p_request_no text,p_submit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%ROWTYPE; r public.alipay_refunds%ROWTYPE; t public.wechat_transactions%ROWTYPE;
  m text; n timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO o FROM public.orders WHERE order_no=p_order_no;
  IF NOT FOUND THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF p_actor IS NULL THEN
    IF auth.role() IS DISTINCT FROM 'service_role' OR p_submit IS DISTINCT FROM false THEN
      RAISE EXCEPTION '内部调度仅可核对退款' USING ERRCODE='42501';
    END IF;
  ELSE PERFORM public.require_operator(p_actor,'refunds:write',o.user_id);
  END IF;
  PERFORM 1 FROM public.user_plans WHERE user_id=o.user_id FOR UPDATE;
  PERFORM 1 FROM public.orders WHERE id=o.id FOR UPDATE;
  SELECT * INTO r FROM public.alipay_refunds WHERE out_request_no=p_request_no AND order_id=o.id FOR UPDATE;
  IF NOT FOUND OR r.pay_channel<>o.pay_channel THEN RAISE EXCEPTION '退款记录不存在或渠道不符'; END IF;
  IF r.status='closed' OR r.status='success' AND r.applied_at IS NOT NULL THEN
    RETURN jsonb_build_object('mode','done','refund',to_jsonb(r));
  END IF;
  IF r.lease_until>n OR r.next_query_at>n THEN RETURN jsonb_build_object('mode','wait','refund',to_jsonb(r)); END IF;
  m:=CASE WHEN p_submit AND (r.status='init' OR r.evidence->>'method'='query'
    AND (r.pay_channel='alipay' OR r.evidence->>'code'='RESOURCE_NOT_EXISTS' AND r.evidence->>'verified'='true'))
    THEN 'refund' ELSE 'query' END;
  IF r.pay_channel='wechat' THEN
    SELECT * INTO STRICT t FROM public.wechat_transactions WHERE order_id=o.id;
    IF t.mchid IS NULL OR t.appid IS NULL THEN RAISE EXCEPTION '原微信商户需要人工核对'; END IF;
    IF m='refund' AND EXISTS(SELECT 1 FROM public.alipay_refunds WHERE order_id=o.id AND id<>r.id
      AND submitted_at>n-interval '1 minute') THEN
      UPDATE public.alipay_refunds SET next_query_at=n+interval '1 minute' WHERE id=r.id RETURNING * INTO r;
      RETURN jsonb_build_object('mode','wait','refund',to_jsonb(r));
    END IF;
  END IF;
  UPDATE public.alipay_refunds SET status=CASE WHEN status='success' THEN status ELSE 'requested' END,
    lease_token=gen_random_uuid(),lease_until=n+interval '90 seconds',
    submitted_at=CASE WHEN m='refund' THEN n ELSE submitted_at END,
    next_query_at=n+interval '1 second'*CASE WHEN r.pay_channel='wechat' THEN least(1800,60*power(2,least(attempts,5)))
      ELSE least(600,10*power(2,least(attempts,6))) END,
    needs_attention=true,attempts=attempts+1,updated_at=n WHERE id=r.id RETURNING * INTO r;
  RETURN jsonb_build_object('mode',m,'refund',to_jsonb(r),'trade_no',o.provider_trade_no,
    'total_amount',o.total_amount,'mchid',t.mchid,'appid',t.appid);
END;
$$;

-- 只供已校验渠道证据的完成函数调用，统一两渠道的比例回收/欠额/周期与原子审计。
CREATE FUNCTION public.apply_cash_refund(p_refund uuid,p_evidence jsonb)
RETURNS public.alipay_refunds LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.alipay_refunds%ROWTYPE; o public.orders%ROWTYPE; u public.user_plans%ROWTYPE;
  total numeric; target int; delta int; active_delta int; balance int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可入账退款' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT r FROM public.alipay_refunds WHERE id=p_refund;
  SELECT * INTO STRICT o FROM public.orders WHERE id=r.order_id;
  SELECT * INTO STRICT u FROM public.user_plans WHERE user_id=o.user_id FOR UPDATE;
  SELECT * INTO STRICT o FROM public.orders WHERE id=o.id FOR UPDATE;
  SELECT * INTO STRICT r FROM public.alipay_refunds WHERE id=p_refund FOR UPDATE;
  IF r.applied_at IS NOT NULL THEN RETURN r; END IF;
  SELECT coalesce(sum(refund_amount),0)+r.refund_amount INTO total FROM public.alipay_refunds
    WHERE order_id=o.id AND status='success' AND id<>p_refund;
  IF total>o.total_amount OR total<o.refunded_amount OR o.grant_cycle_start IS NULL OR o.entitlement_granted_at IS NULL THEN
    RAISE EXCEPTION '退款累计或历史权益需要人工核对';
  END IF;
  target:=floor((o.plan_snapshot->>'credits')::numeric*total/o.total_amount)::int;
  delta:=target-o.entitlement_revoked_credits;
  IF delta<0 THEN RAISE EXCEPTION '权益回收累计异常'; END IF;
  active_delta:=CASE WHEN u.cycle_start=o.grant_cycle_start THEN delta ELSE 0 END;
  UPDATE public.user_plans SET credits_total=credits_total-active_delta,
    plan_id=CASE WHEN total=o.total_amount AND active_order_id=o.id
      THEN (SELECT id FROM public.plans WHERE level=0 AND price=0 ORDER BY created_at LIMIT 1) ELSE plan_id END,
    active_order_id=CASE WHEN total=o.total_amount AND active_order_id=o.id THEN NULL ELSE active_order_id END,
    expires_at=CASE WHEN total=o.total_amount AND active_order_id=o.id THEN clock_timestamp() ELSE expires_at END,
    updated_at=clock_timestamp() WHERE user_id=o.user_id RETURNING credits_total-credits_used INTO balance;
  IF delta>0 THEN
    INSERT INTO public.credit_logs(user_id,amount,type,action,description,credits_after,balance_after,billing_cycle_start)
      VALUES(o.user_id,-active_delta,'deduct','cash_refund_revoke',
        format('现金退款 %s：回收 %s 积分；本周期扣回 %s',r.out_request_no,delta,active_delta),balance,balance,o.grant_cycle_start);
  END IF;
  UPDATE public.orders SET refunded_amount=total,status=CASE WHEN total=total_amount THEN 'refunded'::public.order_status
    ELSE 'partial_refunded'::public.order_status END,entitlement_revoked_credits=target,updated_at=clock_timestamp() WHERE id=o.id;
  UPDATE public.alipay_refunds SET status='success',applied_at=clock_timestamp(),revoked_credits=delta,evidence=p_evidence,
    needs_attention=false,fund_change=p_evidence->>'fund_change',
    alipay_trade_no=CASE WHEN pay_channel='alipay' THEN o.provider_trade_no ELSE NULL END,
    provider_refund_id=coalesce(provider_refund_id,p_evidence->>'refund_id'),
    lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=p_refund RETURNING * INTO r;
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(r.operator_id,'cash_refund_applied','alipay_refunds',r.id,jsonb_build_object('amount',r.refund_amount,
      'cumulative',total,'revoked_credits',delta,'active_delta',active_delta,'channel',r.pay_channel));
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_cash_refund(p_refund uuid,p_lease uuid,p_evidence jsonb)
RETURNS public.alipay_refunds LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.alipay_refunds%ROWTYPE; o public.orders%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可确认退款' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT r FROM public.alipay_refunds WHERE id=p_refund;
  SELECT * INTO STRICT o FROM public.orders WHERE id=r.order_id;
  PERFORM 1 FROM public.user_plans WHERE user_id=o.user_id FOR UPDATE;
  PERFORM 1 FROM public.orders WHERE id=o.id FOR UPDATE;
  SELECT * INTO STRICT r FROM public.alipay_refunds WHERE id=p_refund FOR UPDATE;
  IF r.pay_channel<>'alipay' THEN RAISE EXCEPTION '退款渠道不匹配'; END IF;
  IF r.applied_at IS NOT NULL THEN RETURN r; END IF;
  IF p_lease IS NULL OR r.lease_token IS DISTINCT FROM p_lease OR r.lease_until<=clock_timestamp() THEN RAISE EXCEPTION '退款租约已失效'; END IF;
  IF p_evidence IS NULL OR length(p_evidence::text)>2000 OR coalesce(p_evidence->>'outcome','') NOT IN ('success','unknown') THEN
    RAISE EXCEPTION '退款证据非法';
  END IF;
  IF p_evidence->>'outcome'<>'success' THEN
    UPDATE public.alipay_refunds SET status=CASE WHEN status='success' THEN status ELSE 'unknown' END,
      needs_attention=true,evidence=p_evidence,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
      WHERE id=p_refund RETURNING * INTO r;
    RETURN r;
  END IF;
  IF p_evidence->>'code' IS DISTINCT FROM '10000' OR p_evidence->>'verified' IS DISTINCT FROM 'true'
    OR p_evidence->>'trade_no' IS DISTINCT FROM o.provider_trade_no OR p_evidence->>'out_trade_no' IS DISTINCT FROM o.order_no
    OR p_evidence->>'out_request_no' IS DISTINCT FROM r.out_request_no
    OR (p_evidence->>'amount')::numeric IS DISTINCT FROM r.refund_amount
    OR (p_evidence->>'method'='query' AND p_evidence->>'refund_status' IS DISTINCT FROM 'REFUND_SUCCESS')
    OR (p_evidence->>'method'='refund' AND p_evidence->>'fund_change' IS DISTINCT FROM 'Y')
    OR coalesce(p_evidence->>'method','') NOT IN ('refund','query') THEN RAISE EXCEPTION '退款到账证据与原申请不符'; END IF;
  RETURN public.apply_cash_refund(p_refund,p_evidence);
END;
$$;

CREATE FUNCTION public.finish_wechat_refund(p_refund uuid,p_lease uuid,p_evidence jsonb)
RETURNS public.alipay_refunds LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.alipay_refunds%ROWTYPE; o public.orders%ROWTYPE; t public.wechat_transactions%ROWTYPE; s text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可确认微信退款' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT r FROM public.alipay_refunds WHERE id=p_refund;
  SELECT * INTO STRICT o FROM public.orders WHERE id=r.order_id;
  PERFORM 1 FROM public.user_plans WHERE user_id=o.user_id FOR UPDATE;
  SELECT * INTO STRICT o FROM public.orders WHERE id=o.id FOR UPDATE;
  SELECT * INTO STRICT r FROM public.alipay_refunds WHERE id=p_refund FOR UPDATE;
  SELECT * INTO STRICT t FROM public.wechat_transactions WHERE order_id=o.id;
  IF r.pay_channel<>'wechat' OR o.pay_channel<>'wechat' THEN RAISE EXCEPTION '退款渠道不匹配'; END IF;
  IF p_evidence IS NULL OR length(p_evidence::text)>2000 OR coalesce(p_evidence->>'method','') NOT IN ('refund','query','notify') THEN
    RAISE EXCEPTION '微信退款证据非法';
  END IF;
  IF p_evidence->>'method'<>'notify' AND r.applied_at IS NULL AND r.status<>'closed' AND
    (p_lease IS NULL OR r.lease_token IS DISTINCT FROM p_lease OR r.lease_until<=clock_timestamp()) THEN
    RAISE EXCEPTION '退款租约已失效';
  END IF;
  s:=p_evidence->>'refund_status';
  IF coalesce(s,'') IN ('SUCCESS','CLOSED','PROCESSING','ABNORMAL') THEN
    IF p_evidence->>'verified' IS DISTINCT FROM 'true' OR p_evidence->>'mchid' IS DISTINCT FROM t.mchid
      OR p_evidence->>'trade_no' IS DISTINCT FROM o.provider_trade_no OR p_evidence->>'out_trade_no' IS DISTINCT FROM o.order_no
      OR p_evidence->>'out_request_no' IS DISTINCT FROM r.out_request_no
      OR (p_evidence->>'amount')::numeric IS DISTINCT FROM r.refund_amount
      OR (p_evidence->>'total_amount')::numeric IS DISTINCT FROM o.total_amount
      OR coalesce(p_evidence->>'refund_id','')!~'^[A-Za-z0-9_-]{1,64}$'
      OR r.provider_refund_id IS NOT NULL AND r.provider_refund_id IS DISTINCT FROM p_evidence->>'refund_id' THEN
      RAISE EXCEPTION '微信退款证据与原申请不符';
    END IF;
  ELSIF p_evidence->>'method'='notify' THEN RAISE EXCEPTION '微信退款通知状态非法';
  END IF;
  IF r.applied_at IS NOT NULL THEN RETURN r; END IF;
  IF s='SUCCESS' THEN RETURN public.apply_cash_refund(p_refund,p_evidence); END IF;
  IF r.status='closed' THEN RETURN r; END IF;
  UPDATE public.alipay_refunds SET status=CASE WHEN s='CLOSED' THEN 'closed' ELSE 'unknown' END,
    needs_attention=s IS DISTINCT FROM 'CLOSED',evidence=p_evidence,
    provider_refund_id=coalesce(provider_refund_id,p_evidence->>'refund_id'),
    lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=p_refund RETURNING * INTO r;
  IF s='CLOSED' THEN
    INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_data)
      VALUES(r.operator_id,'wechat_refund_closed','alipay_refunds',r.id,jsonb_build_object('amount',r.refund_amount));
  END IF;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_wechat_order(uuid,text,text,text,text),public.finish_wechat_order(uuid,uuid,jsonb,text),
  public.finish_wechat_refund(uuid,uuid,jsonb),public.apply_cash_refund(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wechat_order(uuid,text,text,text,text),public.finish_wechat_order(uuid,uuid,jsonb,text),
  public.finish_wechat_refund(uuid,uuid,jsonb) TO service_role;
-- apply_cash_refund只能由SECURITY DEFINER渠道函数调用，服务角色不能绕过证据入口。
REVOKE ALL ON FUNCTION public.apply_cash_refund(uuid,jsonb) FROM service_role;
COMMIT;
