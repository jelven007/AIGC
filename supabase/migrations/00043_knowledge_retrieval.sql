BEGIN;
-- 配置目录与知识任务采用现有加密、不可变版本和生产任务财务链。
CREATE TABLE model_slot_catalog (slot text PRIMARY KEY);
INSERT INTO model_slot_catalog(slot) VALUES
 ('text.primary'),('text.fallback'),('image.primary'),('audio.tts'),('audio.asr'),
 ('audio.voice_clone'),('avatar.photo'),('avatar.lipsync'),('reader.primary'),
 ('video.ArkSeedance'),('video.MiniMax'),('video.SeedanceMini'),('video.Wan3'),
 ('video.HappyHorse'),('video.Kling'),('video.Seedance'),('embedding.primary');
REVOKE ALL ON model_slot_catalog FROM PUBLIC,anon,authenticated;
GRANT SELECT ON model_slot_catalog TO service_role;
CREATE OR REPLACE FUNCTION save_model_config(
 p_slot text,p_expected_version uuid,p_settings jsonb,p_enabled boolean,
 p_key_ciphertext text,p_actor uuid,p_replace_key boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_current uuid; v_cipher text; v_new uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM model_slot_catalog WHERE slot=p_slot) THEN RAISE EXCEPTION '不支持的模型配置项'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND raw_app_meta_data->>'role'='admin') THEN
   RAISE EXCEPTION '仅平台管理员可修改模型配置';
 END IF;
 INSERT INTO model_configs(slot) VALUES(p_slot) ON CONFLICT DO NOTHING;
 SELECT current_version_id INTO v_current FROM model_configs WHERE slot=p_slot FOR UPDATE;
 IF v_current IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION '配置已被更新，请刷新后重试'; END IF;
 IF p_replace_key THEN v_cipher:=p_key_ciphertext;
 ELSE SELECT key_ciphertext INTO v_cipher FROM model_config_versions WHERE id=v_current; END IF;
 IF p_enabled AND p_slot<>'reader.primary' AND COALESCE(v_cipher,'')='' THEN RAISE EXCEPTION '启用前请填写 API Key'; END IF;
 INSERT INTO model_config_versions(slot,settings,key_ciphertext,created_by)
   VALUES(p_slot,p_settings,v_cipher,p_actor) RETURNING id INTO v_new;
 UPDATE model_configs SET current_version_id=v_new,enabled=p_enabled,updated_at=now() WHERE slot=p_slot;
 DELETE FROM llm_cache;
 INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
   VALUES(p_actor,'save_model_config','model_configs',v_new,jsonb_build_object('slot',p_slot,'enabled',p_enabled,'version_id',v_new));
 RETURN v_new;
END;
$$;
ALTER TABLE knowledge_entries ADD COLUMN content_hash text;
UPDATE knowledge_entries SET content_hash=encode(digest(title||E'\n'||content::text,'sha256'),'hex'),
 embedding_text=left(title||E'\n'||content::text,20000),is_applied=false,applied_at=NULL;
ALTER TABLE knowledge_entries ALTER COLUMN content_hash SET NOT NULL;
REVOKE ALL ON knowledge_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON knowledge_entries TO authenticated;
GRANT INSERT(user_id,source_type,source_id,title,content,quality_score,tags,category),
 UPDATE(title,content,quality_score,tags,category),DELETE ON knowledge_entries TO authenticated;
GRANT ALL ON knowledge_entries TO service_role;
CREATE FUNCTION guard_knowledge_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.role()='authenticated' AND NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION '无权访问知识条目'; END IF;
 IF TG_OP='INSERT' THEN PERFORM 1 FROM user_plans WHERE user_id=NEW.user_id FOR UPDATE; END IF;
 IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION '不能转移知识条目归属'; END IF;
 IF TG_OP='INSERT' AND (SELECT count(*) FROM knowledge_entries WHERE user_id=NEW.user_id)>=200 THEN
   RAISE EXCEPTION '知识库最多200条，请先删除不再使用的条目';
 END IF;
 IF length(trim(NEW.title)) NOT BETWEEN 1 AND 200 OR length(NEW.content::text)>19000
   OR jsonb_typeof(NEW.content) IS DISTINCT FROM 'object' OR cardinality(NEW.tags)>20
   OR length(NEW.category)>100 THEN RAISE EXCEPTION '知识标题或正文超出限制'; END IF;
 NEW.content_hash:=encode(digest(NEW.title||E'\n'||NEW.content::text,'sha256'),'hex');
 NEW.embedding_text:=NEW.title||E'\n'||NEW.content::text;
 -- 检索索引不是模型训练；写入、更新都不授予训练标志。
 NEW.is_applied:=false; NEW.applied_at:=NULL;
 RETURN NEW;
