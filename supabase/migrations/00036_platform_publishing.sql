BEGIN;
CREATE TABLE public.platform_apps (
  platform text PRIMARY KEY CHECK(platform IN ('tiktok','douyin')),
  client_key text NOT NULL,
  secret_ciphertext text NOT NULL,
  redirect_uri text NOT NULL,
  scopes text[] NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.platform_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  platform text NOT NULL REFERENCES platform_apps(platform),
  open_id text NOT NULL,
  display_name text NOT NULL,
  token_ciphertext text NOT NULL,
  scopes text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','revoked')),
  refresh_lease uuid,
  refresh_until timestamptz,
  app_snapshot jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,platform,open_id)
);
CREATE TABLE public.platform_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  platform text NOT NULL REFERENCES platform_apps(platform),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  used_at timestamptz
  ,app_snapshot jsonb NOT NULL
);
ALTER TABLE platform_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_apps,platform_connections,platform_oauth_states FROM PUBLIC,anon,authenticated;
GRANT ALL ON platform_apps,platform_connections,platform_oauth_states TO service_role;
ALTER TABLE publish_tasks DROP CONSTRAINT publish_tasks_status_check;
ALTER TABLE publish_tasks ADD CONSTRAINT publish_tasks_status_check
  CHECK(status IN ('draft','scheduled','publishing','submitted','moderating','published','failed','unknown','cancelled'));
ALTER TABLE publish_tasks ADD COLUMN connection_id uuid REFERENCES platform_connections(id),
  ADD COLUMN request_key uuid,
  ADD COLUMN job_id uuid REFERENCES production_jobs(id),
  ADD COLUMN publish_options jsonb,
  ADD COLUMN source_url text,
  ADD COLUMN source_duration numeric,
  ADD COLUMN metrics_next_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN metrics_error text;
CREATE UNIQUE INDEX publish_request_key ON publish_tasks(user_id,request_key) WHERE request_key IS NOT NULL;
REVOKE INSERT,UPDATE,DELETE ON publish_tasks FROM authenticated,anon;
-- 累计自然视频指标与广告按日指标分开，未授权的CTR/CVR/营收保持缺失。
CREATE TABLE public.platform_video_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  publish_task_id uuid NOT NULL REFERENCES publish_tasks(id),
  platform text NOT NULL,
  video_id text NOT NULL,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  share_count bigint,
  collected_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'official_api',
  raw_metrics jsonb NOT NULL,
  UNIQUE(publish_task_id)
);
CREATE TABLE public.platform_metric_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  publish_task_id uuid NOT NULL REFERENCES publish_tasks(id),
  collected_at timestamptz NOT NULL DEFAULT now(),
  metrics jsonb NOT NULL
);
ALTER TABLE platform_video_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_metric_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_video_metrics,platform_metric_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON platform_video_metrics,platform_metric_history TO authenticated;
GRANT ALL ON platform_video_metrics,platform_metric_history TO service_role;
GRANT USAGE,SELECT ON SEQUENCE platform_metric_history_id_seq TO service_role;
CREATE POLICY own_video_metrics ON platform_video_metrics FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY own_metric_history ON platform_metric_history FOR SELECT TO authenticated USING(user_id=auth.uid());

CREATE FUNCTION public.sync_publish_job_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.kind='publish' AND NEW.status IN ('unknown','failed','cancelled') THEN
    UPDATE publish_tasks SET status=NEW.status,error_message=NEW.error_message WHERE job_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER production_publish_status AFTER UPDATE OF status ON production_jobs
  FOR EACH ROW EXECUTE FUNCTION sync_publish_job_status();

