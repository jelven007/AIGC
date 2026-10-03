-- 修复：注册后客户端兜底建档被 RLS 拒绝（POST /rest/v1/profiles 403）
--
-- 背景：
--   00001 中 profiles 仅定义了 SELECT / UPDATE 与 admin 的 FOR ALL 策略，
--   普通用户没有 INSERT 权限。handle_new_user 触发器虽是建档主路径，但前端
--   （LoginPage 注册成功后、Demo 一键登录）仍保留 upsert 兜底；一旦触发器
--   未生效，兜底写入会被 403 拒绝，产生"有账号无档案"（无昵称/邀请码）的脏数据。
--   upsert(on_conflict=id) 在 PostgREST 中按 INSERT 权限校验，无法命中仅
--   FOR UPDATE 的策略，因此兜底链路始终失败。
--
-- 方案：
--   新增"用户只能以 role='user' 身份创建本人档案"的 INSERT 策略。
--   WITH CHECK 强制 role='user'，杜绝注册时自封 admin 的提权路径；
--   admin 提权仍只能通过已登录用户的 UPDATE 策略以外的服务端途径完成。

CREATE POLICY "users_insert_own_profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id AND role = 'user');
