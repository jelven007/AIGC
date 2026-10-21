BEGIN;
UPDATE storage.buckets SET public=false WHERE id IN ('materials','videos','thumbnails');
DROP POLICY IF EXISTS public_read_all ON storage.objects;
DROP POLICY IF EXISTS auth_upload_materials ON storage.objects;
DROP POLICY IF EXISTS auth_delete_own ON storage.objects;
CREATE TABLE public.legacy_media_access (
  bucket text NOT NULL, path text NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY(bucket,path,user_id)
);
ALTER TABLE public.legacy_media_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legacy_media_access FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.legacy_media_access TO authenticated;
GRANT ALL ON public.legacy_media_access TO service_role;
CREATE POLICY own_legacy_media ON public.legacy_media_access FOR SELECT TO authenticated USING(user_id=auth.uid());
-- 只为旧表中已属于用户的同项目对象授权；不猜测无归属路径。
INSERT INTO public.legacy_media_access(bucket,path,user_id)
SELECT match[1],match[2],user_id FROM (
  SELECT regexp_match(url,'/storage/v1/object/public/(materials|videos|thumbnails)/([^?#]+)') AS match,user_id FROM materials
  UNION ALL SELECT regexp_match(video_url,'/storage/v1/object/public/(materials|videos|thumbnails)/([^?#]+)'),user_id FROM video_projects
  UNION ALL SELECT regexp_match(thumbnail_url,'/storage/v1/object/public/(materials|videos|thumbnails)/([^?#]+)'),user_id FROM video_projects
) resources JOIN storage.objects object ON object.bucket_id=match[1] AND object.name=match[2]
WHERE match IS NOT NULL AND resources.user_id::text IN (
  to_jsonb(object)->>'owner_id',to_jsonb(object)->>'owner'
) ON CONFLICT DO NOTHING;
CREATE FUNCTION public.owns_storage_path(p_path text,p_uid uuid) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT p_uid IS NOT NULL AND (
    split_part(p_path,'/',1)=p_uid::text OR
    (split_part(p_path,'/',1) IN ('generated-videos','generated-images') AND split_part(p_path,'/',2)=p_uid::text)
  );
$$;
CREATE POLICY private_media_read ON storage.objects FOR SELECT TO authenticated
  USING(bucket_id IN ('materials','videos','thumbnails') AND (public.owns_storage_path(name,auth.uid())
    OR EXISTS(SELECT 1 FROM public.legacy_media_access WHERE bucket=storage.objects.bucket_id AND path=storage.objects.name AND user_id=auth.uid())));
CREATE POLICY private_media_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK(bucket_id IN ('materials','videos','thumbnails') AND split_part(name,'/',1)=auth.uid()::text);
CREATE POLICY private_media_update ON storage.objects FOR UPDATE TO authenticated
  USING(bucket_id IN ('materials','videos','thumbnails') AND split_part(name,'/',1)=auth.uid()::text)
  WITH CHECK(bucket_id IN ('materials','videos','thumbnails') AND split_part(name,'/',1)=auth.uid()::text);
CREATE POLICY private_media_delete ON storage.objects FOR DELETE TO authenticated
  USING(bucket_id IN ('materials','videos','thumbnails') AND public.owns_storage_path(name,auth.uid()));

ALTER TABLE public.materials DROP CONSTRAINT materials_type_check;
ALTER TABLE public.materials ADD CONSTRAINT materials_type_check CHECK(type IN ('image','video','audio'));
INSERT INTO public.credit_costs(action,cost,description) VALUES('generate_image',10,'图片生成')
  ON CONFLICT(action) DO NOTHING;
CREATE TABLE public.production_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  request_key uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('image','render','publish','metrics')),
  project_id uuid REFERENCES public.video_projects(id) ON DELETE SET NULL,
  model_config_version_id uuid REFERENCES public.model_config_versions(id),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','unknown','cancelled')),
  phase text NOT NULL DEFAULT 'ready',
  lease_token uuid,
  lease_until timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  progress int NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  evidence jsonb,
  resolution jsonb,
  final_lease_token uuid,
  result jsonb,
  error_message text,
  charge_id uuid REFERENCES public.credit_logs(id),
  credit_cost int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(user_id,request_key)
);
CREATE INDEX production_jobs_due ON public.production_jobs(kind,next_run_at) WHERE status IN ('pending','running');
ALTER TABLE public.production_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,user_id,request_key,kind,project_id,status,phase,progress,result,error_message,credit_cost,created_at,completed_at)
  ON public.production_jobs TO authenticated;
