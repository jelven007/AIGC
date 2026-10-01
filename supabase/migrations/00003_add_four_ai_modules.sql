
-- ═══════════════════════════════════════════════════════════════
-- 1. AI 智能脚本表
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE scripts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id      uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name    text NOT NULL DEFAULT '',
  selling_points  text[] NOT NULL DEFAULT '{}',
  target_audience text NOT NULL DEFAULT '',
  platform        text NOT NULL DEFAULT 'douyin',
  -- 生成结果
  scenes          jsonb NOT NULL DEFAULT '[]',   -- ScriptScene[]
  prompt_text     text NOT NULL DEFAULT '',
  -- 用户手动编辑后的版本
  edited_scenes   jsonb,
  edited_prompt   text,
  -- 状态
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generating','done','failed')),
  feedback_saved  boolean NOT NULL DEFAULT false, -- 是否已回写知识库
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scripts ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION can_access_script(script_id uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER AS $$
    SELECT EXISTS (SELECT 1 FROM scripts WHERE id = script_id AND user_id = auth.uid());
  $$;

CREATE POLICY "scripts_select" ON scripts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "scripts_insert" ON scripts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "scripts_update" ON scripts FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "scripts_delete" ON scripts FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- 2. 爆款风格分析表
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE style_analyses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type     text NOT NULL DEFAULT 'link' CHECK (source_type IN ('link','upload')),
  source_url      text,
  file_url        text,
  -- 分析报告
  rhythm          text,       -- 节奏类型
  transitions     text[],     -- 转场列表
  subtitle_style  text,       -- 字幕样式描述
  bgm_type        text,       -- bgm 类型
  bgm_mood        text,       -- bgm 情绪
  color_tone      text,
  pacing          text,
  report_data     jsonb NOT NULL DEFAULT '{}',  -- 完整可视化报告 JSON
  -- 应用状态
  applied_product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','analyzing','done','failed')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE style_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "style_analyses_select" ON style_analyses FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "style_analyses_insert" ON style_analyses FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "style_analyses_update" ON style_analyses FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "style_analyses_delete" ON style_analyses FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- 3. 流量诊断表
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE diagnostics (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id               uuid REFERENCES video_projects(id) ON DELETE SET NULL,
  -- 基础特征
  video_duration           numeric,
  pacing_distribution      jsonb DEFAULT '{}',
  subtitle_coverage        numeric,  -- 0-100 百分比
  -- 预测指标
  predicted_completion     numeric,
  predicted_like_rate      numeric,
  predicted_comment_rate   numeric,
  predicted_share_rate     numeric,
  -- 优化建议
  suggestions              jsonb NOT NULL DEFAULT '[]',  -- DiagSuggestion[]
  -- 一键优化
  optimized_script_id      uuid REFERENCES scripts(id) ON DELETE SET NULL,
  optimization_status      text NOT NULL DEFAULT 'idle' CHECK (optimization_status IN ('idle','processing','done','failed')),
  created_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE diagnostics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "diagnostics_select" ON diagnostics FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "diagnostics_insert" ON diagnostics FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "diagnostics_update" ON diagnostics FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "diagnostics_delete" ON diagnostics FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- 4. 知识库表（系统进化）
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE knowledge_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type     text NOT NULL DEFAULT 'script_edit' CHECK (source_type IN (
                    'script_edit','prompt_edit','optimization_adopt','optimization_reject'
                  )),
  source_id       uuid,         -- scripts.id / diagnostics.id 等
  title           text NOT NULL DEFAULT '',
  content         jsonb NOT NULL DEFAULT '{}',
  quality_score   smallint NOT NULL DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 5),
  is_applied      boolean NOT NULL DEFAULT false,  -- 是否已进入模型训练集
  applied_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "knowledge_entries_select" ON knowledge_entries FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "knowledge_entries_insert" ON knowledge_entries FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "knowledge_entries_update" ON knowledge_entries FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "knowledge_entries_delete" ON knowledge_entries FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- 5. 更新触发器：scripts.updated_at
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER scripts_updated_at BEFORE UPDATE ON scripts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 6. Demo 数据（演示用）
-- ═══════════════════════════════════════════════════════════════
-- 知识库 Demo（system 级示例，不关联实际用户，用 service 角色插入）
-- 只插入不含 user_id 约束的系统示例数据
