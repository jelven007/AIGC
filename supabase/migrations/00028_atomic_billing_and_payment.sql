-- 第一轮 P0：资金表只读、逐笔扣退、支付与权益发放同事务。
-- 已部署数据库应用本增量；无需重放历史迁移。
BEGIN;

ALTER TABLE public.user_plans ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.credit_logs
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS balance_after integer,
  ADD COLUMN IF NOT EXISTS original_charge_id uuid REFERENCES public.credit_logs(id),
  ADD COLUMN IF NOT EXISTS billing_cycle_start timestamptz,
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id);
CREATE UNIQUE INDEX IF NOT EXISTS credit_logs_one_refund_per_charge
  ON public.credit_logs(original_charge_id) WHERE original_charge_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_logs_one_grant_per_order
  ON public.credit_logs(order_id) WHERE order_id IS NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS plan_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS entitlement_granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_trade_no text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_unique_provider_trade
  ON public.orders(pay_channel, provider_trade_no) WHERE provider_trade_no IS NOT NULL;

-- 历史待支付订单仅能按当前套餐补快照；已支付订单不自动补发，避免重复入账。
UPDATE public.orders o SET plan_snapshot = jsonb_build_object(
  'id', p.id, 'name', p.name, 'level', p.level, 'credits', p.credits
)
FROM public.plans p
WHERE o.plan_id = p.id AND o.plan_snapshot IS NULL AND o.status = 'pending';

-- 下单快照由数据库生成，服务端/客户端都不能指定一套与订单套餐不符的权益。
CREATE OR REPLACE FUNCTION public.snapshot_order_plan()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_plan public.plans%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_plan FROM public.plans WHERE id = NEW.plan_id FOR SHARE;
  IF NEW.total_amount <= 0 OR NEW.total_amount <> v_plan.price OR v_plan.credits < 0 THEN
    RAISE EXCEPTION '订单金额或套餐积分非法';
  END IF;
  NEW.plan_snapshot := jsonb_build_object(
    'id', v_plan.id, 'name', v_plan.name, 'level', v_plan.level, 'credits', v_plan.credits
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS orders_snapshot_plan ON public.orders;
CREATE TRIGGER orders_snapshot_plan BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_order_plan();

-- PostgreSQL 宽松策略按 OR 合并：清除全部历史写策略，避免旧策略名遗漏。
DO $$
DECLARE v_policy record;
BEGIN
  FOR v_policy IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('user_plans', 'credit_logs', 'orders')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_policy.tablename);
  END LOOP;
END;
$$;
ALTER TABLE public.user_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_plans_read_own ON public.user_plans FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY credit_logs_read_own ON public.credit_logs FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY orders_read_own ON public.orders FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.user_plans, public.credit_logs, public.orders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_plans, public.credit_logs, public.orders TO authenticated;
GRANT ALL ON public.user_plans, public.credit_logs, public.orders TO service_role;

-- 任务状态是退款/活动奖励的服务端证据，不能由浏览器伪造。
DO $$
DECLARE v_policy record;
BEGIN
  FOR v_policy IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'video_jobs'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.video_jobs', v_policy.policyname);
  END LOOP;
END;
$$;
ALTER TABLE public.video_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY video_jobs_read_own ON public.video_jobs FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.video_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.video_jobs TO authenticated;
GRANT ALL ON public.video_jobs TO service_role;

-- 价格与成本配置也必须只读，否则客户端可改套餐价格/积分绕过资金事务。
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_cache ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE v_policy record;
BEGIN
  FOR v_policy IN SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('plans', 'credit_costs', 'llm_cache')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_policy.tablename);
  END LOOP;
END;
$$;
CREATE POLICY plans_read ON public.plans FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY credit_costs_read ON public.credit_costs FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.plans, public.credit_costs, public.llm_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT SELECT ON public.credit_costs TO authenticated;
GRANT ALL ON public.plans, public.credit_costs, public.llm_cache TO service_role;

-- 注册初始化一次性事务：邮箱前缀重名不再吞掉错误，套餐与赠送流水一起写入。
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_free_plan_id uuid;
BEGIN
  INSERT INTO public.profiles(id, email, username, role)
  VALUES (NEW.id, NEW.email,
    COALESCE(NULLIF(split_part(NEW.email, '@', 1), ''), 'user') || '_' || replace(NEW.id::text, '-', ''), 'user')
  ON CONFLICT (id) DO NOTHING;
  SELECT id INTO v_free_plan_id FROM public.plans WHERE name = '免费版' AND price = 0 ORDER BY created_at LIMIT 1;
  IF v_free_plan_id IS NULL THEN RAISE EXCEPTION '缺少免费套餐，无法初始化注册积分'; END IF;
  INSERT INTO public.user_plans(user_id, plan_id, credits_total, credits_used)
  VALUES (NEW.id, v_free_plan_id, 20, 0) ON CONFLICT (user_id) DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.credit_logs(user_id, amount, type, action, description, credits_after, balance_after)
    VALUES (NEW.id, 20, 'bonus', 'register_gift', '注册赠送 +20 积分', 20, 20);
  END IF;
  RETURN NEW;
