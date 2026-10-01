
-- ── P2-M06: 持久化限流窗口表 ──────────────────────────────────────────────
CREATE TABLE public.rate_limit_windows (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  text NOT NULL,
  window_key text NOT NULL,          -- '{clientId}:{windowStart}'
  count      int  NOT NULL DEFAULT 1,
  reset_at   timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX rate_limit_windows_key_idx ON public.rate_limit_windows(window_key);
CREATE INDEX rate_limit_windows_client_idx ON public.rate_limit_windows(client_id);
ALTER TABLE public.rate_limit_windows ENABLE ROW LEVEL SECURITY;

-- ── P2-N06: LLM 响应缓存表 ───────────────────────────────────────────────
CREATE TABLE public.llm_cache (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key    text UNIQUE NOT NULL,   -- MD5(action + sorted params)
  action       text NOT NULL,
  response     jsonb NOT NULL,
  hit_count    int  NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX llm_cache_key_idx     ON public.llm_cache(cache_key);
CREATE INDEX llm_cache_expires_idx ON public.llm_cache(expires_at);

-- ── P1-M10: 微信支付订单表 ────────────────────────────────────────────────
CREATE TYPE order_status AS ENUM ('pending','paid','cancelled','refunded','partial_refunded');

CREATE TABLE public.orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no        text UNIQUE NOT NULL,
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  plan_id         uuid REFERENCES public.plans(id),
  status          order_status NOT NULL DEFAULT 'pending',
  total_amount    numeric(12,2) NOT NULL,
  wechat_pay_url  text,
  paid_at         timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX orders_user_idx   ON public.orders(user_id);
CREATE INDEX orders_status_idx ON public.orders(status);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Orders: 用户只能查自己的订单
CREATE POLICY "orders_user_select" ON public.orders
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "orders_user_insert" ON public.orders
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ── P2-M05: video_jobs 扩展（attempts + queue_position + platform_format） ──
ALTER TABLE public.video_jobs
  ADD COLUMN IF NOT EXISTS attempts       int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts   int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_retry_at  timestamptz,
  ADD COLUMN IF NOT EXISTS platform_format text,   -- '9:16'|'16:9'|'1:1'
  ADD COLUMN IF NOT EXISTS queue_position int;

-- ── P2-N01: A/B测试变体真实数据表 ─────────────────────────────────────────
CREATE TABLE public.ab_test_variants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.video_projects(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  variant_label   text NOT NULL,          -- 'A', 'B', 'C'...
  title           text,
  description     text,
  video_url       text,
  thumbnail_url   text,
  impressions     int NOT NULL DEFAULT 0,
  clicks          int NOT NULL DEFAULT 0,
  conversions     int NOT NULL DEFAULT 0,
  watch_duration  numeric(6,2) DEFAULT 0, -- 平均观看时长(s)
  is_winner       boolean DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX ab_test_variants_project_idx ON public.ab_test_variants(project_id);
ALTER TABLE public.ab_test_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ab_variants_user_all" ON public.ab_test_variants
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── P2-N03: 封面候选图表 ──────────────────────────────────────────────────
CREATE TABLE public.cover_candidates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.video_projects(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id),
  image_url    text NOT NULL,
  ctr_score    numeric(5,2) DEFAULT 0,    -- 点击率预测分
  is_selected  boolean DEFAULT false,
  gen_task_id  text,                       -- image-generation task ID
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX cover_candidates_project_idx ON public.cover_candidates(project_id);
ALTER TABLE public.cover_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cover_candidates_user_all" ON public.cover_candidates
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── P2-N04: 多语言脚本表 ─────────────────────────────────────────────────
CREATE TABLE public.multilang_scripts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid REFERENCES public.video_projects(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  source_language text NOT NULL DEFAULT 'zh',
  target_language text NOT NULL,
  original_text   text NOT NULL,
  translated_text text,
  tts_audio_url   text,
  status          text NOT NULL DEFAULT 'pending', -- pending|translating|done|failed
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX multilang_scripts_project_idx ON public.multilang_scripts(project_id);
ALTER TABLE public.multilang_scripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "multilang_scripts_user_all" ON public.multilang_scripts
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── P1-M04: 积分消耗配置表（行为→积分） ──────────────────────────────────
CREATE TABLE public.credit_costs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action      text UNIQUE NOT NULL,
  cost        int  NOT NULL DEFAULT 1,
  description text,
  created_at  timestamptz DEFAULT now()
);
INSERT INTO public.credit_costs (action, cost, description) VALUES
  ('generate_selling_points',    2,  '生成商品卖点'),
  ('optimize_prompt',            3,  '优化 Prompt'),
  ('generate_storyboard',        5,  '生成分镜脚本'),
  ('generate_video',            50,  '生成带货视频'),
  ('analyze_style',             10,  '分析爆款风格'),
  ('analyze_traffic',           10,  '流量分析与预测'),
  ('generate_script_four_layer', 8,  '四层结构脚本生成'),
  ('extract_highlights',        15,  '直播高光切片提取'),
  ('content_moderation',         1,  '内容安全审核'),
  ('emotion_analysis',           3,  '情绪NLP分析'),
  ('translate_script',           5,  '多语言脚本翻译'),
  ('generate_cover',            10,  '智能封面生成');

-- ── 实时发布：新增表加入 Realtime ────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.video_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
