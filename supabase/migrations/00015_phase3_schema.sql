
-- ══════════════════════════════════════════════
-- Phase 3 Schema: 团队协作 + 开放API + 竞品监控 + 爆款特征库 + 发布管理 + 投放数据
-- ══════════════════════════════════════════════

-- ─── P3-M03: 团队协作 ─────────────────────────────────────────────────────
CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan        text NOT NULL DEFAULT 'free',
  max_members int  NOT NULL DEFAULT 5,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id   uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','editor','viewer')),
  status    text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','removed')),
  invited_email text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

CREATE TABLE team_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'editor',
  token       text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by  uuid NOT NULL REFERENCES auth.users(id),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── P3-M04: 开放 API ────────────────────────────────────────────────────
CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  key_prefix   text NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{"video:create","script:generate"}',
  rate_limit   int  NOT NULL DEFAULT 100,
  last_used_at timestamptz,
  expires_at   timestamptz,
  is_active    boolean NOT NULL DEFAULT true,
  total_calls  bigint  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_call_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id   uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  endpoint     text NOT NULL,
  method       text NOT NULL DEFAULT 'POST',
  status_code  int,
  latency_ms   int,
  request_size int,
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_call_logs_key_idx ON api_call_logs(api_key_id, created_at DESC);

-- ─── P3-M01: 竞品监控 ────────────────────────────────────────────────────
CREATE TABLE competitor_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform     text NOT NULL DEFAULT 'douyin' CHECK (platform IN ('douyin','tiktok','xiaohongshu','kuaishou')),
  account_id   text NOT NULL,
  account_name text NOT NULL,
  avatar_url   text,
  category     text,
  follower_count bigint DEFAULT 0,
  is_monitoring boolean NOT NULL DEFAULT true,
  last_crawled_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE competitor_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES competitor_accounts(id) ON DELETE CASCADE,
  video_id        text NOT NULL,
  title           text,
  cover_url       text,
  video_url       text,
  play_count      bigint DEFAULT 0,
  like_count      bigint DEFAULT 0,
  comment_count   bigint DEFAULT 0,
  share_count     bigint DEFAULT 0,
  duration        int DEFAULT 0,
  style_tags      text[],
  hook_type       text,
  is_trending     boolean DEFAULT false,
  published_at    timestamptz,
  crawled_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, video_id)
);
CREATE INDEX comp_snap_account_idx ON competitor_snapshots(account_id, crawled_at DESC);
CREATE INDEX comp_snap_trending_idx ON competitor_snapshots(is_trending, play_count DESC);

-- ─── P3-M02: 直播高光 ────────────────────────────────────────────────────
CREATE TABLE live_highlights (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id     uuid REFERENCES video_projects(id) ON DELETE SET NULL,
  source_url     text NOT NULL,
  title          text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  asr_transcript jsonb,
  highlights     jsonb,
  clip_count     int DEFAULT 0,
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);

-- ─── P3-M05: 数据看板 ────────────────────────────────────────────────────
CREATE TABLE report_exports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type  text NOT NULL DEFAULT 'summary',
  time_range   text NOT NULL DEFAULT '7d',
  format       text NOT NULL DEFAULT 'xlsx',
  status       text NOT NULL DEFAULT 'pending',
  file_url     text,
  row_count    int DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- ─── P3-S01: 发布管理 ────────────────────────────────────────────────────
CREATE TABLE publish_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('douyin','tiktok','xiaohongshu','kuaishou','bilibili')),
  title           text,
  description     text,
  tags            text[],
  cover_url       text,
  scheduled_at    timestamptz,
  published_at    timestamptz,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','publishing','published','failed')),
  platform_video_id text,
  platform_url    text,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── P3-S02: 投放数据回流 ────────────────────────────────────────────────
CREATE TABLE ad_performance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES video_projects(id) ON DELETE SET NULL,
  platform        text NOT NULL,
  date            date NOT NULL,
  impressions     bigint DEFAULT 0,
  clicks          bigint DEFAULT 0,
  conversions     bigint DEFAULT 0,
  spend           numeric(12,2) DEFAULT 0,
  revenue         numeric(12,2) DEFAULT 0,
  play_count      bigint DEFAULT 0,
  avg_watch_time  numeric(8,2) DEFAULT 0,
  ctr             numeric(8,4) DEFAULT 0,
  cvr             numeric(8,4) DEFAULT 0,
  roas            numeric(8,4) DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, project_id, platform, date)
);

-- ─── P3-S03: 爆款特征库 ────────────────────────────────────────────────────
CREATE TABLE trending_patterns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category        text NOT NULL,
  platform        text NOT NULL DEFAULT 'douyin',
  pattern_name    text NOT NULL,
  hook_type       text,
  video_style     text,
  avg_duration    int DEFAULT 30,
  avg_play_rate   numeric(8,4) DEFAULT 0,
  avg_ctr         numeric(8,4) DEFAULT 0,
  sample_count    int DEFAULT 0,
  feature_tags    text[],
  description     text,
  example_urls    text[],
  is_active       boolean NOT NULL DEFAULT true,
  trend_score     numeric(8,2) DEFAULT 0,
  recorded_at     date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trending_patterns_cat_idx ON trending_patterns(category, trend_score DESC);

