BEGIN;
-- 快照中的邀请触发器不属于迁移链；接管其调用，但不补发任何历史奖励。
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invite_code text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_invite_code_unique ON public.profiles(invite_code);
CREATE OR REPLACE FUNCTION public.handle_new_user_invite_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  NEW.invite_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
  RETURN NEW;
END;
$$;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tgname FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND NOT tgisinternal
    AND tgfoid='public.handle_new_user_invite_code()'::regprocedure LOOP
    EXECUTE format('DROP TRIGGER %I ON public.profiles',t.tgname);
  END LOOP;
END;
$$;
CREATE TRIGGER on_auth_user_created_invite_code BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_invite_code();
UPDATE public.profiles SET invite_code=upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))
  WHERE NULLIF(invite_code,'') IS NULL;
-- 档案初始化只由注册事务完成；邀请码不可由浏览器换成别人的值。
REVOKE INSERT,UPDATE,DELETE ON public.profiles FROM PUBLIC,anon,authenticated;
GRANT UPDATE(username,avatar_url,notification_enabled,theme) ON public.profiles TO authenticated;

CREATE TABLE IF NOT EXISTS public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  invite_code text NOT NULL, status text DEFAULT 'pending',
  reward_credits integer DEFAULT 50, created_at timestamptz DEFAULT now()
);
-- 旧记录保留 NULL 版本，绝不据此补发；唯一性只施加到新协议。
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS reward_version integer,
  ADD COLUMN IF NOT EXISTS granted_at timestamptz;
ALTER TABLE public.invitations ALTER COLUMN reward_version SET DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS invitations_one_new_invitee ON public.invitations(invitee_id) WHERE reward_version=1;
CREATE INDEX IF NOT EXISTS invitations_owner_page ON public.invitations(inviter_id,created_at DESC,id DESC);
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='invitations' LOOP
    EXECUTE format('DROP POLICY %I ON public.invitations',p.policyname);
  END LOOP;
END;
$$;
CREATE POLICY invitations_read_own ON public.invitations FOR SELECT TO authenticated
  USING (inviter_id=auth.uid() OR invitee_id=auth.uid());
REVOKE ALL ON public.invitations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.invitations TO authenticated;
GRANT ALL ON public.invitations TO service_role;
ALTER TABLE public.credit_logs ADD COLUMN IF NOT EXISTS reward_source text,
  ADD COLUMN IF NOT EXISTS reward_key text;
CREATE UNIQUE INDEX credit_logs_one_reward_receipt ON public.credit_logs(user_id,reward_source,reward_key)
  WHERE reward_source IS NOT NULL AND reward_key IS NOT NULL;

CREATE FUNCTION public.settle_verified_invitation(p_invitee uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r invitations%ROWTYPE; balance integer; recipient uuid;
BEGIN
  -- 所有调用先锁账号（UUID顺序），再锁邀请；与既有单账号扣退费顺序一致。
  SELECT * INTO r FROM invitations WHERE invitee_id=p_invitee AND reward_version=1;
  IF NOT FOUND OR r.granted_at IS NOT NULL THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_invitee
    AND (email_confirmed_at IS NOT NULL OR phone_confirmed_at IS NOT NULL) AND COALESCE(banned_until,now())<=now())
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=r.inviter_id
      AND (email_confirmed_at IS NOT NULL OR phone_confirmed_at IS NOT NULL) AND COALESCE(banned_until,now())<=now()) THEN RETURN; END IF;
  PERFORM 1 FROM user_plans WHERE user_id IN (r.inviter_id,r.invitee_id) ORDER BY user_id FOR UPDATE;
  IF (SELECT count(*) FROM user_plans WHERE user_id IN (r.inviter_id,r.invitee_id))<>2 THEN
    RAISE EXCEPTION '邀请双方套餐尚未初始化';
  END IF;
  SELECT * INTO r FROM invitations WHERE id=r.id FOR UPDATE;
  IF r.granted_at IS NOT NULL THEN RETURN; END IF;
  IF r.status<>'pending' OR r.reward_credits<>50 OR r.inviter_id=r.invitee_id THEN
    RAISE EXCEPTION '邀请记录需要核对';
  END IF;
  FOREACH recipient IN ARRAY ARRAY[r.inviter_id,r.invitee_id] LOOP
    UPDATE user_plans SET credits_total=credits_total+r.reward_credits,updated_at=now()
      WHERE user_id=recipient RETURNING credits_total-credits_used INTO balance;
    INSERT INTO credit_logs(user_id,amount,type,action,description,credits_after,balance_after,reward_source,reward_key)
      VALUES(recipient,r.reward_credits,'bonus',
        CASE WHEN recipient=r.inviter_id THEN 'invitation_inviter' ELSE 'invitation_invitee' END,
        CASE WHEN recipient=r.inviter_id THEN '邀请好友验证奖励' ELSE '使用邀请码验证奖励' END,
        balance,balance,'invitation',r.id::text);
  END LOOP;
  UPDATE invitations SET status='completed',granted_at=now() WHERE id=r.id;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_verified_invitation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_invitation(uuid) TO service_role;

