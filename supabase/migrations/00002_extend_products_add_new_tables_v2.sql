
-- ═══════════════════════════════════════════
-- 0. 确保 update_updated_at_column 函数存在
-- ═══════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ═══════════════════════════════════════════
-- 1. 扩展现有 products 表
-- ═══════════════════════════════════════════
ALTER TABLE products
  ADD COLUMN sub_category   text,
  ADD COLUMN description    text,
  ADD COLUMN original_price numeric(10,2),
  ADD COLUMN sale_price     numeric(10,2),
  ADD COLUMN stock          integer NOT NULL DEFAULT 0,
  ADD COLUMN specs          jsonb DEFAULT '[]',
  ADD COLUMN images         text[] DEFAULT '{}',
  ADD COLUMN cover_image    text,
  ADD COLUMN status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','draft')),
  ADD COLUMN sales_count    integer NOT NULL DEFAULT 0;

CREATE INDEX idx_products_user_id    ON products(user_id);
CREATE INDEX idx_products_status     ON products(status);
CREATE INDEX idx_products_category   ON products(category);
CREATE INDEX idx_products_created_at ON products(created_at DESC);

-- ═══════════════════════════════════════════
-- 2. 数字人表
-- ═══════════════════════════════════════════
CREATE TABLE avatars (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  gender        text NOT NULL DEFAULT 'female' CHECK (gender IN ('male','female','neutral')),
  language      text NOT NULL DEFAULT 'zh'     CHECK (language IN ('zh','en','both')),
  style         text NOT NULL DEFAULT '知性',
  tags          text[] DEFAULT '{}',
  preview_image text,
  sample_video  text,
  is_active     boolean NOT NULL DEFAULT true,
  use_count     integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_avatars_gender   ON avatars(gender);
CREATE INDEX idx_avatars_language ON avatars(language);
CREATE INDEX idx_avatars_style    ON avatars(style);

-- ═══════════════════════════════════════════
-- 3. 视频模板表
-- ═══════════════════════════════════════════
CREATE TABLE video_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  industry      text NOT NULL DEFAULT '电商'   CHECK (industry IN ('电商','教育','金融','美妆','其他')),
  scene         text NOT NULL DEFAULT '产品介绍' CHECK (scene IN ('产品介绍','节日促销','课程推广','品牌宣传','开箱测评')),
  thumbnail     text,
  preview_video text,
  use_count     integer NOT NULL DEFAULT 0,
  duration      integer DEFAULT 30,
  tags          text[] DEFAULT '{}',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_video_templates_industry ON video_templates(industry);
CREATE INDEX idx_video_templates_scene    ON video_templates(scene);

-- ═══════════════════════════════════════════
-- 4. 套餐表
-- ═══════════════════════════════════════════
CREATE TABLE plans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  level      integer NOT NULL DEFAULT 0,
  price      numeric(10,2) NOT NULL DEFAULT 0,
  credits    integer NOT NULL DEFAULT 0,
  features   jsonb DEFAULT '[]',
  limits     jsonb DEFAULT '{}',
  is_popular boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════
-- 5. 用户套餐订阅表
-- ═══════════════════════════════════════════
CREATE TABLE user_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  plan_id        uuid NOT NULL REFERENCES plans(id),
  credits_total  integer NOT NULL DEFAULT 0,
  credits_used   integer NOT NULL DEFAULT 0,
  cycle_start    timestamptz NOT NULL DEFAULT now(),
  cycle_end      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_plans_self" ON user_plans FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER update_user_plans_updated_at
  BEFORE UPDATE ON user_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════
-- 6. 积分流水表
-- ═══════════════════════════════════════════
CREATE TABLE credit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount        integer NOT NULL,
  type          text NOT NULL CHECK (type IN ('video_generate','template_download','material_upload','purchase','refund','bonus','deduct')),
  description   text NOT NULL,
  credits_after integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_logs_user_id    ON credit_logs(user_id);
CREATE INDEX idx_credit_logs_type       ON credit_logs(type);
CREATE INDEX idx_credit_logs_created_at ON credit_logs(created_at DESC);
ALTER TABLE credit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credit_logs_select" ON credit_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "credit_logs_insert" ON credit_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
