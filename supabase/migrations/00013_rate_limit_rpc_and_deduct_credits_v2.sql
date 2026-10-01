
-- P2-M06: 持久化限流 RPC
CREATE OR REPLACE FUNCTION public.upsert_rate_limit(
  p_window_key text,
  p_client_id  text,
  p_reset_at   timestamptz,
  p_max_req    int
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO public.rate_limit_windows (window_key, client_id, count, reset_at)
  VALUES (p_window_key, p_client_id, 1, p_reset_at)
  ON CONFLICT (window_key) DO UPDATE
    SET count = rate_limit_windows.count + 1
  RETURNING count INTO v_count;
  RETURN v_count <= p_max_req;
END;
$$;

-- P1-M04: 先删旧版，再创新版
DROP FUNCTION IF EXISTS public.deduct_credits(uuid, integer, text);

CREATE FUNCTION public.deduct_credits(
  p_user_id uuid,
  p_amount  int,
  p_action  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.user_plans
  SET credits_used = credits_used + p_amount,
      updated_at   = now()
  WHERE user_id = p_user_id
    AND (credits_total - credits_used) >= p_amount;

  IF NOT FOUND THEN
    RAISE EXCEPTION '积分不足';
  END IF;

  INSERT INTO public.credit_logs (user_id, action, amount, balance_after)
  SELECT p_user_id, p_action, -p_amount,
         (credits_total - credits_used)
  FROM public.user_plans
  WHERE user_id = p_user_id;
END;
$$;