CREATE FUNCTION public.save_platform_metrics(p_task uuid,p_metrics jsonb,p_url text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_task publish_tasks%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_task FROM publish_tasks WHERE id=p_task FOR UPDATE;
  INSERT INTO platform_video_metrics(user_id,publish_task_id,platform,video_id,view_count,like_count,comment_count,share_count,raw_metrics)
  VALUES(v_task.user_id,p_task,v_task.platform,v_task.platform_video_id,(p_metrics->>'view_count')::bigint,
    (p_metrics->>'like_count')::bigint,(p_metrics->>'comment_count')::bigint,(p_metrics->>'share_count')::bigint,p_metrics)
  ON CONFLICT(publish_task_id) DO UPDATE SET view_count=EXCLUDED.view_count,like_count=EXCLUDED.like_count,
    comment_count=EXCLUDED.comment_count,share_count=EXCLUDED.share_count,raw_metrics=EXCLUDED.raw_metrics,collected_at=now();
  INSERT INTO platform_metric_history(user_id,publish_task_id,metrics) VALUES(v_task.user_id,p_task,p_metrics);
  IF p_url LIKE 'https://%' THEN UPDATE publish_tasks SET platform_url=p_url WHERE id=p_task; END IF;
END;
$$;

CREATE FUNCTION public.consume_platform_state(p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_state platform_oauth_states%ROWTYPE;
BEGIN
  UPDATE platform_oauth_states SET used_at=now() WHERE state_hash=p_hash AND used_at IS NULL AND expires_at>now()
  RETURNING * INTO v_state;
  IF NOT FOUND THEN RAISE EXCEPTION '授权状态已失效'; END IF;
  RETURN to_jsonb(v_state);
END;
$$;
CREATE FUNCTION public.create_platform_publish(
  p_user_id uuid,p_request uuid,p_project uuid,p_connection uuid,p_title text,
  p_description text,p_tags text[],p_options jsonb,p_schedule timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_task publish_tasks%ROWTYPE; v_project video_projects%ROWTYPE; v_connection platform_connections%ROWTYPE; v_job jsonb;
BEGIN
  PERFORM 1 FROM user_plans WHERE user_id=p_user_id FOR UPDATE;
  SELECT * INTO v_task FROM publish_tasks WHERE user_id=p_user_id AND request_key=p_request;
  IF FOUND THEN
    IF v_task.project_id IS DISTINCT FROM p_project OR v_task.connection_id IS DISTINCT FROM p_connection
      OR v_task.title IS DISTINCT FROM p_title OR v_task.description IS DISTINCT FROM p_description
      OR v_task.tags IS DISTINCT FROM p_tags OR v_task.publish_options IS DISTINCT FROM p_options
      OR v_task.scheduled_at IS DISTINCT FROM p_schedule THEN RAISE EXCEPTION '同一请求标识不能用于不同发布'; END IF;
    RETURN to_jsonb(v_task);
  END IF;
  SELECT * INTO STRICT v_project FROM video_projects WHERE id=p_project AND user_id=p_user_id AND status='completed';
  SELECT * INTO STRICT v_connection FROM platform_connections WHERE id=p_connection AND user_id=p_user_id AND status='active';
  IF NOT EXISTS(SELECT 1 FROM platform_apps WHERE platform=v_connection.platform AND enabled) THEN RAISE EXCEPTION '平台应用未启用'; END IF;
  IF v_project.video_url IS NULL OR p_options->>'consent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '缺少成片或发布确认'; END IF;
  IF EXISTS(SELECT 1 FROM production_jobs WHERE project_id=p_project AND kind='render' AND status IN ('pending','running')) THEN RAISE EXCEPTION '作品仍在渲染'; END IF;
  v_job:=create_production_job(p_user_id,p_request,'publish',
    jsonb_build_object('connection_id',p_connection,'source_url',v_project.video_url,
      'duration',v_project.duration,'title',p_title,'description',p_description,'tags',p_tags,'options',p_options),p_project,NULL);
  UPDATE production_jobs SET next_run_at=COALESCE(p_schedule,now()) WHERE id=(v_job->>'id')::uuid;
  INSERT INTO publish_tasks(user_id,request_key,project_id,connection_id,platform,title,description,tags,publish_options,
    scheduled_at,job_id,status,source_url,source_duration)
  VALUES(p_user_id,p_request,p_project,p_connection,v_connection.platform,p_title,p_description,p_tags,p_options,
    p_schedule,(v_job->>'id')::uuid,CASE WHEN p_schedule IS NULL THEN 'draft' ELSE 'scheduled' END,v_project.video_url,v_project.duration)
  RETURNING * INTO v_task;
  RETURN to_jsonb(v_task);
END;
$$;
CREATE FUNCTION public.claim_platform_refresh(p_connection uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_token uuid:=gen_random_uuid();
BEGIN
  UPDATE platform_connections SET refresh_lease=v_token,refresh_until=now()+interval '90 seconds'
  WHERE id=p_connection AND (refresh_until IS NULL OR refresh_until<now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_token;
END;
$$;
CREATE FUNCTION public.cancel_platform_publish(p_user uuid,p_task uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_task publish_tasks%ROWTYPE; v_job production_jobs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_task FROM publish_tasks WHERE id=p_task AND user_id=p_user;
  PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
  PERFORM 1 FROM video_projects WHERE id=v_task.project_id FOR UPDATE;
  SELECT * INTO STRICT v_job FROM production_jobs WHERE id=v_task.job_id FOR UPDATE;
  PERFORM 1 FROM publish_tasks WHERE id=p_task FOR UPDATE;
  IF v_job.status<>'pending' OR v_job.phase<>'ready' THEN RAISE EXCEPTION '任务已经开始执行'; END IF;
  UPDATE production_jobs SET status='cancelled' WHERE id=v_job.id;
  UPDATE publish_tasks SET status='cancelled' WHERE id=p_task;
END;
$$;
REVOKE ALL ON FUNCTION consume_platform_state(text),
  create_platform_publish(uuid,uuid,uuid,uuid,text,text,text[],jsonb,timestamptz),claim_platform_refresh(uuid),
  cancel_platform_publish(uuid,uuid),save_platform_metrics(uuid,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION consume_platform_state(text),
  create_platform_publish(uuid,uuid,uuid,uuid,text,text,text[],jsonb,timestamptz),claim_platform_refresh(uuid),
  cancel_platform_publish(uuid,uuid),save_platform_metrics(uuid,jsonb,text) TO service_role;
COMMIT;
