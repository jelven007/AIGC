
-- 补全索引（性能优化）
CREATE INDEX IF NOT EXISTS idx_video_projects_user_status ON video_projects (user_id, status);
CREATE INDEX IF NOT EXISTS idx_scripts_user ON scripts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_materials_user ON materials (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_competitors_user ON competitors (user_id);
CREATE INDEX IF NOT EXISTS idx_competitor_alerts_user_read ON competitor_alerts (user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_products_user ON products (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_category ON prompt_templates (category, is_system);

-- 自动创建 profile + user_plan（注册后触发）
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_username text;
  v_free_plan_id uuid;
BEGIN
  -- 从邮箱前缀生成用户名（去掉 @miaoda.com）
  v_username := split_part(NEW.email, '@', 1);

  INSERT INTO profiles (id, email, username, role)
  VALUES (NEW.id, NEW.email, v_username, 'user')
  ON CONFLICT (id) DO NOTHING;

  -- 绑定免费套餐
  SELECT id INTO v_free_plan_id FROM plans WHERE name = '免费版' LIMIT 1;
  IF v_free_plan_id IS NOT NULL THEN
    INSERT INTO user_plans (user_id, plan_id, credits_remaining)
    VALUES (NEW.id, v_free_plan_id, 100)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 删除旧触发器（如存在）再创建
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
