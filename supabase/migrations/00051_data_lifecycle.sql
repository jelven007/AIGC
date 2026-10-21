BEGIN;
-- 对象级事务锁将业务引用写入、上传和清理排队串行化。
CREATE TABLE media_references (
  bucket text NOT NULL, path text NOT NULL, source_table text NOT NULL, source_id uuid NOT NULL,
  PRIMARY KEY(bucket,path,source_table,source_id)
);
CREATE INDEX media_references_source ON media_references(source_table,source_id);
REVOKE ALL ON media_references FROM PUBLIC,anon,authenticated;
GRANT ALL ON media_references TO service_role;
ALTER TABLE media_references ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION decode_media_path(p_path text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_bytes bytea:=''::bytea; v_index int:=1; v_char text;
BEGIN
  WHILE v_index<=length(p_path) LOOP
    v_char:=substr(p_path,v_index,1);
    IF v_char='%' AND substr(p_path,v_index+1,2)~'^[a-fA-F0-9]{2}$' THEN
      v_bytes:=v_bytes||decode(substr(p_path,v_index+1,2),'hex'); v_index:=v_index+3;
    ELSE v_bytes:=v_bytes||convert_to(v_char,'UTF8'); v_index:=v_index+1; END IF;
  END LOOP;
  RETURN convert_from(v_bytes,'UTF8');
EXCEPTION WHEN OTHERS THEN RETURN p_path;
END;
$$;
CREATE FUNCTION media_tree_objects(p_tree jsonb) RETURNS TABLE(bucket text,path text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT DISTINCT parts[1],decode_media_path(parts[2])
  FROM jsonb_path_query(COALESCE(p_tree,'{}'), 'strict $.** ? (@.type() == "string")') value,
    LATERAL regexp_match(value #>> '{}','/storage/v1/object/(?:authenticated|public|sign)/(materials|videos|thumbnails)/([^?#]+)') parts
  WHERE parts IS NOT NULL;
$$;
CREATE FUNCTION media_reference_tree(p_table text,p_row jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_table='production_jobs' THEN
    CASE WHEN p_row->>'status' IN ('pending','running','unknown') THEN
      jsonb_build_object('payload',p_row->'payload','evidence',p_row->'evidence','resolution',p_row->'resolution')
      WHEN p_row->>'kind'='analysis' AND p_row->>'status'='completed' THEN p_row->'result' ELSE '{}'::jsonb END
    WHEN p_table='video_jobs' THEN
      CASE WHEN p_row->>'status' NOT IN ('completed','failed','cancelled') THEN p_row->'payload' ELSE '{}'::jsonb END
    ELSE p_row END;
$$;
CREATE FUNCTION sync_media_references() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old jsonb:='{}'; v_new jsonb:='{}'; v_id uuid; v_object record;
BEGIN
  IF TG_OP<>'INSERT' THEN v_old:=media_reference_tree(TG_TABLE_NAME,to_jsonb(OLD));
    v_id:=COALESCE(to_jsonb(OLD)->>'id',to_jsonb(OLD)->>'job_id')::uuid; END IF;
  IF TG_OP<>'DELETE' THEN v_new:=media_reference_tree(TG_TABLE_NAME,to_jsonb(NEW));
    v_id:=COALESCE(to_jsonb(NEW)->>'id',to_jsonb(NEW)->>'job_id')::uuid; END IF;
  IF TG_OP='UPDATE' AND v_old IS NOT DISTINCT FROM v_new THEN RETURN NEW; END IF;
  FOR v_object IN SELECT * FROM media_tree_objects(v_old) UNION SELECT * FROM media_tree_objects(v_new)
    ORDER BY bucket,path LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('media:'||v_object.bucket||'/'||v_object.path,0));
  END LOOP;
  IF EXISTS(SELECT 1 FROM (SELECT * FROM media_tree_objects(v_new) EXCEPT SELECT * FROM media_tree_objects(v_old)) n
    JOIN media_deletions d USING(bucket,path)) THEN
    RAISE EXCEPTION '素材已进入清理队列，请重新上传或选择素材';
  END IF;
  DELETE FROM media_references WHERE source_table=TG_TABLE_NAME AND source_id=v_id;
  INSERT INTO media_references SELECT bucket,path,TG_TABLE_NAME,v_id FROM media_tree_objects(v_new);
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['materials','products','video_projects','avatars','cover_candidates',
    'production_jobs','video_jobs','style_analyses','intelligence_targets','intelligence_samples'] LOOP
    EXECUTE format('CREATE TRIGGER lifecycle_media_refs AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION sync_media_references()',v_table);
    EXECUTE format('INSERT INTO media_references SELECT bucket,path,%L,
      COALESCE(to_jsonb(r)->>''id'',to_jsonb(r)->>''job_id'')::uuid FROM %I r,
      LATERAL media_tree_objects(media_reference_tree(%L,to_jsonb(r))) ON CONFLICT DO NOTHING',v_table,v_table,v_table);
  END LOOP;
END;
$$;
ALTER TABLE media_deletions ADD COLUMN lease_token uuid;
ALTER TABLE media_deletions ADD COLUMN lease_until timestamptz;
CREATE INDEX media_deletions_due ON media_deletions(next_run_at) WHERE completed_at IS NULL;
CREATE FUNCTION guard_media_upload_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.bucket_id IN ('materials','videos','thumbnails') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('media:'||NEW.bucket_id||'/'||NEW.name,0));
    IF EXISTS(SELECT 1 FROM media_deletions WHERE bucket=NEW.bucket_id AND path=NEW.name) THEN
      RAISE EXCEPTION '此对象已撤销，请使用新路径上传';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_upload_lifecycle BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION guard_media_upload_lifecycle();
DROP POLICY IF EXISTS private_media_delete ON storage.objects;
CREATE FUNCTION erase_deleted_media_receipts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE production_jobs j SET result='{"media_deleted":true}',evidence=NULL,resolution=NULL
    WHERE j.status IN ('completed','failed','cancelled') AND j.kind<>'analysis'
      AND EXISTS(SELECT 1 FROM media_tree_objects(j.result) WHERE bucket=NEW.bucket AND path=NEW.path);
  UPDATE video_jobs j SET result='{"media_deleted":true}',resolution_event=NULL
    WHERE j.status IN ('completed','failed','cancelled')
      AND EXISTS(SELECT 1 FROM media_tree_objects(j.result) WHERE bucket=NEW.bucket AND path=NEW.path);
  RETURN NEW;
END;
$$;
CREATE TRIGGER lifecycle_media_receipts AFTER INSERT ON media_deletions
  FOR EACH ROW EXECUTE FUNCTION erase_deleted_media_receipts();
CREATE OR REPLACE FUNCTION delete_owned_material(p_user uuid,p_material uuid,p_bucket text,p_path text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_material materials%ROWTYPE;
BEGIN
  SELECT * INTO v_material FROM materials WHERE id=p_material AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_path IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM media_tree_objects(to_jsonb(v_material)) WHERE bucket=p_bucket AND path=p_path)
      OR NOT (owns_storage_path(p_path,p_user) OR EXISTS(
        SELECT 1 FROM legacy_media_access WHERE bucket=p_bucket AND path=p_path AND user_id=p_user)) THEN
      RAISE EXCEPTION '无权删除此对象或对象与素材不匹配';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('media:'||p_bucket||'/'||p_path,0));
    IF EXISTS(SELECT 1 FROM media_references WHERE bucket=p_bucket AND path=p_path
      AND (source_table<>'materials' OR source_id<>p_material)) THEN
      RAISE EXCEPTION '素材仍被作品、形象或任务引用，请先移除引用';
    END IF;
  END IF;
  DELETE FROM materials WHERE id=p_material;
  IF p_path IS NOT NULL THEN
    INSERT INTO media_deletions(user_id,bucket,path) VALUES(p_user,p_bucket,p_path) ON CONFLICT DO NOTHING;
  END IF;
END;
$$;
CREATE FUNCTION enqueue_expired_media() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_object record; v_uid uuid; v_count int:=0;
BEGIN
  FOR v_object IN SELECT o.bucket_id,o.name FROM storage.objects o JOIN auth.users u ON u.id::text=
    CASE WHEN split_part(o.name,'/',1) IN ('generated-videos','generated-images')
      THEN split_part(o.name,'/',2) ELSE split_part(o.name,'/',1) END
    WHERE o.bucket_id IN ('materials','videos','thumbnails')
      AND greatest(o.created_at,o.updated_at)<now()-interval '24 hours'
      AND NOT EXISTS(SELECT 1 FROM media_references r WHERE r.bucket=o.bucket_id AND r.path=o.name)
      AND NOT EXISTS(SELECT 1 FROM media_deletions d WHERE d.bucket=o.bucket_id AND d.path=o.name)
    ORDER BY o.created_at,o.id LIMIT 100 LOOP
    v_uid:=NULL;
    BEGIN
      v_uid:=CASE WHEN split_part(v_object.name,'/',1) IN ('generated-videos','generated-images')
        THEN split_part(v_object.name,'/',2)::uuid ELSE split_part(v_object.name,'/',1)::uuid END;
    EXCEPTION WHEN invalid_text_representation THEN CONTINUE;
    END;
    IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_uid) THEN CONTINUE; END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('media:'||v_object.bucket_id||'/'||v_object.name,0)) THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM media_references WHERE bucket=v_object.bucket_id AND path=v_object.name)
      OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=v_object.bucket_id AND name=v_object.name
        AND greatest(created_at,updated_at)<now()-interval '24 hours') THEN CONTINUE; END IF;
    INSERT INTO media_deletions(user_id,bucket,path) VALUES(v_uid,v_object.bucket_id,v_object.name) ON CONFLICT DO NOTHING;
    IF FOUND THEN v_count:=v_count+1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