END;
$$;

-- 同时支持 00013 的 void 和 00025 的 jsonb 版本，显式删除避免返回类型冲突。
DROP FUNCTION IF EXISTS public.deduct_credits(uuid, integer, text);
CREATE FUNCTION public.deduct_credits(p_user_id uuid, p_amount int, p_action text DEFAULT 'AI视频生成')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.user_plans%ROWTYPE;
  v_charge_id uuid;
  v_left int;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION '扣费积分必须为正整数'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND (auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id) THEN
    RAISE EXCEPTION '禁止操作其他用户积分' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_plan FROM public.user_plans WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '未找到用户套餐计划'; END IF;
  v_left := v_plan.credits_total - v_plan.credits_used;
  IF v_left < p_amount THEN RAISE EXCEPTION '积分不足：当前剩余 %，需要 %', v_left, p_amount; END IF;
  UPDATE public.user_plans SET credits_used = credits_used + p_amount, updated_at = now()
    WHERE user_id = p_user_id;
  INSERT INTO public.credit_logs(user_id, amount, type, action, description, credits_after, balance_after, billing_cycle_start)
  VALUES (p_user_id, -p_amount, 'deduct', p_action, COALESCE(p_action, '功能使用'),
    v_left - p_amount, v_left - p_amount, v_plan.cycle_start)
  RETURNING id INTO v_charge_id;
  RETURN jsonb_build_object('ok', true, 'credits_left', v_left - p_amount, 'charge_id', v_charge_id);
