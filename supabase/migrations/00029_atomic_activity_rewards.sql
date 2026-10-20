-- 活动领奖不再由客户端更新积分；未有完成证据的活动拒绝发奖。
BEGIN;
CREATE TABLE IF NOT EXISTS public.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL, description text, type text NOT NULL,
  reward_credits integer NOT NULL DEFAULT 0, max_times integer DEFAULT 1,
  start_time timestamptz DEFAULT now(), end_time timestamptz,
  status text DEFAULT 'active', created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_id uuid REFERENCES public.activities(id) ON DELETE CASCADE,
  completed_times integer DEFAULT 0, status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, activity_id)
);
ALTER TABLE public.user_activities ADD COLUMN IF NOT EXISTS last_claimed_at timestamptz;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activities ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE v_policy record;
BEGIN
  FOR v_policy IN SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('activities', 'user_activities')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_policy.tablename);
  END LOOP;
END;
$$;
CREATE POLICY activities_read ON public.activities FOR SELECT TO authenticated USING (true);
CREATE POLICY user_activities_read_own ON public.user_activities FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.activities, public.user_activities FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.activities, public.user_activities TO authenticated;
GRANT ALL ON public.activities, public.user_activities TO service_role;

CREATE OR REPLACE FUNCTION public.claim_activity_reward(p_activity_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_activity public.activities%ROWTYPE;
  v_claim public.user_activities%ROWTYPE;
  v_balance int;
  v_now timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '请先登录' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.user_plans WHERE user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
  SELECT * INTO v_activity FROM public.activities WHERE id = p_activity_id FOR SHARE;
  IF NOT FOUND OR v_activity.status <> 'active' OR v_activity.reward_credits <= 0
    OR v_activity.start_time > v_now OR v_activity.end_time < v_now THEN
    RAISE EXCEPTION '活动未开放或奖励非法';
  END IF;
  SELECT * INTO v_claim FROM public.user_activities
    WHERE user_id = v_user_id AND activity_id = p_activity_id FOR UPDATE;
  IF COALESCE(v_claim.completed_times, 0) > 0 AND (
    v_activity.type <> 'daily_checkin'
    OR (COALESCE(v_activity.max_times, 0) > 0 AND v_claim.completed_times >= v_activity.max_times)
    OR v_claim.last_claimed_at IS NULL
    OR (v_claim.last_claimed_at AT TIME ZONE 'UTC')::date = (v_now AT TIME ZONE 'UTC')::date
  ) THEN RAISE EXCEPTION '已领取本次活动奖励'; END IF;
  IF v_activity.type NOT IN ('login_first', 'daily_checkin', 'video_first') THEN
    RAISE EXCEPTION '此活动尚无服务端完成凭证，暂不支持自动领奖';
  END IF;
  IF v_activity.type = 'video_first' AND NOT EXISTS (
    SELECT 1 FROM public.video_jobs WHERE user_id = v_user_id AND status = 'completed'
  ) THEN RAISE EXCEPTION '请先完成一次视频生成'; END IF;
  UPDATE public.user_plans SET credits_total = credits_total + v_activity.reward_credits, updated_at = v_now
    WHERE user_id = v_user_id RETURNING credits_total - credits_used INTO v_balance;
  INSERT INTO public.user_activities(user_id, activity_id, completed_times, status, last_claimed_at, updated_at)
  VALUES (v_user_id, p_activity_id, 1, 'completed', v_now, v_now)
  ON CONFLICT(user_id, activity_id) DO UPDATE SET
    completed_times = COALESCE(public.user_activities.completed_times, 0) + 1,
    status = 'completed', last_claimed_at = v_now, updated_at = v_now;
  INSERT INTO public.credit_logs(user_id, amount, type, action, description, credits_after, balance_after)
  VALUES (v_user_id, v_activity.reward_credits, 'bonus', 'activity_reward',
    '完成活动：' || v_activity.title, v_balance, v_balance);
  RETURN jsonb_build_object('ok', true, 'reward', v_activity.reward_credits, 'balance', v_balance);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_activity_reward(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_activity_reward(uuid) TO authenticated;
COMMIT;
