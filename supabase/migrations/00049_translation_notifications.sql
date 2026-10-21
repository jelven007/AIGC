BEGIN;
ALTER TABLE production_jobs DROP CONSTRAINT production_jobs_kind_check;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_kind_check CHECK(kind IN
 ('image','render','publish','metrics','tts','asr','voice_clone','avatar','lipsync','analysis','knowledge_index','knowledge_search',
 'intelligence_competitor','intelligence_products','product_import','product_translate'));
INSERT INTO credit_costs(action,cost,description) VALUES
 ('generate_product_translate',2,'商品文字翻译与可选主图文字识别，不修改原商品或图片') ON CONFLICT(action) DO NOTHING;

-- 商品相关任务共用账户锁和四个并发槽，未知结果也占槽。
CREATE OR REPLACE FUNCTION guard_product_capacity() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM user_plans WHERE user_id=NEW.user_id FOR UPDATE;
 IF TG_TABLE_NAME='products' THEN
   IF (SELECT count(*) FROM products WHERE user_id=NEW.user_id)>=2000 THEN RAISE EXCEPTION '商品库最多2000个商品'; END IF;
 ELSIF (SELECT count(*) FROM production_jobs WHERE user_id=NEW.user_id AND kind IN
   ('product_import','product_translate','intelligence_competitor','intelligence_products')
   AND status IN ('pending','running','unknown'))>=4 THEN RAISE EXCEPTION '商品与情报队列已满'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER production_products_capacity ON production_jobs;
CREATE TRIGGER production_products_capacity BEFORE INSERT ON production_jobs FOR EACH ROW
 WHEN(NEW.kind IN ('product_import','product_translate','intelligence_competitor','intelligence_products'))
 EXECUTE FUNCTION guard_product_capacity();

