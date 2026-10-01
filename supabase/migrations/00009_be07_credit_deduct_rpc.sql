
-- BE-07: 原子积分扣减 RPC（防止并发超扣）
CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id    uuid,
  p_amount     int,
  p_desc       text DEFAULT '功能使用'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current  int;
  v_after    int;
BEGIN
  -- 锁定 user_plans 行防并发
  SELECT up.credits_remaining INTO v_current
  FROM user_plans up
  WHERE up.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '未找到用户套餐');
  END IF;

  IF v_current < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', '积分不足', 'current', v_current);
  END IF;

  v_after := v_current - p_amount;

  UPDATE user_plans
  SET credits_remaining = v_after, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO credit_logs (user_id, amount, type, description, credits_after)
  VALUES (p_user_id, -p_amount, 'deduct', p_desc, v_after);

  RETURN jsonb_build_object('ok', true, 'credits_after', v_after);
END;
$$;

-- BE-08: 积分充值 RPC
CREATE OR REPLACE FUNCTION add_credits(
  p_user_id uuid,
  p_amount  int,
  p_desc    text DEFAULT '充值'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_after int;
BEGIN
  UPDATE user_plans
  SET credits_remaining = credits_remaining + p_amount, updated_at = now()
  WHERE user_id = p_user_id
  RETURNING credits_remaining INTO v_after;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '未找到用户套餐');
  END IF;

  INSERT INTO credit_logs (user_id, amount, type, description, credits_after)
  VALUES (p_user_id, p_amount, 'topup', p_desc, v_after);

  RETURN jsonb_build_object('ok', true, 'credits_after', v_after);
END;
$$;