END;
$$;
CREATE TRIGGER knowledge_entry_guard BEFORE INSERT OR UPDATE ON knowledge_entries
 FOR EACH ROW EXECUTE FUNCTION guard_knowledge_entry();

CREATE TABLE knowledge_chunks (
 entry_id uuid NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id),
 content_hash text NOT NULL,
 version_id uuid NOT NULL REFERENCES model_config_versions(id),
 ordinal int NOT NULL CHECK(ordinal BETWEEN 0 AND 23),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 1000),
 embedding double precision[] NOT NULL CHECK(cardinality(embedding) BETWEEN 2 AND 1536),
 job_id uuid NOT NULL REFERENCES production_jobs(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(entry_id,version_id,ordinal)
);
CREATE INDEX knowledge_chunks_owner_version ON knowledge_chunks(user_id,version_id);
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON knowledge_chunks FROM PUBLIC,anon,authenticated;
GRANT ALL ON knowledge_chunks TO service_role;
ALTER TABLE production_jobs DROP CONSTRAINT production_jobs_kind_check;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_kind_check CHECK(kind IN
 ('image','render','publish','metrics','tts','asr','voice_clone','avatar','lipsync','analysis','knowledge_index','knowledge_search'));
INSERT INTO credit_costs(action,cost,description) VALUES
 ('generate_knowledge_index',2,'知识索引：最多19000字JSON正文，24个分块'),
 ('generate_knowledge_search',1,'知识语义检索：最多500字查询')
 ON CONFLICT(action) DO NOTHING;

CREATE FUNCTION create_knowledge_job(p_user uuid,p_key uuid,p_kind text,p_request jsonb,p_version uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_entry knowledge_entries%ROWTYPE; v_cost int; v_charge jsonb; v_payload jsonb;
BEGIN
 IF p_key IS NULL OR p_kind IS NULL OR p_kind NOT IN ('knowledge_index','knowledge_search')
   OR jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '知识任务参数非法'; END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
 SELECT * INTO v_job FROM production_jobs WHERE user_id=p_user AND request_key=p_key;
 IF FOUND THEN
   IF v_job.kind IS DISTINCT FROM p_kind OR v_job.payload->'request' IS DISTINCT FROM p_request THEN
     RAISE EXCEPTION '同一请求标识不能用于不同任务';
   END IF;
   RETURN to_jsonb(v_job);
 END IF;
 IF (SELECT count(*) FROM production_jobs WHERE user_id=p_user AND kind IN ('knowledge_index','knowledge_search')
   AND status IN ('pending','running','unknown'))>=4 THEN RAISE EXCEPTION '知识任务队列已满'; END IF;
 PERFORM 1 FROM model_configs WHERE slot='embedding.primary' AND enabled AND current_version_id=p_version FOR SHARE;
 IF NOT FOUND OR p_version IS NULL THEN RAISE EXCEPTION 'Embedding配置已更新或未启用'; END IF;
 v_payload:=jsonb_build_object('request',p_request);
 IF p_kind='knowledge_index' THEN
   SELECT * INTO v_entry FROM knowledge_entries WHERE id=(p_request->>'entry_id')::uuid AND user_id=p_user FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION '知识条目不存在或无权访问'; END IF;
   IF v_entry.content_hash IS DISTINCT FROM p_request->>'content_hash' THEN RAISE EXCEPTION '知识条目已更新，请刷新'; END IF;
   IF length(v_entry.embedding_text)>20000 THEN RAISE EXCEPTION '知识正文过长'; END IF;
   IF EXISTS(SELECT 1 FROM production_jobs WHERE user_id=p_user AND kind=p_kind
     AND payload->'request'->>'entry_id'=v_entry.id::text AND status IN ('pending','running','unknown')) THEN
     RAISE EXCEPTION '此条目已有索引任务，请等待或核对';
   END IF;
   v_payload:=v_payload||jsonb_build_object('text',v_entry.embedding_text);
 ELSE
   IF jsonb_typeof(p_request->'query') IS DISTINCT FROM 'string' OR length(trim(p_request->>'query')) NOT BETWEEN 1 AND 500
     OR jsonb_typeof(p_request->'limit') IS DISTINCT FROM 'number' OR (p_request->>'limit')::numeric NOT BETWEEN 1 AND 10
     OR (p_request->>'limit')::numeric<>trunc((p_request->>'limit')::numeric) THEN RAISE EXCEPTION '语义查询参数非法'; END IF;
 END IF;
 SELECT cost INTO v_cost FROM credit_costs WHERE action='generate_'||p_kind;
 IF NOT FOUND OR v_cost IS NULL OR v_cost<0 THEN RAISE EXCEPTION '知识计费配置缺失'; END IF;
 IF p_request->>'confirmed_credit_cost' IS NULL OR (p_request->>'confirmed_credit_cost')::numeric<>v_cost THEN
   RAISE EXCEPTION '计费价格已更新，请刷新确认后提交';
 END IF;
 IF v_cost>0 THEN v_charge:=deduct_credits(p_user,v_cost,'generate_'||p_kind); END IF;
 INSERT INTO production_jobs(user_id,request_key,kind,payload,model_config_version_id,charge_id,credit_cost)
   VALUES(p_user,p_key,p_kind,v_payload,p_version,(v_charge->>'charge_id')::uuid,v_cost) RETURNING * INTO v_job;
 RETURN to_jsonb(v_job);
END;
$$;
CREATE FUNCTION valid_knowledge_vector(p_vector double precision[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
 SELECT cardinality(p_vector) BETWEEN 2 AND 1536 AND array_ndims(p_vector)=1
   AND NOT EXISTS(SELECT 1 FROM unnest(p_vector) n WHERE n IS NULL OR NOT (abs(n)<1000000))
   AND (SELECT sum(n*n)>0 FROM unnest(p_vector) n);
$$;
CREATE FUNCTION search_knowledge_vectors(p_user uuid,p_version uuid,p_vector double precision[],p_limit int DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_results jsonb;
BEGIN
 IF NOT COALESCE(valid_knowledge_vector(p_vector),false) OR p_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION '检索向量非法'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(result) ORDER BY result.similarity DESC,result.entry_id),'[]') INTO v_results FROM (
   SELECT DISTINCT ON (entry_id) entry_id,title,content_hash,version_id,content,similarity FROM (
     SELECT c.entry_id,e.title,c.content_hash,c.version_id,c.content,
       (SELECT sum(a*b)/sqrt(sum(a*a)*sum(b*b)) FROM unnest(c.embedding,p_vector) v(a,b)) AS similarity
     FROM knowledge_chunks c JOIN knowledge_entries e ON e.id=c.entry_id AND e.user_id=c.user_id AND e.content_hash=c.content_hash
     WHERE c.user_id=p_user AND c.version_id=p_version AND cardinality(c.embedding)=cardinality(p_vector)
   ) scores WHERE similarity>=0.2 ORDER BY entry_id,similarity DESC
 ) result;
 RETURN (SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'similarity')::float8 DESC),'[]')
   FROM (SELECT row FROM jsonb_array_elements(v_results) row ORDER BY (row->>'similarity')::float8 DESC LIMIT p_limit) limited);