-- 用一个注册触发器创建档案、套餐、注册赠分及邀请；消除旧触发器的执行顺序依赖。
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE free_id uuid; inviter uuid; code text:=upper(btrim(NEW.raw_user_meta_data->>'invited_by_code'));
BEGIN
  INSERT INTO profiles(id,email,username,role)
    VALUES(NEW.id,NEW.email,COALESCE(NULLIF(split_part(NEW.email,'@',1),''),'user')||'_'||replace(NEW.id::text,'-',''),'user')
    ON CONFLICT(id) DO NOTHING;
  SELECT id INTO free_id FROM plans WHERE name='免费版' AND price=0 ORDER BY created_at LIMIT 1;
  IF free_id IS NULL THEN RAISE EXCEPTION '缺少免费套餐，无法初始化注册积分'; END IF;
  INSERT INTO user_plans(user_id,plan_id,credits_total,credits_used) VALUES(NEW.id,free_id,20,0)
    ON CONFLICT(user_id) DO NOTHING;
  IF FOUND THEN
    INSERT INTO credit_logs(user_id,amount,type,action,description,credits_after,balance_after)
      VALUES(NEW.id,20,'bonus','register_gift','注册赠送 +20 积分',20,20);
  END IF;
  IF code ~ '^[A-Z0-9]{8,32}$' AND NOT EXISTS(SELECT 1 FROM invitations WHERE invitee_id=NEW.id) THEN
    SELECT p.id INTO inviter FROM profiles p JOIN auth.users u ON u.id=p.id
      WHERE p.invite_code=code AND p.id<>NEW.id AND COALESCE(u.banned_until,now())<=now()
        AND (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL);
    IF inviter IS NOT NULL THEN
      INSERT INTO invitations(inviter_id,invitee_id,invite_code,reward_version) VALUES(inviter,NEW.id,code,1);
      PERFORM settle_verified_invitation(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- 快照中未知名字的旧 process_invitation 调用也改为无操作，不再冲减 credits_used。
CREATE OR REPLACE FUNCTION public.process_invitation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RETURN NEW; END; $$;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tgname FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal
    AND tgfoid IN ('public.handle_new_user()'::regprocedure,'public.process_invitation()'::regprocedure) LOOP
    EXECUTE format('DROP TRIGGER %I ON auth.users',t.tgname);
  END LOOP;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE FUNCTION public.confirm_invitation_reward() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
    OR (OLD.phone_confirmed_at IS NULL AND NEW.phone_confirmed_at IS NOT NULL) THEN
    PERFORM settle_verified_invitation(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_invitation_verified AFTER UPDATE OF email_confirmed_at,phone_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.confirm_invitation_reward();
REVOKE ALL ON FUNCTION public.handle_new_user(),public.handle_new_user_invite_code(),
  public.process_invitation(),public.confirm_invitation_reward() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_my_invitations(p_offset integer DEFAULT 0,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owner_id uuid:=auth.uid(); items jsonb;
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION '请先登录' USING ERRCODE='42501'; END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_offset>1000000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION '分页参数无效';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC),'[]') INTO items FROM (
    SELECT i.id,i.created_at,i.status,i.reward_credits,i.granted_at,
      '受邀用户 '||substr(i.invitee_id::text,1,8) AS invitee_label,
      i.reward_version IS DISTINCT FROM 1 AS legacy,
      (SELECT sum(l.amount) FROM credit_logs l WHERE l.user_id=owner_id
        AND l.reward_source='invitation' AND l.reward_key=i.id::text) AS credited
    FROM invitations i WHERE inviter_id=owner_id ORDER BY created_at DESC,id DESC LIMIT p_limit OFFSET p_offset
  ) x;
  RETURN jsonb_build_object('items',items,'invite_code',(SELECT invite_code FROM profiles WHERE id=owner_id),
    'total',(SELECT count(*) FROM invitations WHERE inviter_id=owner_id),
    'completed',(SELECT count(*) FROM invitations WHERE inviter_id=owner_id AND granted_at IS NOT NULL),
    'credits',(SELECT COALESCE(sum(l.amount),0) FROM credit_logs l WHERE l.user_id=owner_id AND l.reward_source='invitation'
      AND l.action='invitation_inviter'),
    'legacy',(SELECT count(*) FROM invitations WHERE inviter_id=owner_id AND reward_version IS DISTINCT FROM 1));
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_invitations(integer,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_invitations(integer,integer) TO authenticated;

CREATE TABLE public.activity_reward_receipts (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_key uuid NOT NULL, activity_id uuid NOT NULL REFERENCES public.activities(id),
  period text NOT NULL, reward integer NOT NULL CHECK(reward>0), balance integer NOT NULL,
  charge_id uuid NOT NULL REFERENCES public.credit_logs(id), claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,request_key), UNIQUE(user_id,activity_id,period)
);
ALTER TABLE public.activity_reward_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_reward_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.activity_reward_receipts TO service_role;
CREATE FUNCTION public.activity_reward_eligibility(p_user uuid,p_activity uuid,p_now timestamptz) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE a activities%ROWTYPE; c user_activities%ROWTYPE;
BEGIN
  SELECT * INTO a FROM activities WHERE id=p_activity;
  IF NOT FOUND OR a.type IS NULL OR a.status IS DISTINCT FROM 'active' OR a.reward_credits IS NULL OR a.reward_credits<=0
    OR a.max_times<0 THEN RETURN 'unavailable'; END IF;
  IF a.start_time>p_now THEN RETURN 'not_started'; END IF;
  IF a.end_time<=p_now THEN RETURN 'expired'; END IF;
  IF NOT EXISTS(SELECT 1 FROM user_plans WHERE user_id=p_user) THEN RETURN 'missing_plan'; END IF;
  IF EXISTS(SELECT 1 FROM activity_reward_receipts WHERE user_id=p_user AND activity_id=p_activity
    AND period=CASE WHEN a.type='daily_checkin' THEN to_char(p_now AT TIME ZONE 'UTC','YYYY-MM-DD') ELSE 'once' END) THEN
    RETURN CASE WHEN a.type='daily_checkin' THEN 'claimed_today' ELSE 'completed' END;
  END IF;
  SELECT * INTO c FROM user_activities WHERE user_id=p_user AND activity_id=p_activity;
  IF COALESCE(c.completed_times,0)>0 AND
    (a.type<>'daily_checkin' OR (COALESCE(a.max_times,0)>0 AND c.completed_times>=a.max_times)) THEN RETURN 'completed'; END IF;
  IF COALESCE(c.completed_times,0)>0 AND a.type='daily_checkin' THEN
    IF c.last_claimed_at IS NULL THEN RETURN 'legacy_review'; END IF;
    IF (c.last_claimed_at AT TIME ZONE 'UTC')::date>=(p_now AT TIME ZONE 'UTC')::date THEN RETURN 'claimed_today'; END IF;
  END IF;
  IF a.type NOT IN ('login_first','daily_checkin','video_first') THEN RETURN 'evidence_required'; END IF;
  -- 项目完成态可由客户端编辑，只有后台任务完成并有成片才是凭证。
  IF a.type='video_first' AND NOT EXISTS(SELECT 1 FROM video_jobs WHERE user_id=p_user
    AND status='completed' AND charge_id IS NOT NULL AND billing_state='settled'
    AND NULLIF(result->>'video_url','') IS NOT NULL) THEN RETURN 'video_required'; END IF;
  RETURN 'eligible';
END;
$$;
REVOKE ALL ON FUNCTION public.activity_reward_eligibility(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activity_reward_eligibility(uuid,uuid,timestamptz) TO service_role;
CREATE FUNCTION public.get_my_activities() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owner_id uuid:=auth.uid(); items jsonb;
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION '请先登录' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at,x.id),'[]') INTO items FROM (
    SELECT a.id,a.title,a.description,a.type,a.reward_credits,a.max_times,a.created_at,
      a.start_time,a.end_time,COALESCE(c.completed_times,0) AS completed_times,c.last_claimed_at,
      activity_reward_eligibility(owner_id,a.id,now()) AS eligibility,
      CASE WHEN a.type='daily_checkin' THEN
        (date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC' END AS next_claim_at
    FROM activities a LEFT JOIN user_activities c ON c.activity_id=a.id AND c.user_id=owner_id
    WHERE a.status='active'
  ) x;
  RETURN jsonb_build_object('items',items,'server_time',now(),'checkin_timezone','UTC');
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_activities() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_activities() TO authenticated;
DROP FUNCTION public.claim_activity_reward(uuid);
CREATE FUNCTION public.claim_activity_reward(p_activity_id uuid,p_request_key uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE owner_id uuid:=auth.uid(); a activities%ROWTYPE; r activity_reward_receipts%ROWTYPE;
  reason text; balance integer; log_id uuid; key uuid:=COALESCE(p_request_key,gen_random_uuid()); period_key text;
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION '请先登录' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM user_plans WHERE user_id=owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
  SELECT * INTO r FROM activity_reward_receipts WHERE user_id=owner_id AND request_key=key;
  IF FOUND THEN
    IF r.activity_id<>p_activity_id THEN RAISE EXCEPTION '原请求与活动不符'; END IF;
    RETURN jsonb_build_object('ok',true,'already_claimed',true,'request_key',key,'reward',r.reward,
      'balance',r.balance,'claimed_at',r.claimed_at);
  END IF;
  SELECT * INTO a FROM activities WHERE id=p_activity_id FOR SHARE;
  reason:=activity_reward_eligibility(owner_id,p_activity_id,now());
  IF reason<>'eligible' THEN RAISE EXCEPTION '活动暂不可领取：%' ,reason; END IF;
  period_key:=CASE WHEN a.type='daily_checkin' THEN to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') ELSE 'once' END;
  UPDATE user_plans SET credits_total=credits_total+a.reward_credits,updated_at=now() WHERE user_id=owner_id
    RETURNING credits_total-credits_used INTO balance;
  INSERT INTO user_activities(user_id,activity_id,completed_times,status,last_claimed_at,updated_at)
    VALUES(owner_id,a.id,1,'completed',now(),now())
    ON CONFLICT(user_id,activity_id) DO UPDATE SET completed_times=COALESCE(user_activities.completed_times,0)+1,
      status='completed',last_claimed_at=now(),updated_at=now();
  INSERT INTO credit_logs(user_id,amount,type,action,description,credits_after,balance_after,reward_source,reward_key)
    VALUES(owner_id,a.reward_credits,'bonus','activity_reward','完成活动：'||a.title,balance,balance,'activity',a.id||':'||period_key)
    RETURNING id INTO log_id;
  INSERT INTO activity_reward_receipts(user_id,request_key,activity_id,period,reward,balance,charge_id)
    VALUES(owner_id,key,a.id,period_key,a.reward_credits,balance,log_id) RETURNING * INTO r;
  RETURN jsonb_build_object('ok',true,'already_claimed',false,'request_key',key,'reward',r.reward,
    'balance',r.balance,'claimed_at',r.claimed_at);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_activity_reward(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.claim_activity_reward(uuid,uuid) TO authenticated;
-- 受控异常回执：浏览器不能伪造其他用户/source，丢失响应用同一UUID恢复。
REVOKE INSERT ON public.error_logs FROM PUBLIC,anon,authenticated;
CREATE UNIQUE INDEX error_logs_one_frontend_request ON public.error_logs(user_id,request_id)
  WHERE source='frontend_error_boundary' AND request_id IS NOT NULL;
CREATE FUNCTION public.report_frontend_error(p_request_key uuid,p_path text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE owner_id uuid:=auth.uid(); log_id uuid;
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION '请先登录' USING ERRCODE='42501'; END IF;
  IF p_request_key IS NULL OR p_path IS NULL OR length(p_path)>256 OR p_path !~ '^/[a-zA-Z0-9/_-]*$' THEN
    RAISE EXCEPTION '上报参数无效';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('frontend-error:'||owner_id,0));
  SELECT id INTO log_id FROM error_logs WHERE user_id=owner_id AND request_id=p_request_key::text
    AND source='frontend_error_boundary';
  IF log_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'id',log_id,'request_key',p_request_key); END IF;
  IF (SELECT count(*) FROM error_logs WHERE user_id=owner_id AND source='frontend_error_boundary'
    AND created_at>now()-interval '1 minute')>=10 THEN RAISE EXCEPTION '上报过于频繁，请稍后重试'; END IF;
  INSERT INTO error_logs(user_id,source,action,error_code,error_msg,request_id)
    VALUES(owner_id,'frontend_error_boundary',p_path,'REACT_RENDER_CRASH','页面渲染异常',p_request_key::text)
    RETURNING id INTO log_id;
  RETURN jsonb_build_object('ok',true,'id',log_id,'request_key',p_request_key);
END;
$$;
REVOKE ALL ON FUNCTION public.report_frontend_error(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.report_frontend_error(uuid,text) TO authenticated;
CREATE FUNCTION public.reward_schema_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT to_regprocedure('public.get_my_invitations(integer,integer)') IS NOT NULL
    AND to_regclass('public.activity_reward_receipts') IS NOT NULL
    AND to_regclass('public.credit_logs_one_reward_receipt') IS NOT NULL
    AND to_regclass('public.invitations_one_new_invitee') IS NOT NULL
    AND to_regprocedure('public.get_my_activities()') IS NOT NULL
    AND to_regprocedure('public.claim_activity_reward(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.report_frontend_error(uuid,text)') IS NOT NULL
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass
      AND tgname='on_auth_invitation_verified' AND NOT tgisinternal AND tgenabled='O')
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass
      AND tgname='on_auth_user_created' AND NOT tgisinternal AND tgenabled='O')
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.profiles'::regclass
      AND tgname='on_auth_user_created_invite_code' AND NOT tgisinternal AND tgenabled='O');
$$;
REVOKE ALL ON FUNCTION public.reward_schema_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reward_schema_ready() TO service_role;
COMMIT;
