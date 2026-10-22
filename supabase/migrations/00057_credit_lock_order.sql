BEGIN;
-- 所有创建入口和直接扣费统一：套餐行 → 用户团队锁 → 用户风险锁 → 团队行。
-- 00056先拿团队锁与既有创建入口先锁套餐行互锁；新增迁移保留已部署历史摘要。
CREATE OR REPLACE FUNCTION deduct_credits(p_user_id uuid,p_amount int,p_action text DEFAULT 'AI视频生成')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t teams%ROWTYPE; result jsonb; used bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id) THEN
  RAISE EXCEPTION '禁止操作其他用户积分' USING ERRCODE='42501'; END IF;
 IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION '扣费积分须为正整数'; END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team-user:'||p_user_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('workload-user:'||p_user_id,0));
 IF EXISTS(SELECT 1 FROM workload_restrictions WHERE user_id=p_user_id AND restricted) THEN
  RAISE EXCEPTION '账号的新计费任务已受限，可通过工单申诉' USING ERRCODE='42501'; END IF;
 SELECT x.* INTO t FROM teams x JOIN team_members m ON m.team_id=x.id
 WHERE m.user_id=p_user_id AND m.status='active' ORDER BY x.id LIMIT 1 FOR UPDATE OF x;
 IF FOUND THEN
  IF t.state='suspended' THEN RAISE EXCEPTION '租户已暂停新计费任务，可通过工单联系运营' USING ERRCODE='42501'; END IF;
  IF t.daily_credit_budget>0 THEN
   SELECT COALESCE(sum(amount),0) INTO used FROM team_credit_reservations WHERE team_id=t.id
    AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
   IF used+p_amount>t.daily_credit_budget THEN RAISE EXCEPTION '团队日积分预算不足'; END IF;
  END IF;
 END IF;
 result:=deduct_credits_before_ops(p_user_id,p_amount,p_action);
 IF t.id IS NOT NULL THEN
  INSERT INTO team_credit_reservations(charge_id,team_id,user_id,amount)
  VALUES((result->>'charge_id')::uuid,t.id,p_user_id,p_amount);
 END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION deduct_credits(uuid,int,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION deduct_credits(uuid,int,text) TO authenticated,service_role;
COMMIT;