END;
$$;
CREATE FUNCTION read_knowledge_catalog(p_user uuid,p_query text DEFAULT '') RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(to_jsonb(e)||jsonb_build_object('indexed',EXISTS(
   SELECT 1 FROM knowledge_chunks c JOIN model_configs m ON m.current_version_id=c.version_id AND m.slot='embedding.primary'
   WHERE c.entry_id=e.id AND c.content_hash=e.content_hash AND m.enabled)) ORDER BY e.created_at DESC),'[]')
 FROM knowledge_entries e WHERE e.user_id=p_user AND
   (p_query='' OR strpos(lower(e.embedding_text),lower(left(p_query,500)))>0);
$$;
CREATE FUNCTION read_knowledge_context(p_user uuid,p_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_sources jsonb;
BEGIN
 SELECT * INTO v_job FROM production_jobs WHERE id=p_job AND user_id=p_user AND kind='knowledge_search' AND status='completed';
 IF NOT FOUND THEN RAISE EXCEPTION '语义检索任务不存在或尚未完成'; END IF;
 SELECT COALESCE(jsonb_agg(source),'[]') INTO v_sources FROM jsonb_array_elements(v_job.result->'results') source
 JOIN knowledge_entries e ON e.id=(source->>'entry_id')::uuid AND e.user_id=p_user AND e.content_hash=source->>'content_hash';
 RETURN jsonb_build_object('job_id',p_job,'version_id',v_job.model_config_version_id,'sources',v_sources);
END;
$$;
ALTER FUNCTION claim_production_job(text,uuid) RENAME TO claim_production_job_before_knowledge;
REVOKE ALL ON FUNCTION claim_production_job_before_knowledge(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION claim_production_job(p_kind text,p_job_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job jsonb;
BEGIN
 v_job:=claim_production_job_before_knowledge(p_kind,p_job_id);
 IF v_job->>'kind' IN ('knowledge_index','knowledge_search') AND v_job->>'phase'='executing' AND v_job->'resolution'='null'::jsonb THEN
   UPDATE production_jobs SET status='unknown',error_message='Embedding请求结果未知，需核对供应商用量',
     lease_token=NULL,lease_until=NULL WHERE id=(v_job->>'id')::uuid;
   RETURN NULL;
 END IF;
 RETURN v_job;
END;
$$;
ALTER FUNCTION update_production_job(uuid,uuid,text,jsonb) RENAME TO update_production_job_before_knowledge;
REVOKE ALL ON FUNCTION update_production_job_before_knowledge(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION update_production_job(p_job_id uuid,p_lease uuid,p_event text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_entry knowledge_entries%ROWTYPE; v_chunk jsonb; v_vector float8[]; v_count int:=0;
BEGIN
 SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id;
 IF v_job.kind NOT IN ('knowledge_index','knowledge_search') THEN
   RETURN update_production_job_before_knowledge(p_job_id,p_lease,p_event,p_data);
 END IF;
 PERFORM 1 FROM user_plans WHERE user_id=v_job.user_id FOR UPDATE;
 IF v_job.kind='knowledge_index' THEN
   SELECT * INTO v_entry FROM knowledge_entries WHERE id=(v_job.payload->'request'->>'entry_id')::uuid AND user_id=v_job.user_id FOR SHARE;
 END IF;
 SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id FOR UPDATE;
 IF v_job.status IN ('completed','failed') AND v_job.final_lease_token=p_lease THEN RETURN to_jsonb(v_job); END IF;
 IF p_lease IS NULL OR v_job.lease_token IS DISTINCT FROM p_lease OR v_job.status<>'running' THEN RAISE EXCEPTION '任务租约已失效'; END IF;
 IF p_event='retry' AND v_job.phase='executing' AND v_job.resolution IS NULL THEN RAISE EXCEPTION '不得重发结果未知请求'; END IF;
 IF p_event='completed' THEN
   IF p_data->>'version_id' IS DISTINCT FROM v_job.model_config_version_id::text THEN RAISE EXCEPTION 'Embedding版本不匹配'; END IF;
   IF v_job.kind='knowledge_index' THEN
     IF v_entry.id IS NULL OR v_entry.content_hash IS DISTINCT FROM v_job.payload->'request'->>'content_hash' THEN
       RAISE EXCEPTION '知识条目已更新或删除，不能保存旧索引';
     END IF;
     IF jsonb_typeof(p_data->'chunks') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'chunks') NOT BETWEEN 1 AND 24 THEN
       RAISE EXCEPTION 'Embedding分块结果非法';
     END IF;
     DELETE FROM knowledge_chunks WHERE entry_id=v_entry.id AND version_id=v_job.model_config_version_id;
     FOR v_chunk IN SELECT value FROM jsonb_array_elements(p_data->'chunks') LOOP
       v_vector:=ARRAY(SELECT jsonb_array_elements_text(v_chunk->'embedding')::float8);
       IF NOT COALESCE(valid_knowledge_vector(v_vector),false) THEN RAISE EXCEPTION 'Embedding向量非法'; END IF;
       INSERT INTO knowledge_chunks(entry_id,user_id,content_hash,version_id,ordinal,content,embedding,job_id)
         VALUES(v_entry.id,v_job.user_id,v_entry.content_hash,v_job.model_config_version_id,v_count,v_chunk->>'content',v_vector,v_job.id);
       v_count:=v_count+1;
     END LOOP;
     p_data:=jsonb_build_object('entry_id',v_entry.id,'content_hash',v_entry.content_hash,'version_id',v_job.model_config_version_id,'chunk_count',v_count);
   ELSE
     IF jsonb_typeof(p_data->'results') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'results')>10 THEN
       RAISE EXCEPTION '语义查询结果非法';
     END IF;
   END IF;
 END IF;
 RETURN update_production_job_before_knowledge(p_job_id,p_lease,p_event,p_data);
END;
$$;
REVOKE ALL ON FUNCTION create_knowledge_job(uuid,uuid,text,jsonb,uuid),search_knowledge_vectors(uuid,uuid,float8[],int),
 read_knowledge_catalog(uuid,text),read_knowledge_context(uuid,uuid),claim_production_job(text,uuid),
 update_production_job(uuid,uuid,text,jsonb),valid_knowledge_vector(float8[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION create_knowledge_job(uuid,uuid,text,jsonb,uuid),search_knowledge_vectors(uuid,uuid,float8[],int),
 read_knowledge_catalog(uuid,text),read_knowledge_context(uuid,uuid),claim_production_job(text,uuid),
 update_production_job(uuid,uuid,text,jsonb),valid_knowledge_vector(float8[]) TO service_role;
COMMIT;
