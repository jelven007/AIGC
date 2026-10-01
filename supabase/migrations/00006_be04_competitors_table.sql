
-- BE-04: 竞品监控表（CompetitorPage DB 持久化）
CREATE TABLE competitors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  platform    text NOT NULL DEFAULT 'douyin',
  account_id  text,
  avatar_url  text,
  followers   bigint DEFAULT 0,
  avg_views   bigint DEFAULT 0,
  top_videos  jsonb DEFAULT '[]',
  tags        text[] DEFAULT '{}',
  trend       text DEFAULT 'stable',
  score       int DEFAULT 50,
  monitored   boolean DEFAULT true,
  last_updated_at timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competitors_crud_own" ON competitors
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 竞品监控推送通知表
CREATE TABLE competitor_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  competitor_id uuid REFERENCES competitors(id) ON DELETE CASCADE,
  alert_type   text NOT NULL, -- 'new_video'|'follower_milestone'|'trending'
  title        text NOT NULL,
  body         text,
  is_read      boolean DEFAULT false,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE competitor_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alerts_own" ON competitor_alerts
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