-- ─── P3-S04: 个性化偏好 ────────────────────────────────────────────────────
CREATE TABLE user_style_preferences (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  preferred_styles   text[],
  preferred_tones    text[],
  preferred_hooks    text[],
  cta_patterns       text[],
  avg_script_length  int DEFAULT 300,
  sample_scripts     jsonb,
  last_updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ══ RLS ══════════════════════════════════════════════════════════════════════
ALTER TABLE teams                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invitations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys               ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_call_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_highlights        ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_exports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE publish_tasks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_performance         ENABLE ROW LEVEL SECURITY;
ALTER TABLE trending_patterns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_style_preferences ENABLE ROW LEVEL SECURITY;

-- teams: owner全权，成员可读
CREATE POLICY "teams_owner"   ON teams FOR ALL    TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "teams_member_read" ON teams FOR SELECT TO authenticated
  USING (id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid() AND status = 'active'));

-- team_members: team owner可管理，成员可读自己
CREATE POLICY "tm_owner"   ON team_members FOR ALL TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));
CREATE POLICY "tm_self"    ON team_members FOR SELECT TO authenticated USING (user_id = auth.uid());

-- team_invitations: owner可管理
CREATE POLICY "ti_owner"   ON team_invitations FOR ALL TO authenticated
  USING (team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));

-- api_keys: 用户只访问自己的
CREATE POLICY "ak_own"     ON api_keys      FOR ALL    TO authenticated USING (user_id = auth.uid());
CREATE POLICY "acl_own"    ON api_call_logs FOR SELECT TO authenticated USING (user_id = auth.uid());

-- competitor data: 用户各自独立
CREATE POLICY "ca_own"     ON competitor_accounts  FOR ALL TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cs_own"     ON competitor_snapshots FOR SELECT TO authenticated
  USING (account_id IN (SELECT id FROM competitor_accounts WHERE user_id = auth.uid()));

-- live_highlights: 用户各自
CREATE POLICY "lh_own"     ON live_highlights FOR ALL TO authenticated USING (user_id = auth.uid());

-- report_exports: 用户各自
CREATE POLICY "re_own"     ON report_exports FOR ALL TO authenticated USING (user_id = auth.uid());

-- publish_tasks: 用户各自
CREATE POLICY "pt_own"     ON publish_tasks  FOR ALL TO authenticated USING (user_id = auth.uid());

-- ad_performance: 用户各自
CREATE POLICY "ap_own"     ON ad_performance FOR ALL TO authenticated USING (user_id = auth.uid());

-- trending_patterns: 全员可读（公共知识库）
CREATE POLICY "tp_read"    ON trending_patterns     FOR SELECT TO authenticated USING (true);

-- user_style_preferences: 只访问自己的
CREATE POLICY "usp_own"    ON user_style_preferences FOR ALL TO authenticated USING (user_id = auth.uid());

-- ══ 种子数据：爆款特征库 ══════════════════════════════════════════════════════
INSERT INTO trending_patterns (category, platform, pattern_name, hook_type, video_style, avg_duration, avg_play_rate, avg_ctr, sample_count, feature_tags, description, trend_score) VALUES
('美妆', 'douyin', '痛点开场+产品逆袭', 'pain_point', '真人出镜', 30, 0.72, 0.08, 120, ARRAY['痛点','变美','对比'], '先展示用户痛点，再用产品解决，形成强烈前后对比', 92.5),
('美妆', 'douyin', '成分科普+信任背书', 'education', '图文解说', 45, 0.65, 0.06, 89, ARRAY['成分','专业','科普'], '以成分解析建立专业形象，提升产品信任度', 85.3),
('美妆', 'tiktok', 'Before/After Challenge', 'challenge', '变装', 15, 0.81, 0.12, 203, ARRAY['challenge','变装','效果'], 'TikTok热门变装挑战形式，利用音乐卡点展示效果', 95.1),
('食品', 'douyin', '探店+真实反应', 'reaction', '第一视角', 25, 0.68, 0.07, 156, ARRAY['探店','真实','好吃'], '第一视角真实探店记录，强调真实感与食欲', 88.7),
('食品', 'xiaohongshu', '食谱教程+氛围感', 'tutorial', '慢生活', 60, 0.55, 0.09, 78, ARRAY['食谱','氛围','生活'], '精心布景的烹饪教程，强调生活美学与品质', 79.2),
('数码', 'douyin', '开箱+上手体验', 'unboxing', '测评', 60, 0.62, 0.05, 234, ARRAY['开箱','测评','真实'], '真实开箱过程+即时反馈，强调产品第一印象', 83.4),
('数码', 'bilibili', '深度评测+横向对比', 'comparison', '专业测评', 300, 0.48, 0.04, 67, ARRAY['测评','对比','专业'], 'B站用户偏好深度内容，横向对比更具说服力', 76.8),
('服装', 'xiaohongshu', 'OOTD穿搭分享', 'lifestyle', '穿搭展示', 30, 0.71, 0.10, 189, ARRAY['穿搭','OOTD','搭配'], '生活化场景下的穿搭展示，强调日常可复制性', 91.2),
('服装', 'tiktok', 'Try-On Haul', 'haul', '试穿', 60, 0.76, 0.11, 145, ARRAY['haul','试穿','多件'], '批量试穿展示，TikTok平台高转化率内容形式', 93.6),
('母婴', 'douyin', '妈妈真实分享', 'testimony', '生活记录', 45, 0.74, 0.08, 98, ARRAY['真实','妈妈','宝宝'], '真实妈妈视角分享育儿经验，信任度极高', 89.1);
