-- 真实收银入口：原请求绑定/价格确认/待支付配额；资金仍由原支付事务入账。
BEGIN;
ALTER TABLE public.orders ADD COLUMN checkout_request_key uuid;
CREATE UNIQUE INDEX orders_checkout_request ON public.orders(user_id,checkout_request_key)
  WHERE checkout_request_key IS NOT NULL;

CREATE FUNCTION public.begin_checkout_order(
  p_actor uuid, p_request_key uuid, p_channel text, p_plan_id uuid, p_expected_amount numeric, p_expected_credits integer
) RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders%ROWTYPE; v_plan public.plans%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_request_key IS NULL OR p_plan_id IS NULL
    OR p_channel IS NULL OR p_channel NOT IN ('alipay','wechat')
    OR p_expected_amount IS NULL OR p_expected_amount::text IN ('NaN','Infinity','-Infinity')
    OR p_expected_amount<=0 OR p_expected_amount<>round(p_expected_amount,2)
    OR p_expected_credits IS NULL OR p_expected_credits<0 THEN
    RAISE EXCEPTION '支付参数非法' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor
    AND (banned_until IS NULL OR banned_until<=now())) THEN
    RAISE EXCEPTION '账号不可用' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('checkout:'||p_actor::text,0));
  SELECT * INTO v_order FROM public.orders
    WHERE user_id=p_actor AND checkout_request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF v_order.plan_id IS DISTINCT FROM p_plan_id OR v_order.pay_channel IS DISTINCT FROM p_channel
      OR v_order.total_amount IS DISTINCT FROM p_expected_amount
      OR (v_order.plan_snapshot->>'credits')::int IS DISTINCT FROM p_expected_credits THEN
      RAISE EXCEPTION '原支付请求参数已变更，请先核对原订单' USING ERRCODE='22023';
    END IF;
    RETURN v_order;
  END IF;
  SELECT * INTO v_plan FROM public.plans WHERE id=p_plan_id FOR SHARE;
  IF NOT FOUND OR v_plan.price<>p_expected_amount OR v_plan.price<=0 OR v_plan.credits<0
    OR v_plan.credits<>p_expected_credits THEN
    RAISE EXCEPTION '套餐价格或积分已变更，请刷新套餐后重新确认' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM public.orders WHERE user_id=p_actor AND status='pending')>=10 THEN
    RAISE EXCEPTION '待支付订单已达上限，请先处理原订单' USING ERRCODE='54000';
  END IF;
  INSERT INTO public.orders(order_no,user_id,plan_id,status,total_amount,pay_channel,checkout_request_key)
    VALUES(replace(gen_random_uuid()::text,'-',''),p_actor,p_plan_id,'pending',
      v_plan.price,p_channel,p_request_key) RETURNING * INTO v_order;
  RETURN v_order;
END;
$$;
REVOKE ALL ON FUNCTION public.begin_checkout_order(uuid,uuid,text,uuid,numeric,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_checkout_order(uuid,uuid,text,uuid,numeric,integer) TO service_role;
COMMIT;
