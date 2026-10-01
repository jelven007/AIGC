
CREATE TABLE batch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paused','completed','failed','cancelled')),
  total_count integer NOT NULL DEFAULT 0,
  completed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE batch_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  video_project_id uuid REFERENCES video_projects(id) ON DELETE SET NULL,
  error_message text,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX idx_batch_jobs_user_id ON batch_jobs(user_id);
CREATE INDEX idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX idx_batch_job_items_batch_id ON batch_job_items(batch_id);
CREATE INDEX idx_batch_job_items_status ON batch_job_items(status);

-- RLS
ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_job_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY batch_jobs_select ON batch_jobs FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY batch_jobs_insert ON batch_jobs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY batch_jobs_update ON batch_jobs FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY batch_jobs_delete ON batch_jobs FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY batch_items_select ON batch_job_items FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM batch_jobs b WHERE b.id = batch_job_items.batch_id AND b.user_id = auth.uid())
);
CREATE POLICY batch_items_insert ON batch_job_items FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM batch_jobs b WHERE b.id = batch_job_items.batch_id AND b.user_id = auth.uid())
);
CREATE POLICY batch_items_update ON batch_job_items FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM batch_jobs b WHERE b.id = batch_job_items.batch_id AND b.user_id = auth.uid())
);
