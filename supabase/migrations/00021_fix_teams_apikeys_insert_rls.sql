-- 修复 teams / team_members / api_keys 的 INSERT RLS 策略
-- 允许认证用户直接从前端创建团队和 API Key，无需经过 Edge Function

-- ── teams ──────────────────────────────────────────────────────────────────
-- 显式添加 INSERT WITH CHECK（owner_id 必须等于当前用户）
DROP POLICY IF EXISTS "teams_owner_insert" ON public.teams;
CREATE POLICY "teams_owner_insert" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- ── team_members ──────────────────────────────────────────────────────────
-- 用户可以向自己拥有的团队插入成员记录
DROP POLICY IF EXISTS "tm_owner_insert" ON public.team_members;
CREATE POLICY "tm_owner_insert" ON public.team_members
  FOR INSERT TO authenticated
  WITH CHECK (
    team_id IN (SELECT id FROM public.teams WHERE owner_id = auth.uid())
    OR user_id = auth.uid()   -- 允许创建者插入自己的 owner 记录
  );

-- ── api_keys ──────────────────────────────────────────────────────────────
-- 用户只能创建属于自己的 key
DROP POLICY IF EXISTS "ak_own_insert" ON public.api_keys;
CREATE POLICY "ak_own_insert" ON public.api_keys
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ── team_invitations ──────────────────────────────────────────────────────
-- 允许团队所有者创建邀请记录
DROP POLICY IF EXISTS "ti_owner_insert" ON public.team_invitations;
CREATE POLICY "ti_owner_insert" ON public.team_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    team_id IN (SELECT id FROM public.teams WHERE owner_id = auth.uid())
  );
