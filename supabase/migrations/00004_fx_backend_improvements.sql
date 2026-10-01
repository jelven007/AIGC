
-- B-01: 软删除字段 video_projects
ALTER TABLE public.video_projects ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- B-04: 视频生成任务队列表
CREATE TABLE public.video_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES public.video_projects(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  action        text NOT NULL DEFAULT 'generate_video',
  payload       jsonb NOT NULL DEFAULT '{}',
  result        jsonb,
  error_message text,
  progress      int NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 3,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.video_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_jobs" ON public.video_jobs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- B-03: 操作审计日志表
CREATE TABLE public.audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action      text NOT NULL,
  table_name  text NOT NULL,
  record_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_view_audit_logs" ON public.audit_logs
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
CREATE POLICY "system_insert_audit_logs" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- B-05: products全文搜索向量
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(name, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(description, '')
    )
  ) STORED;

-- B-08: 复合索引优化高频查询
CREATE INDEX IF NOT EXISTS idx_video_projects_user_status ON public.video_projects(user_id, status);
CREATE INDEX IF NOT EXISTS idx_video_projects_user_created ON public.video_projects(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_projects_deleted_at ON public.video_projects(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_user_created ON public.products(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_search_vector ON public.products USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_materials_user_type ON public.materials(user_id, type);
CREATE INDEX IF NOT EXISTS idx_video_jobs_user_status ON public.video_jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_video_jobs_project_id ON public.video_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON public.audit_logs(user_id, created_at DESC);

-- 触发器：video_jobs updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER update_video_jobs_updated_at
  BEFORE UPDATE ON public.video_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 软删除视图：过滤已删除的视频项目
CREATE OR REPLACE VIEW public.active_video_projects AS
  SELECT * FROM public.video_projects WHERE deleted_at IS NULL;