CREATE OR REPLACE FUNCTION claim_media_deletions() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_items jsonb;
BEGIN
  WITH due AS (
    SELECT id FROM media_deletions d WHERE completed_at IS NULL AND next_run_at<=now()
      AND (lease_until IS NULL OR lease_until<now())
      AND NOT EXISTS(SELECT 1 FROM media_references r WHERE r.bucket=d.bucket AND r.path=d.path)
      ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 10
  ), claimed AS (
    UPDATE media_deletions SET lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',
      next_run_at=now()+interval '5 minutes',attempts=attempts+1 WHERE id IN (SELECT id FROM due) RETURNING *
  ) SELECT COALESCE(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO v_items FROM claimed;
  RETURN v_items;
END;
$$;
CREATE FUNCTION finish_media_deletion(p_id uuid,p_lease uuid,p_success boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE media_deletions SET completed_at=CASE WHEN p_success THEN now() ELSE NULL END,
    last_error=CASE WHEN p_success THEN NULL ELSE '对象删除未确认，后台将重试' END,
    next_run_at=now()+make_interval(secs=>LEAST(3600,30*(2^LEAST(attempts,7))::int)),
    lease_token=NULL,lease_until=NULL
    WHERE id=p_id AND completed_at IS NULL AND lease_token=p_lease AND lease_until>now();
  RETURN FOUND;
END;
$$;
ALTER TABLE voice_clones ADD COLUMN revoked_at timestamptz;
ALTER TABLE voice_clones ADD COLUMN provider_deleted_at timestamptz;
GRANT SELECT(revoked_at,provider_deleted_at) ON voice_clones TO authenticated;
CREATE TABLE voice_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clone_id uuid NOT NULL UNIQUE REFERENCES voice_clones(id),
  user_id uuid NOT NULL REFERENCES auth.users(id), request_key uuid NOT NULL,
  attempts int NOT NULL DEFAULT 0,next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,lease_until timestamptz,last_error text,completed_at timestamptz,
  UNIQUE(user_id,request_key)
);
ALTER TABLE voice_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON voice_deletions FROM PUBLIC,anon,authenticated;
GRANT ALL ON voice_deletions TO service_role;
CREATE TABLE voice_revocation_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id), request_key uuid NOT NULL,
  clone_id uuid NOT NULL REFERENCES voice_clones(id), PRIMARY KEY(user_id,request_key)
);
ALTER TABLE voice_revocation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON voice_revocation_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON voice_revocation_receipts TO service_role;
CREATE FUNCTION revoke_voice_clone(p_user uuid,p_clone uuid,p_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_clone voice_clones%ROWTYPE; v_receipt voice_revocation_receipts%ROWTYPE; v_job production_jobs%ROWTYPE;
BEGIN
  IF p_key IS NULL THEN RAISE EXCEPTION '声纹撤销标识非法'; END IF;
  PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
  SELECT * INTO v_receipt FROM voice_revocation_receipts WHERE user_id=p_user AND request_key=p_key;
  IF FOUND AND v_receipt.clone_id<>p_clone THEN RAISE EXCEPTION '同一请求标识不能撤销不同声纹'; END IF;
  SELECT * INTO v_clone FROM voice_clones WHERE id=p_clone AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '声纹不存在或无权访问'; END IF;
  INSERT INTO voice_revocation_receipts(user_id,request_key,clone_id) VALUES(p_user,p_key,p_clone) ON CONFLICT DO NOTHING;
  IF v_clone.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('id',p_clone,'revoked_at',v_clone.revoked_at,'provider_deleted_at',v_clone.provider_deleted_at);
  END IF;
  UPDATE voice_clones SET revoked_at=COALESCE(revoked_at,now()) WHERE id=p_clone;
  INSERT INTO voice_deletions(clone_id,user_id,request_key) VALUES(p_clone,p_user,p_key) ON CONFLICT(clone_id) DO NOTHING;
  FOR v_job IN SELECT * FROM production_jobs WHERE user_id=p_user AND kind='tts'
    AND payload->>'voice_clone_id'=p_clone::text AND status IN ('pending','running','unknown') FOR UPDATE LOOP
    IF v_job.phase IN ('ready','claimed') AND v_job.evidence IS NULL AND v_job.resolution IS NULL THEN
      IF v_job.charge_id IS NOT NULL THEN PERFORM refund_credit_charge(p_user,v_job.charge_id,'声纹已撤销，配音尚未提交'); END IF;
      UPDATE production_jobs SET status='cancelled',completed_at=now(),lease_token=NULL,lease_until=NULL,
        error_message='声纹已撤销，未提交配音已取消并返还积分' WHERE id=v_job.id;
    END IF;
  END LOOP;
  IF v_clone.revoked_at IS NULL THEN
    INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
      VALUES(p_user,'revoke_voice_clone','voice_clones',p_clone,jsonb_build_object('request_key',p_key));
  END IF;
  RETURN jsonb_build_object('id',p_clone,'revoked_at',COALESCE(v_clone.revoked_at,now()),
    'provider_deleted_at',v_clone.provider_deleted_at);
END;
$$;
CREATE FUNCTION guard_voice_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_clone voice_clones%ROWTYPE;
BEGIN
  IF NEW.kind='tts' AND NEW.payload->>'voice_clone_id' IS NOT NULL AND
    (TG_OP='INSERT' OR NEW.phase='executing' AND OLD.phase IS DISTINCT FROM NEW.phase) THEN
    SELECT * INTO v_clone FROM voice_clones WHERE id=(NEW.payload->>'voice_clone_id')::uuid
      AND user_id=NEW.user_id FOR SHARE;
    IF NOT FOUND OR v_clone.revoked_at IS NOT NULL OR v_clone.requires_verification
      OR v_clone.model_config_version_id IS DISTINCT FROM NEW.model_config_version_id THEN
      RAISE EXCEPTION '声纹已撤销、未验证或不可用';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lifecycle_voice_job BEFORE INSERT OR UPDATE ON production_jobs FOR EACH ROW EXECUTE FUNCTION guard_voice_job();
CREATE FUNCTION claim_voice_deletions() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_items jsonb;
BEGIN
  WITH due AS (
    SELECT d.id FROM voice_deletions d WHERE d.completed_at IS NULL AND d.next_run_at<=now()
      AND (d.lease_until IS NULL OR d.lease_until<now())
      AND NOT EXISTS(SELECT 1 FROM production_jobs j WHERE j.user_id=d.user_id AND j.kind='tts'
        AND j.payload->>'voice_clone_id'=d.clone_id::text AND j.status IN ('pending','running','unknown')
        AND j.phase='executing' AND j.evidence IS NULL AND j.resolution IS NULL)
      ORDER BY d.next_run_at FOR UPDATE SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE voice_deletions SET lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1
      WHERE id IN (SELECT id FROM due) RETURNING *
  ) SELECT COALESCE(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO v_items FROM claimed;
  RETURN v_items;
END;
$$;
CREATE FUNCTION finish_voice_deletion(p_id uuid,p_lease uuid,p_success boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE voice_deletions SET completed_at=CASE WHEN p_success THEN now() ELSE NULL END,
    last_error=CASE WHEN p_success THEN NULL ELSE '供应商声纹删除未确认，后台将重试' END,
    next_run_at=now()+make_interval(secs=>LEAST(3600,30*(2^LEAST(attempts,7))::int)),
    lease_token=NULL,lease_until=NULL WHERE id=p_id AND completed_at IS NULL AND lease_token=p_lease
      AND lease_until>now() RETURNING clone_id INTO v_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_success THEN
    UPDATE voice_clones SET provider_deleted_at=now(),provider_voice_id='' WHERE id=v_id;
    UPDATE production_jobs SET evidence=NULL,resolution=NULL WHERE id=(SELECT job_id FROM voice_clones WHERE id=v_id);
  END IF;
  RETURN true;
END;
$$;

ALTER TABLE production_jobs ADD COLUMN source_erased_at timestamptz;
CREATE FUNCTION filter_knowledge_sources(p_results jsonb,p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(source ORDER BY ordinal),'[]') FROM
    jsonb_array_elements(CASE WHEN jsonb_typeof(p_results)='array' THEN p_results ELSE '[]' END)
      WITH ORDINALITY s(source,ordinal)
    JOIN knowledge_entries e ON e.id::text=source->>'entry_id' AND e.user_id=p_user
      AND e.content_hash=source->>'content_hash';
$$;
CREATE FUNCTION erase_knowledge_copies() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE;
BEGIN
  PERFORM 1 FROM user_plans WHERE user_id=OLD.user_id FOR UPDATE;
  FOR v_job IN SELECT * FROM production_jobs WHERE user_id=OLD.user_id AND kind='knowledge_index'
    AND payload->'request'->>'entry_id'=OLD.id::text FOR UPDATE LOOP
    IF v_job.status IN ('pending','running','unknown') AND
      (v_job.phase<>'executing' OR v_job.evidence IS NOT NULL OR v_job.resolution IS NOT NULL) THEN
      IF v_job.charge_id IS NOT NULL THEN PERFORM refund_credit_charge(OLD.user_id,v_job.charge_id,'知识条目已删除，索引停止'); END IF;
      UPDATE production_jobs SET status='cancelled',completed_at=now(),lease_token=NULL,lease_until=NULL WHERE id=v_job.id;
    ELSIF v_job.status IN ('pending','running','unknown') THEN
      UPDATE production_jobs SET status='unknown',lease_token=NULL,lease_until=NULL WHERE id=v_job.id;
    END IF;
    UPDATE production_jobs SET payload=payload-'text',evidence=NULL,resolution=NULL,result=NULL,
      source_erased_at=now(),error_message=CASE WHEN status IN ('cancelled','unknown')
        THEN '知识条目已删除；未提交索引已取消，已提交结果未知任务需核对原用量' ELSE error_message END WHERE id=v_job.id;
  END LOOP;
  UPDATE production_jobs SET result=jsonb_set(result,'{results}',filter_knowledge_sources(result->'results',OLD.user_id)),
    resolution=CASE WHEN resolution->'data'->'results' IS NOT NULL
      THEN jsonb_set(resolution,'{data,results}',filter_knowledge_sources(resolution->'data'->'results',OLD.user_id))
      ELSE resolution END
    WHERE user_id=OLD.user_id AND kind='knowledge_search'
      AND (result->'results' IS NOT NULL OR resolution->'data'->'results' IS NOT NULL);
  RETURN OLD;
END;
$$;
CREATE TRIGGER lifecycle_knowledge_erase AFTER DELETE ON knowledge_entries FOR EACH ROW EXECUTE FUNCTION erase_knowledge_copies();
REVOKE DELETE ON knowledge_entries FROM authenticated;
CREATE FUNCTION delete_knowledge_entry(p_user uuid,p_entry uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
  DELETE FROM knowledge_entries WHERE id=p_entry AND user_id=p_user;
  RETURN jsonb_build_object('deleted',true,'entry_id',p_entry);
END;
$$;
CREATE FUNCTION guard_knowledge_job_copies() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.kind='knowledge_search' THEN
    IF NEW.result->'results' IS NOT NULL THEN
      NEW.result:=jsonb_set(NEW.result,'{results}',filter_knowledge_sources(NEW.result->'results',NEW.user_id));
    END IF;
    IF NEW.resolution->'data'->'results' IS NOT NULL THEN
      NEW.resolution:=jsonb_set(NEW.resolution,'{data,results}',filter_knowledge_sources(NEW.resolution->'data'->'results',NEW.user_id));
    END IF;
  ELSIF NEW.kind='knowledge_index' AND NEW.source_erased_at IS NOT NULL THEN
    NEW.payload:=NEW.payload-'text'; NEW.evidence:=NULL; NEW.result:=NULL;
    IF NEW.resolution->>'event'='completed' THEN NEW.resolution:=NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lifecycle_knowledge_job BEFORE INSERT OR UPDATE ON production_jobs
  FOR EACH ROW EXECUTE FUNCTION guard_knowledge_job_copies();
-- 升级时清理旧版已删条目的遗留任务正文；同时过滤旧检索回执。
DO $$
DECLARE v_job production_jobs%ROWTYPE;
BEGIN
  FOR v_job IN SELECT j.* FROM production_jobs j WHERE j.kind='knowledge_index'
    AND NOT EXISTS(SELECT 1 FROM knowledge_entries e WHERE e.id::text=j.payload->'request'->>'entry_id'
      AND e.user_id=j.user_id) ORDER BY j.user_id,j.id LOOP
    PERFORM 1 FROM user_plans WHERE user_id=v_job.user_id FOR UPDATE;
    IF v_job.status IN ('pending','running','unknown') AND
      (v_job.phase<>'executing' OR v_job.evidence IS NOT NULL OR v_job.resolution IS NOT NULL) THEN
      IF v_job.charge_id IS NOT NULL THEN PERFORM refund_credit_charge(v_job.user_id,v_job.charge_id,'旧知识已删除，索引停止'); END IF;
      UPDATE production_jobs SET status='cancelled',completed_at=now(),lease_token=NULL,lease_until=NULL WHERE id=v_job.id;
    ELSIF v_job.status IN ('pending','running','unknown') THEN
      UPDATE production_jobs SET status='unknown',lease_token=NULL,lease_until=NULL WHERE id=v_job.id;
    END IF;
    UPDATE production_jobs SET source_erased_at=now(),payload=payload-'text',evidence=NULL,resolution=NULL,result=NULL WHERE id=v_job.id;
  END LOOP;
  UPDATE production_jobs SET result=result WHERE kind='knowledge_search';
END;
$$;
CREATE FUNCTION prune_job_evidence() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count int;
BEGIN
  WITH due AS (SELECT id FROM production_jobs WHERE status IN ('completed','failed','cancelled')
    AND completed_at<now()-interval '7 days' AND (evidence IS NOT NULL OR resolution IS NOT NULL
      OR kind='knowledge_index' AND payload ? 'text')
    ORDER BY completed_at LIMIT 100 FOR UPDATE SKIP LOCKED)
  UPDATE production_jobs SET evidence=NULL,resolution=NULL,
    payload=CASE WHEN kind='knowledge_index' THEN payload-'text' ELSE payload END WHERE id IN (SELECT id FROM due);
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION decode_media_path(text),media_tree_objects(jsonb),media_reference_tree(text,jsonb),
  sync_media_references(),guard_media_upload_lifecycle(),erase_deleted_media_receipts(),guard_voice_job(),erase_knowledge_copies(),
  guard_knowledge_job_copies(),filter_knowledge_sources(jsonb,uuid),enqueue_expired_media(),finish_media_deletion(uuid,uuid,boolean),
  revoke_voice_clone(uuid,uuid,uuid),claim_voice_deletions(),finish_voice_deletion(uuid,uuid,boolean),
  delete_knowledge_entry(uuid,uuid),prune_job_evidence() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION enqueue_expired_media(),finish_media_deletion(uuid,uuid,boolean),revoke_voice_clone(uuid,uuid,uuid),
  claim_voice_deletions(),finish_voice_deletion(uuid,uuid,boolean),delete_knowledge_entry(uuid,uuid),prune_job_evidence() TO service_role;
COMMIT;