END;
$$;
REVOKE ALL ON FUNCTION public.deduct_credits(uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_credits(uuid, int, text) TO authenticated, service_role;

-- 禁用只凭金额的旧退款入口；必须提供实际扣费流水并由后端确认失败。
DROP FUNCTION IF EXISTS public.refund_credits(uuid, integer, text);
CREATE FUNCTION public.refund_credits(p_user_id uuid, p_amount int, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION '退款必须关联扣费流水，请使用 refund_credit_charge';
END;
$$;
REVOKE ALL ON FUNCTION public.refund_credits(uuid, int, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refund_credit_charge(p_user_id uuid, p_charge_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.user_plans%ROWTYPE;
  v_charge public.credit_logs%ROWTYPE;
  v_refund public.credit_logs%ROWTYPE;
  v_amount int;
  v_balance int;
BEGIN
  -- 和支付/扣费统一先锁账户，再锁流水，防止锁顺序反转。
  SELECT * INTO v_plan FROM public.user_plans WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
  SELECT * INTO v_charge FROM public.credit_logs
    WHERE id = p_charge_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_charge.amount >= 0 OR v_charge.type <> 'deduct'
    OR v_charge.billing_cycle_start IS NULL THEN
    RAISE EXCEPTION '扣费流水不存在、归属不符或需要人工核对';
  END IF;
  SELECT * INTO v_refund FROM public.credit_logs WHERE original_charge_id = p_charge_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already_refunded', true, 'refunded', 0,
      'balance', v_plan.credits_total - v_plan.credits_used);
  END IF;
  v_amount := -v_charge.amount;
  IF v_charge.billing_cycle_start = v_plan.cycle_start THEN
    IF v_plan.credits_used < v_amount THEN RAISE EXCEPTION '扣费余额不一致，需要人工核对'; END IF;
    UPDATE public.user_plans SET credits_used = credits_used - v_amount, updated_at = now()
      WHERE user_id = p_user_id RETURNING credits_total - credits_used INTO v_balance;
  ELSE
    -- 换套餐后旧周期已重置：补入总积分，不能冲减新周期的其他消费。
    UPDATE public.user_plans SET credits_total = credits_total + v_amount, updated_at = now()
      WHERE user_id = p_user_id RETURNING credits_total - credits_used INTO v_balance;
  END IF;
  INSERT INTO public.credit_logs(user_id, amount, type, action, description, credits_after, balance_after, original_charge_id)
  VALUES (p_user_id, v_amount, 'refund', 'refund', COALESCE(p_reason, '任务失败退还积分'),
    v_balance, v_balance, p_charge_id);
  RETURN jsonb_build_object('ok', true, 'already_refunded', false, 'refunded', v_amount, 'balance', v_balance);
END;
$$;
REVOKE ALL ON FUNCTION public.refund_credit_charge(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credit_charge(uuid, uuid, text) TO service_role;

-- 充值保留给可信后台，正数校验与流水写入同事务；不凭空创建默认 50 积分。
CREATE OR REPLACE FUNCTION public.add_credits(p_user_id uuid, p_amount int, p_desc text DEFAULT '充值')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance int;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION '充值积分必须为正整数'; END IF;
  UPDATE public.user_plans SET credits_total = credits_total + p_amount, updated_at = now()
    WHERE user_id = p_user_id RETURNING credits_total - credits_used INTO v_balance;
  IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
  INSERT INTO public.credit_logs(user_id, amount, type, action, description, credits_after, balance_after)
  VALUES (p_user_id, p_amount, 'purchase', 'topup', COALESCE(p_desc, '充值'), v_balance, v_balance);
  RETURN jsonb_build_object('ok', true, 'balance', v_balance);
END;
$$;
REVOKE ALL ON FUNCTION public.add_credits(uuid, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits(uuid, int, text) TO service_role;

-- 验签在 Edge Function 完成；此 RPC 再校验渠道、金额、交易号，并原子发放权益。
CREATE OR REPLACE FUNCTION public.finalize_paid_order(
  p_order_no text, p_pay_channel text, p_trade_no text, p_amount numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_plan_id uuid;
  v_credits int;
  v_level int;
  v_name text;
  v_balance int;
  v_now timestamptz := clock_timestamp();
  v_cycle_end timestamptz := v_now + interval '1 month';
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_no = p_order_no FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF p_pay_channel NOT IN ('alipay', 'wechat') OR p_pay_channel IS NULL
    OR v_order.pay_channel <> p_pay_channel OR p_amount IS NULL OR p_amount <= 0
    OR v_order.total_amount <> p_amount OR p_trade_no IS NULL OR btrim(p_trade_no) = '' THEN
    RAISE EXCEPTION '支付渠道、金额或交易号校验失败';
  END IF;
  IF v_order.provider_trade_no IS NOT NULL AND v_order.provider_trade_no <> p_trade_no THEN
    RAISE EXCEPTION '支付交易号与已有记录不符';
  END IF;
  IF v_order.entitlement_granted_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'already_processed', 'user_id', v_order.user_id);
  END IF;
  -- 旧 paid 订单没有可信的发放标记，自动重发可能导致重复积分：交由人工对账。
  IF v_order.status <> 'pending' THEN RAISE EXCEPTION '订单状态不允许入账，请核对历史权益发放记录'; END IF;
  IF v_order.plan_snapshot IS NULL OR NOT (v_order.plan_snapshot ?& ARRAY['id', 'name', 'credits', 'level']) THEN
    RAISE EXCEPTION '缺少订单套餐快照';
  END IF;
  v_plan_id := (v_order.plan_snapshot->>'id')::uuid;
  v_credits := (v_order.plan_snapshot->>'credits')::int;
  v_level := (v_order.plan_snapshot->>'level')::int;
  v_name := v_order.plan_snapshot->>'name';
  IF v_plan_id IS DISTINCT FROM v_order.plan_id OR v_credits IS NULL OR v_credits < 0 OR v_level IS NULL THEN
    RAISE EXCEPTION '套餐快照非法';
  END IF;

  IF v_level < 0 THEN
    INSERT INTO public.user_plans(user_id, plan_id, credits_total, credits_used, status)
    VALUES (v_order.user_id, v_plan_id, v_credits, 0, 'active')
    ON CONFLICT (user_id) DO UPDATE
      SET credits_total = public.user_plans.credits_total + EXCLUDED.credits_total, updated_at = v_now
    RETURNING credits_total - credits_used INTO v_balance;
  ELSE
    INSERT INTO public.user_plans(user_id, plan_id, credits_total, credits_used, cycle_start, cycle_end, expires_at, status)
    VALUES (v_order.user_id, v_plan_id, v_credits, 0, v_now, v_cycle_end, v_cycle_end, 'active')
    ON CONFLICT (user_id) DO UPDATE SET
      plan_id = EXCLUDED.plan_id, credits_total = EXCLUDED.credits_total, credits_used = 0,
      cycle_start = v_now, cycle_end = v_cycle_end, expires_at = v_cycle_end, status = 'active', updated_at = v_now
    RETURNING credits_total - credits_used INTO v_balance;
  END IF;
  INSERT INTO public.credit_logs(user_id, amount, type, action, description, credits_after, balance_after, order_id)
  VALUES (v_order.user_id, v_credits, 'purchase',
    CASE WHEN v_level < 0 THEN 'booster_purchase' ELSE 'plan_purchase' END,
    format('%s购买：%s（订单 %s）', p_pay_channel, v_name, p_order_no), v_balance, v_balance, v_order.id);
  UPDATE public.orders SET status = 'paid', paid_at = v_now, updated_at = v_now,
    entitlement_granted_at = v_now, provider_trade_no = p_trade_no,
    alipay_trade_no = CASE WHEN p_pay_channel = 'alipay' THEN p_trade_no ELSE alipay_trade_no END
    WHERE id = v_order.id;
  RETURN jsonb_build_object('outcome', 'granted', 'user_id', v_order.user_id, 'balance', v_balance);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_paid_order(text, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_paid_order(text, text, text, numeric) TO service_role;

-- 非资金辅助 RPC 也不允许客户端伪造模型调用成本、缓存命中或限流窗口。
REVOKE ALL ON FUNCTION public.record_model_call(uuid, text, text, text, text, integer, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_model_call(uuid, text, text, text, text, integer, integer, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.increment_llm_cache_hit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_llm_cache_hit(text) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_rate_limit(text, text, timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_rate_limit(text, text, timestamptz, int) TO service_role;

COMMIT;