GRANT ALL ON public.production_jobs TO service_role;
CREATE POLICY production_jobs_own ON public.production_jobs FOR SELECT TO authenticated USING(user_id=auth.uid());

CREATE FUNCTION public.guard_production_project() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF auth.role()='service_role' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM production_jobs WHERE project_id=OLD.id AND status IN ('pending','running','unknown')) THEN
      RAISE EXCEPTION '生产任务仍在处理，暂不能删除工程';
    END IF;
    RETURN OLD;
  END IF;
  IF EXISTS(SELECT 1 FROM production_jobs WHERE project_id=OLD.id AND kind='render')
    AND (NEW.video_url IS DISTINCT FROM OLD.video_url OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.progress IS DISTINCT FROM OLD.progress) THEN
    RAISE EXCEPTION '成片状态由服务端维护';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER video_projects_guard_production BEFORE UPDATE OR DELETE ON video_projects
  FOR EACH ROW EXECUTE FUNCTION guard_production_project();

CREATE FUNCTION public.select_project_cover(p_project uuid,p_cover uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid:=auth.uid(); v_url text;
BEGIN
  PERFORM 1 FROM video_projects WHERE id=p_project AND user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '作品不存在或无权访问'; END IF;
  SELECT image_url INTO STRICT v_url FROM cover_candidates WHERE id=p_cover AND project_id=p_project
    AND user_id=v_uid AND status='completed';
  UPDATE cover_candidates SET is_selected=(id=p_cover) WHERE project_id=p_project AND user_id=v_uid;
  UPDATE video_projects SET thumbnail_url=v_url WHERE id=p_project;
END;
$$;
REVOKE ALL ON FUNCTION select_project_cover(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION select_project_cover(uuid,uuid) TO authenticated;

CREATE FUNCTION public.create_production_job(
  p_user_id uuid,p_request_key uuid,p_kind text,p_payload jsonb,p_project_id uuid DEFAULT NULL,p_version uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job public.production_jobs%ROWTYPE; v_enabled boolean; v_current uuid; v_charge jsonb; v_cost int:=0;
BEGIN
  IF p_kind NOT IN ('image','render','publish','metrics') OR p_request_key IS NULL OR p_payload IS NULL THEN
    RAISE EXCEPTION '任务参数非法';
  END IF;
  PERFORM 1 FROM public.user_plans WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
  SELECT * INTO v_job FROM public.production_jobs WHERE user_id=p_user_id AND request_key=p_request_key;
  IF FOUND THEN
    IF v_job.kind IS DISTINCT FROM p_kind OR v_job.payload IS DISTINCT FROM p_payload OR v_job.project_id IS DISTINCT FROM p_project_id THEN
      RAISE EXCEPTION '同一请求标识不能用于不同任务';
    END IF;
    RETURN to_jsonb(v_job);
  END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM video_projects WHERE id=p_project_id AND user_id=p_user_id) THEN
    RAISE EXCEPTION '作品不存在或无权访问';
  END IF;
  IF p_kind='render' THEN
    IF p_project_id IS NULL THEN RAISE EXCEPTION '剪辑任务必须关联工程'; END IF;
    PERFORM 1 FROM video_projects WHERE id=p_project_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM production_jobs WHERE project_id=p_project_id AND kind='render' AND status IN ('pending','running','unknown')) THEN
      RAISE EXCEPTION '此工程已有渲染任务';
    END IF;
  END IF;
  IF p_kind='image' THEN
    SELECT enabled,current_version_id INTO v_enabled,v_current FROM model_configs WHERE slot='image.primary' FOR SHARE;
    IF NOT FOUND OR NOT v_enabled OR p_version IS DISTINCT FROM v_current THEN RAISE EXCEPTION '图片模型配置已更新或未启用'; END IF;
    SELECT cost INTO v_cost FROM credit_costs WHERE action=CASE WHEN p_project_id IS NULL THEN 'generate_image' ELSE 'generate_cover' END;
    IF NOT FOUND OR v_cost IS NULL OR v_cost<0 THEN RAISE EXCEPTION '图片计费配置缺失'; END IF;
    IF v_cost>0 THEN v_charge:=deduct_credits(p_user_id,v_cost,CASE WHEN p_project_id IS NULL THEN 'generate_image' ELSE 'generate_cover' END); END IF;
  END IF;
  INSERT INTO production_jobs(user_id,request_key,kind,payload,project_id,model_config_version_id,charge_id,credit_cost)
  VALUES(p_user_id,p_request_key,p_kind,p_payload,p_project_id,p_version,(v_charge->>'charge_id')::uuid,v_cost) RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;
CREATE FUNCTION public.claim_production_job(p_kind text,p_job_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job public.production_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM production_jobs WHERE kind=p_kind AND status IN ('pending','running')
    AND (p_job_id IS NULL OR id=p_job_id) AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now())
  ORDER BY next_run_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_job.kind IN ('image','publish') AND v_job.phase='executing' AND v_job.resolution IS NULL THEN
    UPDATE production_jobs SET status='unknown',error_message='上游受理结果未知，禁止重复提交，需核对',
      lease_token=NULL,lease_until=NULL WHERE id=v_job.id;
    RETURN NULL;
  END IF;
  UPDATE production_jobs SET status='running',attempts=attempts+1,lease_token=gen_random_uuid(),
    lease_until=now()+interval '180 seconds',phase=CASE WHEN phase='ready' THEN 'claimed' ELSE phase END
  WHERE id=v_job.id RETURNING * INTO v_job;
  RETURN to_jsonb(v_job);
END;
$$;
CREATE FUNCTION public.update_production_job(p_job_id uuid,p_lease uuid,p_event text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job public.production_jobs%ROWTYPE; v_url text; v_cover text; v_user uuid;
BEGIN
  SELECT user_id INTO STRICT v_user FROM production_jobs WHERE id=p_job_id;
  -- 与创建/扣费保持账户 -> 工程 -> 任务锁顺序，避免退款与重试创建互锁。
  PERFORM 1 FROM user_plans WHERE user_id=v_user FOR UPDATE;
  PERFORM 1 FROM video_projects WHERE id=(SELECT project_id FROM production_jobs WHERE id=p_job_id) FOR UPDATE;
  SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.status IN ('completed','failed') AND v_job.final_lease_token=p_lease THEN RETURN to_jsonb(v_job); END IF;
  IF v_job.lease_token IS DISTINCT FROM p_lease OR p_lease IS NULL OR v_job.status<>'running' THEN RAISE EXCEPTION '任务租约已失效'; END IF;
  IF p_event='heartbeat' THEN
    UPDATE production_jobs SET lease_until=now()+interval '180 seconds',progress=GREATEST(progress,LEAST(95,COALESCE((p_data->>'progress')::int,progress))) WHERE id=p_job_id;
  ELSIF p_event='executing' AND v_job.phase IN ('claimed','accepted') THEN
    UPDATE production_jobs SET phase='executing' WHERE id=p_job_id;
  ELSIF p_event='rejected' AND v_job.phase='executing' THEN
    UPDATE production_jobs SET phase=CASE WHEN evidence IS NULL THEN 'claimed' ELSE 'accepted' END WHERE id=p_job_id;
  ELSIF p_event='checkpoint' THEN
    UPDATE production_jobs SET evidence=p_data,phase='accepted' WHERE id=p_job_id;
  ELSIF p_event='resolution' THEN
    IF p_data->>'event' NOT IN ('completed','failed') THEN RAISE EXCEPTION '结案证据非法'; END IF;
    IF v_job.resolution IS NOT NULL AND v_job.resolution IS DISTINCT FROM p_data THEN RAISE EXCEPTION '结案证据不能覆盖'; END IF;
    UPDATE production_jobs SET resolution=p_data WHERE id=p_job_id;
  ELSIF p_event='retry' THEN
    IF v_job.kind IN ('image','publish') AND v_job.phase='executing' AND v_job.resolution IS NULL THEN RAISE EXCEPTION '不得重发结果未知请求'; END IF;
    UPDATE production_jobs SET status=CASE WHEN attempts>=10 AND resolution IS NULL AND COALESCE(p_data->>'waiting','false')<>'true'
        THEN 'unknown' ELSE 'pending' END,
      error_message=left(p_data->>'error',500),next_run_at=now()+make_interval(secs=>LEAST(900,15*(2^LEAST(attempts,6))::int)),
      lease_token=NULL,lease_until=NULL WHERE id=p_job_id;
  ELSIF p_event='unknown' THEN
    UPDATE production_jobs SET status='unknown',error_message=left(p_data->>'error',500),lease_token=NULL,lease_until=NULL WHERE id=p_job_id;
  ELSIF p_event='failed' THEN
    IF v_job.charge_id IS NOT NULL THEN PERFORM refund_credit_charge(v_job.user_id,v_job.charge_id,COALESCE(p_data->>'error','任务确定失败')); END IF;
    UPDATE production_jobs SET status='failed',error_message=left(p_data->>'error',500),
      completed_at=now(),final_lease_token=p_lease,lease_token=NULL,lease_until=NULL WHERE id=p_job_id;
  ELSIF p_event='completed' THEN
    v_url:=p_data->>'url'; v_cover:=p_data->>'thumbnail_url';
    IF v_job.kind IN ('image','render') AND (v_url IS NULL OR v_url !~ '^https://') THEN RAISE EXCEPTION '缺少成片对象地址'; END IF;
    IF v_job.kind='image' THEN
      INSERT INTO materials(user_id,name,type,url,size,tags) VALUES(v_job.user_id,left(v_job.payload->>'prompt',80),'image',v_url,(p_data->>'size')::bigint,ARRAY['AI图片']);
      IF v_job.project_id IS NOT NULL THEN
        INSERT INTO cover_candidates(project_id,user_id,image_url,gen_task_id,status,style_prompt,ctr_score)
        VALUES(v_job.project_id,v_job.user_id,v_url,v_job.id::text,'completed',v_job.payload->>'prompt',NULL);
      END IF;
    ELSIF v_job.kind='render' THEN
      INSERT INTO materials(user_id,name,type,url,size,duration_sec,tags) VALUES(v_job.user_id,v_job.payload->>'title','video',v_url,(p_data->>'size')::bigint,(p_data->>'duration')::numeric,ARRAY['剪辑成片']);
      UPDATE video_projects SET status='completed',progress=100,video_url=v_url,thumbnail_url=v_cover,
        duration=ceil((p_data->>'duration')::numeric),resolution=p_data->>'resolution',error_message=NULL WHERE id=v_job.project_id;
    END IF;
    UPDATE production_jobs SET status='completed',progress=100,result=p_data,completed_at=now(),error_message=NULL,
      final_lease_token=p_lease,lease_token=NULL,lease_until=NULL WHERE id=p_job_id;
  ELSE RAISE EXCEPTION '任务状态转换非法'; END IF;
  SELECT * INTO v_job FROM production_jobs WHERE id=p_job_id;
  RETURN to_jsonb(v_job);
END;
$$;
REVOKE ALL ON FUNCTION public.create_production_job(uuid,uuid,text,jsonb,uuid,uuid),
  public.claim_production_job(text,uuid),public.update_production_job(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_production_job(uuid,uuid,text,jsonb,uuid,uuid),
  public.claim_production_job(text,uuid),public.update_production_job(uuid,uuid,text,jsonb) TO service_role;

CREATE FUNCTION public.reconcile_production_job(p_job uuid,p_evidence jsonb,p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_uid uuid;
BEGIN
  IF length(trim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION '需提供上游核对证据说明'; END IF;
  SELECT user_id INTO STRICT v_uid FROM production_jobs WHERE id=p_job;
  PERFORM 1 FROM user_plans WHERE user_id=v_uid FOR UPDATE;
  PERFORM 1 FROM video_projects WHERE id=(SELECT project_id FROM production_jobs WHERE id=p_job) FOR UPDATE;
  SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job FOR UPDATE;
  IF v_job.status<>'unknown' THEN RAISE EXCEPTION '只核对结果未知任务'; END IF;
  IF p_evidence IS NULL THEN
    -- 运维已确定上游没有受理/生成：用持久化结案证据进入退款事务，不重新生成。
    UPDATE production_jobs SET resolution=jsonb_build_object('event','failed','data',jsonb_build_object('error',p_note)),
      status='pending',phase='accepted',next_run_at=now() WHERE id=p_job;
  ELSE
    IF v_job.kind='image' AND COALESCE(p_evidence->'data'->0->>'url',p_evidence->'data'->0->>'b64_json') IS NULL
      OR v_job.kind='publish' AND COALESCE(p_evidence->>'publish_id',p_evidence->>'item_id') IS NULL
      OR v_job.kind NOT IN ('image','publish') THEN RAISE EXCEPTION '核对结果缺少原生成对象或平台作品标识'; END IF;
    UPDATE production_jobs SET evidence=p_evidence,status='pending',phase='accepted',attempts=0,next_run_at=now() WHERE id=p_job;
  END IF;
  INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
    VALUES(v_uid,'reconcile_production_job','production_jobs',p_job,jsonb_build_object('note',p_note,'confirmed_rejected',p_evidence IS NULL));
END;
$$;
REVOKE ALL ON FUNCTION reconcile_production_job(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION reconcile_production_job(uuid,jsonb,text) TO service_role;
COMMIT;
