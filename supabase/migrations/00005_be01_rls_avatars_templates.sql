
-- BE-01: avatars / video_templates 补全 RLS
ALTER TABLE avatars ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_templates ENABLE ROW LEVEL SECURITY;

-- avatars: 所有人可读，仅 service role 可写
CREATE POLICY "avatars_public_read" ON avatars FOR SELECT USING (true);

-- video_templates: 所有人可读
CREATE POLICY "templates_public_read" ON video_templates FOR SELECT USING (true);
-- 已登录用户可创建自定义模板（用于保存自定义风格）
CREATE POLICY "templates_auth_insert" ON video_templates
  FOR INSERT TO authenticated WITH CHECK (true);
