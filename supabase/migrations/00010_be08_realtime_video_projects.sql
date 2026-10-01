
-- BE-08: 开启 Realtime 复制（video_projects 进度推送）
ALTER PUBLICATION supabase_realtime ADD TABLE video_projects;

-- BE-09: 错误日志表（Edge Function 错误记录）
CREATE TABLE IF NOT EXISTS error_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source      text NOT NULL DEFAULT 'edge_function',
  action      text,
  error_code  text,
  error_msg   text,
  request_id  text,
  meta        jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- 仅 admin 可读，服务端写
CREATE POLICY "error_logs_admin_read" ON error_logs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- prompt_templates 表（AI-05 Prompt 模板库）
CREATE TABLE IF NOT EXISTS prompt_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  category    text NOT NULL DEFAULT 'general',
  platform    text DEFAULT 'douyin',
  content     text NOT NULL,
  variables   jsonb DEFAULT '[]',
  is_system   boolean DEFAULT false,
  use_count   int DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prompt_templates_read" ON prompt_templates
  FOR SELECT USING (is_system = true OR user_id = auth.uid());
CREATE POLICY "prompt_templates_insert" ON prompt_templates
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "prompt_templates_update" ON prompt_templates
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "prompt_templates_delete" ON prompt_templates
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 内置系统模板种子数据
INSERT INTO prompt_templates (title, category, platform, content, is_system, variables) VALUES
('美妆开箱钩子', 'hook', 'douyin', '第一秒震撼开箱，产品特写配合冲击音效，字幕"你还在用那个XX吗？"悬念引导，暖色调灯光，竖屏9:16', true, '[]'),
('数码对比测评', 'review', 'douyin', '分屏对比展示旧产品vs{{product_name}}，左侧痛点场景，右侧产品解决方案，快节奏剪辑配电子BGM', true, '[{"name":"product_name","label":"商品名称"}]'),
('食品开吃ASMR', 'lifestyle', 'douyin', 'ASMR风格食品特写，慢动作液体流淌/咬合画面，自然光源，文字描述口感，暖黄色调温馨感', true, '[]'),
('家居场景种草', 'lifestyle', 'douyin', '家居实景布置+产品融入，生活化场景出镜，对白式口播"发现了个宝贝"，浅景深拍摄，文艺小清新风格', true, '[]'),
('TikTok强钩子模板', 'hook', 'tiktok', 'POV shot direct eye contact 0-2s, text overlay "Wait for it..." dramatic pause, product reveal with sound effect at 3s, fast cuts energetic music', true, '[]');