CREATE FUNCTION create_product_translation(p_user uuid,p_key uuid,p_request jsonb,p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_product products%ROWTYPE; v_cost int; v_charge jsonb; v_source jsonb;
BEGIN
 IF p_key IS NULL OR jsonb_typeof(p_request) IS DISTINCT FROM 'object'
   OR p_request->>'product_id' IS NULL OR p_request->>'expected_updated_at' IS NULL
   OR p_request->>'target_language' IS NULL OR p_request->>'target_language' NOT IN
     ('zh-CN','en','ja','ko','fr','de','es','pt','ar','th','vi','id')
   OR jsonb_typeof(p_request->'include_image') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(p_request->'confirmed_credit_cost') IS DISTINCT FROM 'number' THEN
   RAISE EXCEPTION '商品翻译参数非法';
 END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
 SELECT * INTO v_job FROM production_jobs WHERE user_id=p_user AND request_key=p_key;
 IF FOUND THEN
   IF v_job.kind<>'product_translate' OR v_job.payload->'request' IS DISTINCT FROM p_request THEN
     RAISE EXCEPTION '同一请求标识不能用于不同任务';
   END IF;
   RETURN to_jsonb(v_job);
 END IF;
 SELECT * INTO v_product FROM products WHERE id=(p_request->>'product_id')::uuid AND user_id=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION '商品不存在或无权访问'; END IF;
 IF v_product.updated_at IS DISTINCT FROM (p_request->>'expected_updated_at')::timestamptz THEN
   RAISE EXCEPTION '商品已被更新，请刷新后重试';
 END IF;
 IF (p_request->>'include_image')::boolean AND v_product.cover_image IS NULL THEN RAISE EXCEPTION '商品尚未提供主图'; END IF;
 SELECT cost INTO v_cost FROM credit_costs WHERE action='generate_product_translate';
 IF v_cost IS NULL OR v_cost<0 OR v_cost IS DISTINCT FROM (p_request->>'confirmed_credit_cost')::int THEN
   RAISE EXCEPTION '翻译价格已更新，请重新确认';
 END IF;
 PERFORM 1 FROM model_configs WHERE slot='text.primary' AND enabled AND current_version_id=p_version FOR SHARE;
 IF NOT FOUND OR p_version IS NULL THEN RAISE EXCEPTION '文本模型配置已更新或未启用'; END IF;
 v_source:=jsonb_build_object('name',v_product.name,'description',COALESCE(v_product.description,''),
   'selling_points',COALESCE(to_jsonb(v_product.selling_points),'[]'),'specs',COALESCE(v_product.specs,'[]'),
   'cover_image',CASE WHEN (p_request->>'include_image')::boolean THEN v_product.cover_image ELSE NULL END);
 IF octet_length(v_source::text)>60000 THEN RAISE EXCEPTION '商品翻译内容超过60KB'; END IF;
 IF v_cost>0 THEN v_charge:=deduct_credits(p_user,v_cost,'generate_product_translate'); END IF;
 INSERT INTO production_jobs(user_id,request_key,kind,payload,model_config_version_id,charge_id,credit_cost)
 VALUES(p_user,p_key,'product_translate',jsonb_build_object('request',p_request,'source',v_source,
   'source_hash',encode(digest(v_source::text,'sha256'),'hex')),p_version,(v_charge->>'charge_id')::uuid,v_cost)
 RETURNING * INTO v_job;
 RETURN to_jsonb(v_job);
END;
$$;

-- 竞品快照独立保存，不将浏览器提交的标题/统计当作证据。
CREATE TABLE analysis_intelligence_references (
 job_id uuid PRIMARY KEY REFERENCES production_jobs(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 context jsonb NOT NULL CHECK(jsonb_typeof(context)='object' AND octet_length(context::text)<=20000),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE analysis_intelligence_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON analysis_intelligence_references FROM PUBLIC,anon,authenticated;
GRANT ALL ON analysis_intelligence_references TO service_role;
ALTER FUNCTION create_production_job(uuid,uuid,text,jsonb,uuid,uuid) RENAME TO create_production_job_before_translation;
REVOKE ALL ON FUNCTION create_production_job_before_translation(uuid,uuid,text,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION create_production_job(p_user_id uuid,p_request_key uuid,p_kind text,p_payload jsonb,
 p_project_id uuid DEFAULT NULL,p_version uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job jsonb; v_prior production_jobs%ROWTYPE; v_item jsonb; v_source jsonb; v_ref jsonb;
BEGIN
 IF p_kind<>'analysis' OR NOT(p_payload ? 'competitor_reference') THEN
   RETURN create_production_job_before_translation(p_user_id,p_request_key,p_kind,p_payload,p_project_id,p_version);
 END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user_id FOR UPDATE;
 SELECT * INTO v_prior FROM production_jobs WHERE user_id=p_user_id AND request_key=p_request_key;
 IF FOUND THEN
   RETURN create_production_job_before_translation(p_user_id,p_request_key,p_kind,p_payload,p_project_id,p_version);
 END IF;
 v_ref:=p_payload->'competitor_reference';
 IF p_payload->>'mode'<>'style' OR jsonb_typeof(v_ref) IS DISTINCT FROM 'object'
   OR v_ref->'rights_confirmed' IS DISTINCT FROM 'true'::jsonb OR v_ref->>'sample_id' IS NULL
   OR length(COALESCE(v_ref->>'item_id','')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '竞品参考与素材使用权确认非法'; END IF;
 SELECT item,s.data->'source' INTO v_item,v_source FROM intelligence_samples s JOIN production_jobs j ON j.id=s.job_id,
   LATERAL jsonb_array_elements(s.data->'items') item
 WHERE s.job_id=(v_ref->>'sample_id')::uuid AND s.user_id=p_user_id AND j.kind='intelligence_competitor'
   AND item->>'id'=v_ref->>'item_id';
 IF v_item IS NULL THEN RAISE EXCEPTION '竞品快照不存在、过期或无权访问'; END IF;
 v_job:=create_production_job_before_translation(p_user_id,p_request_key,p_kind,p_payload,p_project_id,p_version);
 INSERT INTO analysis_intelligence_references(job_id,user_id,context) VALUES((v_job->>'id')::uuid,p_user_id,
   jsonb_build_object('sample_id',v_ref->>'sample_id','item',v_item,'source',v_source,
     'relationship','用户关联的统计参考；未验证上传素材与原平台视频为同一作品'));
 RETURN v_job;
END;
$$;
ALTER FUNCTION claim_production_job(text,uuid) RENAME TO claim_production_job_before_translation;
REVOKE ALL ON FUNCTION claim_production_job_before_translation(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION claim_production_job(p_kind text,p_job_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job jsonb;
BEGIN
 v_job:=claim_production_job_before_translation(p_kind,p_job_id);
 IF v_job->>'kind'='product_translate' AND v_job->>'phase'='executing' AND v_job->'resolution'='null'::jsonb THEN
   UPDATE production_jobs SET status='unknown',error_message='翻译模型受理结果未知，请核对供应商用量',
     lease_token=NULL,lease_until=NULL WHERE id=(v_job->>'id')::uuid;
   RETURN NULL;
 END IF;
 RETURN v_job;
END;
$$;
ALTER FUNCTION update_production_job(uuid,uuid,text,jsonb) RENAME TO update_production_job_before_translation;
REVOKE ALL ON FUNCTION update_production_job_before_translation(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION valid_product_translation_result(p_payload jsonb,p_version uuid,p_data jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT COALESCE(CASE WHEN jsonb_typeof(p_data->'translation')='object'
   AND jsonb_typeof(p_data->'translation'->'selling_points')='array'
   AND jsonb_typeof(p_data->'translation'->'specs')='array' AND jsonb_typeof(p_data->'image_text')='array'
 THEN p_data->>'product_id'=p_payload->'request'->>'product_id'
   AND p_data->>'source_updated_at'=p_payload->'request'->>'expected_updated_at'
   AND p_data->>'target_language'=p_payload->'request'->>'target_language'
   AND p_data->>'source_hash'=p_payload->>'source_hash' AND p_data->>'version_id'=p_version::text
   AND length(p_data->'translation'->>'name') BETWEEN 1 AND 200
   AND jsonb_typeof(p_data->'translation'->'name')='string'
   AND jsonb_typeof(p_data->'translation'->'description')='string'
   AND length(p_data->'translation'->>'description')<=8000
   AND jsonb_array_length(p_data->'translation'->'selling_points')=jsonb_array_length(p_payload->'source'->'selling_points')
   AND jsonb_array_length(p_data->'translation'->'specs')=jsonb_array_length(p_payload->'source'->'specs')
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'translation'->'selling_points') point
     WHERE jsonb_typeof(point)<>'string' OR length(point#>>'{}') NOT BETWEEN 1 AND 300)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'translation'->'specs') spec
     WHERE jsonb_typeof(spec->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(spec->'value') IS DISTINCT FROM 'string'
       OR length(spec->>'name') NOT BETWEEN 1 AND 100 OR length(spec->>'value') NOT BETWEEN 1 AND 500)
   AND jsonb_array_length(p_data->'image_text')<=50
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'image_text') line
     WHERE jsonb_typeof(line->'original') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'translated') IS DISTINCT FROM 'string'
       OR length(line->>'original') NOT BETWEEN 1 AND 500 OR length(line->>'translated') NOT BETWEEN 1 AND 1000)
   AND CASE WHEN (p_payload->'request'->>'include_image')::boolean THEN p_data->>'image_hash' ~ '^[a-f0-9]{64}$'
     ELSE jsonb_array_length(p_data->'image_text')=0 END AND octet_length(p_data::text)<=60000
 ELSE false END,false);
$$;
CREATE FUNCTION update_production_job(p_job_id uuid,p_lease uuid,p_event text,p_data jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_result jsonb; v_context jsonb;
BEGIN
 SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id;
 IF v_job.kind='intelligence_products' AND v_job.payload->'params'->>'search_mode'='image' AND p_event='completed' AND (
   p_data->'params'->>'image_hash' IS DISTINCT FROM v_job.payload->'params'->>'image_hash'
   OR p_data->'params'->>'market' IS DISTINCT FROM v_job.payload->'params'->>'market'
   OR p_data->'params'->>'search_mode' IS DISTINCT FROM 'image'
 ) THEN RAISE EXCEPTION '图片搜索结果与原内容标识不匹配'; END IF;
 IF v_job.kind='analysis' AND p_event='completed' AND v_job.payload ? 'competitor_reference' THEN
   SELECT context INTO v_context FROM analysis_intelligence_references WHERE job_id=p_job_id AND user_id=v_job.user_id;
   IF v_context IS NULL OR p_data->'competitor_reference' IS DISTINCT FROM v_context THEN
     RAISE EXCEPTION '竞品分析参考来源不匹配';
   END IF;
 END IF;
 IF v_job.kind<>'product_translate' THEN RETURN update_production_job_before_translation(p_job_id,p_lease,p_event,p_data); END IF;
 PERFORM 1 FROM user_plans WHERE user_id=v_job.user_id FOR UPDATE;
 SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id FOR UPDATE;
 IF v_job.status IN ('completed','failed') AND v_job.final_lease_token=p_lease THEN RETURN to_jsonb(v_job); END IF;
 IF p_lease IS NULL OR v_job.lease_token IS DISTINCT FROM p_lease OR v_job.status<>'running' THEN RAISE EXCEPTION '翻译租约已失效'; END IF;
 IF p_event='retry' AND v_job.phase='executing' AND v_job.resolution IS NULL THEN RAISE EXCEPTION '不得重发结果未知请求'; END IF;
 IF p_event='completed' AND NOT valid_product_translation_result(v_job.payload,v_job.model_config_version_id,p_data) THEN
   RAISE EXCEPTION '商品翻译结果或来源版本非法';
 END IF;
 v_result:=update_production_job_before_translation(p_job_id,p_lease,p_event,p_data);
 IF p_event IN ('completed','failed') THEN UPDATE production_jobs SET evidence=NULL,resolution=NULL WHERE id=p_job_id; END IF;
 RETURN v_result;
END;
$$;
ALTER FUNCTION reconcile_production_job(uuid,jsonb,text) RENAME TO reconcile_production_job_before_translation;
REVOKE ALL ON FUNCTION reconcile_production_job_before_translation(uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION reconcile_production_job(p_job uuid,p_evidence jsonb,p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE;
BEGIN
 SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job;
 IF v_job.kind<>'product_translate' OR p_evidence IS NULL THEN
   PERFORM reconcile_production_job_before_translation(p_job,p_evidence,p_note); RETURN;
 END IF;
 IF length(trim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION '需提供上游核对证据说明'; END IF;
 PERFORM 1 FROM user_plans WHERE user_id=v_job.user_id FOR UPDATE;
 SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job FOR UPDATE;
 IF v_job.status<>'unknown' THEN RAISE EXCEPTION '只核对结果未知任务'; END IF;
 IF NOT valid_product_translation_result(v_job.payload,v_job.model_config_version_id,p_evidence) THEN
   RAISE EXCEPTION '商品翻译结果或来源版本非法';
 END IF;
 UPDATE production_jobs SET resolution=jsonb_build_object('event','completed','data',p_evidence),
   status='pending',phase='accepted',next_run_at=now() WHERE id=p_job;
 INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data) VALUES(v_job.user_id,'reconcile_production_job',
   'production_jobs',p_job,jsonb_build_object('note',p_note,'confirmed_rejected',false));
END;
$$;
CREATE FUNCTION prune_product_translations() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count int;
BEGIN
 UPDATE production_jobs SET result='{"expired":true}',payload=payload-'source',evidence=NULL,resolution=NULL
 WHERE kind='product_translate' AND status IN ('completed','failed') AND completed_at<now()-interval '30 days'
   AND result IS DISTINCT FROM '{"expired":true}'::jsonb;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 DELETE FROM analysis_intelligence_references r USING production_jobs j WHERE r.job_id=j.id
   AND j.status IN ('completed','failed') AND j.completed_at<now()-interval '30 days';
 UPDATE production_jobs SET result=result-'competitor_reference',evidence=evidence-'output',resolution=NULL
 WHERE kind='analysis' AND status IN ('completed','failed') AND completed_at<now()-interval '30 days'
   AND (result ? 'competitor_reference' OR evidence->'output' ? 'competitor_reference');
 RETURN v_count;
END;
$$;

CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 event_key text NOT NULL, category text NOT NULL CHECK(category IN ('jobs','intelligence','publish')),
 level text NOT NULL CHECK(level IN ('success','warning','error')), title text NOT NULL, body text NOT NULL,
 action_path text NOT NULL, source_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz, deleted_at timestamptz, UNIQUE(user_id,event_key)
);
CREATE INDEX notifications_feed ON notifications(user_id,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE TABLE notification_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 task_success boolean NOT NULL DEFAULT true, intelligence_success boolean NOT NULL DEFAULT true
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_own ON notifications FOR SELECT TO authenticated USING(user_id=auth.uid() AND deleted_at IS NULL);
CREATE POLICY notification_preferences_own ON notification_preferences FOR SELECT TO authenticated USING(user_id=auth.uid());
REVOKE ALL ON notifications,notification_preferences FROM PUBLIC,anon,authenticated;
GRANT SELECT ON notifications,notification_preferences TO authenticated;
GRANT ALL ON notifications,notification_preferences TO service_role;
CREATE FUNCTION notify_task_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row jsonb:=to_jsonb(NEW); v_old jsonb:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 v_status text; v_previous text; v_category text:='jobs'; v_title text; v_path text:='/task-queue'; v_prefs notification_preferences%ROWTYPE;
BEGIN
 v_status:=v_row->>'status'; v_previous:=v_old->>'status';
 IF TG_TABLE_NAME='production_jobs' THEN
   IF v_row->>'kind'='publish' THEN RETURN NEW; END IF;
   IF v_row->>'kind' LIKE 'intelligence_%' THEN
     v_category:='intelligence';
     v_path:=CASE WHEN v_row->>'kind'='intelligence_products' THEN '/product-selection' ELSE '/competitor' END;
   ELSIF v_row->>'kind' IN ('product_import','product_translate') THEN v_path:='/products'; END IF;
 ELSIF TG_TABLE_NAME='video_jobs' THEN
   IF v_status NOT IN ('completed','failed','cancelled') AND v_row->>'submission_state'='unknown' THEN v_status:='unknown'; END IF;
   IF v_previous NOT IN ('completed','failed','cancelled') AND v_old->>'submission_state'='unknown' THEN v_previous:='unknown'; END IF;
 ELSIF TG_TABLE_NAME='publish_tasks' THEN v_category:='publish'; v_path:='/publish';
   IF v_status='published' THEN v_status:='completed'; END IF;
   IF v_previous='published' THEN v_previous:='completed'; END IF;
 END IF;
 IF v_status NOT IN ('completed','failed','unknown') OR v_status IS NOT DISTINCT FROM v_previous THEN RETURN NEW; END IF;
 SELECT * INTO v_prefs FROM notification_preferences WHERE user_id=NEW.user_id;
 IF v_status='completed' AND (v_category='intelligence' AND NOT COALESCE(v_prefs.intelligence_success,true)
   OR v_category<>'intelligence' AND NOT COALESCE(v_prefs.task_success,true)) THEN RETURN NEW; END IF;
 v_title:=CASE WHEN v_category='publish' THEN '平台发布' WHEN v_category='intelligence' THEN '情报采集' ELSE '后台任务' END
   ||CASE v_status WHEN 'completed' THEN '已完成' WHEN 'failed' THEN '失败' ELSE '待核对' END;
 INSERT INTO notifications(user_id,event_key,category,level,title,body,action_path,source_id)
 VALUES(NEW.user_id,TG_TABLE_NAME||':'||NEW.id||':'||v_status,v_category,
   CASE v_status WHEN 'completed' THEN 'success' WHEN 'failed' THEN 'error' ELSE 'warning' END,v_title,
   CASE v_status WHEN 'completed' THEN '结果已保存，可打开详情核对。'
     WHEN 'failed' THEN '任务未能完成，请打开详情查看原因与计费记录。'
     ELSE '原请求结果尚未确定，请打开详情核对，避免重复提交。' END,v_path,NEW.id)
 ON CONFLICT(user_id,event_key) DO NOTHING;
 RETURN NEW;
END;
$$;
CREATE TRIGGER production_notifications AFTER INSERT OR UPDATE OF status ON production_jobs FOR EACH ROW EXECUTE FUNCTION notify_task_state();
CREATE TRIGGER video_notifications AFTER INSERT OR UPDATE OF status,submission_state ON video_jobs FOR EACH ROW EXECUTE FUNCTION notify_task_state();
CREATE TRIGGER publish_notifications AFTER INSERT OR UPDATE OF status ON publish_tasks FOR EACH ROW EXECUTE FUNCTION notify_task_state();
CREATE FUNCTION read_notifications(p_category text DEFAULT 'all',p_offset int DEFAULT 0,p_limit int DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid:=auth.uid(); v_cutoff timestamptz:=clock_timestamp(); v_rows jsonb; v_total int; v_unread int;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION '请先登录'; END IF;
 IF p_category IS NULL OR p_category NOT IN ('all','jobs','intelligence','publish') OR p_offset IS NULL
   OR p_offset NOT BETWEEN 0 AND 10000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION '通知分页参数非法'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC,n.id),'[]') INTO v_rows FROM (
   SELECT id,category,level,title,body,action_path,source_id,created_at,read_at FROM notifications
   WHERE user_id=v_uid AND deleted_at IS NULL AND created_at<=v_cutoff AND (p_category='all' OR category=p_category)
   ORDER BY created_at DESC,id OFFSET p_offset LIMIT p_limit) n;
 SELECT count(*),count(*) FILTER(WHERE read_at IS NULL) INTO v_total,v_unread FROM notifications
   WHERE user_id=v_uid AND deleted_at IS NULL AND (p_category='all' OR category=p_category);
 RETURN jsonb_build_object('items',v_rows,'total',v_total,'unread',v_unread,
   'unread_all',(SELECT count(*) FROM notifications WHERE user_id=v_uid AND deleted_at IS NULL AND read_at IS NULL),
   'cutoff',v_cutoff,'preferences',COALESCE((SELECT to_jsonb(p)-'user_id' FROM notification_preferences p WHERE user_id=v_uid),
     '{"task_success":true,"intelligence_success":true}'::jsonb));
END;
$$;
CREATE FUNCTION mutate_notifications(p_action text,p_ids uuid[] DEFAULT '{}',p_cutoff timestamptz DEFAULT NULL,p_preferences jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid:=auth.uid(); v_count int:=0;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION '请先登录'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('read','delete','read_all','clear_read','preferences')
   OR p_ids IS NULL OR cardinality(p_ids)>100 THEN RAISE EXCEPTION '通知操作参数非法'; END IF;
 IF p_action IN ('read_all','clear_read') AND (p_cutoff IS NULL OR p_cutoff>clock_timestamp()) THEN RAISE EXCEPTION '请先读取通知并使用列表时间'; END IF;
 IF p_action='read' THEN UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=v_uid AND id=ANY(p_ids) AND deleted_at IS NULL;
 ELSIF p_action='delete' THEN UPDATE notifications SET deleted_at=now() WHERE user_id=v_uid AND id=ANY(p_ids) AND deleted_at IS NULL;
 ELSIF p_action='read_all' THEN UPDATE notifications SET read_at=now() WHERE user_id=v_uid AND deleted_at IS NULL AND read_at IS NULL AND created_at<=p_cutoff;
 ELSIF p_action='clear_read' THEN UPDATE notifications SET deleted_at=now() WHERE user_id=v_uid AND deleted_at IS NULL AND read_at IS NOT NULL AND created_at<=p_cutoff;
 ELSE
   IF jsonb_typeof(p_preferences->'task_success') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_preferences->'intelligence_success') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION '通知偏好非法'; END IF;
   INSERT INTO notification_preferences(user_id,task_success,intelligence_success)
   VALUES(v_uid,(p_preferences->>'task_success')::boolean,(p_preferences->>'intelligence_success')::boolean)
   ON CONFLICT(user_id) DO UPDATE SET task_success=EXCLUDED.task_success,intelligence_success=EXCLUDED.intelligence_success;
 END IF;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN jsonb_build_object('updated',v_count);
END;
$$;
CREATE FUNCTION prune_notifications() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count int;
BEGIN
 DELETE FROM notifications WHERE created_at<now()-interval '180 days';
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION create_product_translation(uuid,uuid,jsonb,uuid),create_production_job(uuid,uuid,text,jsonb,uuid,uuid),
 claim_production_job(text,uuid),update_production_job(uuid,uuid,text,jsonb),prune_product_translations(),prune_notifications(),
 reconcile_production_job(uuid,jsonb,text),valid_product_translation_result(jsonb,uuid,jsonb),
 notify_task_state(),read_notifications(text,int,int),mutate_notifications(text,uuid[],timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION create_product_translation(uuid,uuid,jsonb,uuid),create_production_job(uuid,uuid,text,jsonb,uuid,uuid),
 claim_production_job(text,uuid),update_production_job(uuid,uuid,text,jsonb),prune_product_translations(),prune_notifications() TO service_role;
GRANT EXECUTE ON FUNCTION reconcile_production_job(uuid,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION read_notifications(text,int,int),mutate_notifications(text,uuid[],timestamptz,jsonb) TO authenticated;
COMMIT;
