-- 1. 删除导致递归的旧策略
DROP POLICY IF EXISTS "teams_member_read" ON public.teams;
DROP POLICY IF EXISTS "tm_owner" ON public.team_members;

-- 2. 创建 Security Definer 函数以规避 RLS 递归检查
CREATE OR REPLACE FUNCTION public.is_team_owner(t_id uuid, u_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.teams
    WHERE id = t_id AND owner_id = u_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_team_member(t_id uuid, u_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = t_id AND user_id = u_id AND status = 'active'
  );
END;
$$;

-- 3. 重新创建不产生循环的非递归策略
CREATE POLICY "teams_member_read" ON public.teams FOR SELECT TO authenticated
  USING (public.is_team_member(id, auth.uid()));

CREATE POLICY "tm_owner" ON public.team_members FOR ALL TO authenticated
  USING (public.is_team_owner(team_id, auth.uid()));
