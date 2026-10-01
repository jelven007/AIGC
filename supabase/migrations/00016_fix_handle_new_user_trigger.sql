
-- 重新创建 handle_new_user 函数，添加异常处理
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
  v_free_plan_id uuid;
BEGIN
  -- 从邮箱前缀生成用户名
  v_username := split_part(NEW.email, '@', 1);

  -- 创建 profiles 记录（忽略已存在的冲突）
  BEGIN
    INSERT INTO public.profiles (id, email, username, role)
    VALUES (NEW.id, NEW.email, v_username, 'user');
  EXCEPTION WHEN unique_violation THEN
    -- 已存在，无需处理
    NULL;
  WHEN OTHERS THEN
    RAISE NOTICE 'profiles insert error: %', SQLERRM;
  END;

  -- 绑定免费套餐
  BEGIN
    SELECT id INTO v_free_plan_id FROM public.plans WHERE name = '免费版' LIMIT 1;
    IF v_free_plan_id IS NOT NULL THEN
      INSERT INTO public.user_plans (user_id, plan_id, credits_total, credits_used)
      VALUES (NEW.id, v_free_plan_id, 100, 0);
    END IF;
  EXCEPTION WHEN unique_violation THEN
    -- 已存在，无需处理
    NULL;
  WHEN OTHERS THEN
    RAISE NOTICE 'user_plans insert error: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
