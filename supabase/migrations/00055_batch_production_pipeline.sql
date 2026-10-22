BEGIN;
-- 阶段独立原请求、配置版本和扣费流水。等待依赖的任务不占媒体/字幕/渲染执行名额。
CREATE TABLE batch_pipeline_stages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL REFERENCES batch_job_items(id) ON DELETE CASCADE,
 position int NOT NULL,
 kind text NOT NULL CHECK(kind IN ('video','tts','subtitles','render','publish')),
 request_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN ('waiting','active','failed','cancelled','awaiting_confirmation')),
 depends_on uuid[] NOT NULL DEFAULT '{}',
 spec jsonb NOT NULL DEFAULT '{}',
 model_version uuid REFERENCES model_config_versions(id),
 charge_id uuid REFERENCES credit_logs(id),
 credit_cost int NOT NULL DEFAULT 0 CHECK(credit_cost>=0),
 video_job_id uuid UNIQUE REFERENCES video_jobs(id),
 production_job_id uuid UNIQUE REFERENCES production_jobs(id),
 publish_group_id uuid UNIQUE REFERENCES publish_groups(id),
 error_message text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(item_id,position)
);
ALTER TABLE batch_pipeline_stages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON batch_pipeline_stages FROM PUBLIC,anon,authenticated;
GRANT ALL ON batch_pipeline_stages TO service_role;
CREATE INDEX batch_pipeline_waiting ON batch_pipeline_stages(item_id,position) WHERE state='waiting';
CREATE INDEX batch_pipeline_due ON batch_pipeline_stages(created_at,position,id) WHERE state='waiting';
CREATE INDEX production_jobs_active_user_kind ON production_jobs(user_id,kind)
 WHERE status IN ('pending','running','unknown');

CREATE VIEW batch_pipeline_state WITH (security_invoker=true) AS
 SELECT s.*,i.batch_id,b.user_id,
 CASE WHEN s.state<>'active' THEN s.state
   WHEN s.kind='video' THEN CASE WHEN v.submission_state='unknown' OR v.needs_attention THEN 'unknown' ELSE v.status END
   WHEN s.kind='publish' THEN CASE
     WHEN EXISTS(SELECT 1 FROM publish_tasks t WHERE t.group_id=s.publish_group_id AND t.status='unknown') THEN 'unknown'
     WHEN EXISTS(SELECT 1 FROM publish_tasks t WHERE t.group_id=s.publish_group_id AND t.status NOT IN ('published','failed','cancelled')) THEN 'running'
     WHEN EXISTS(SELECT 1 FROM publish_tasks t WHERE t.group_id=s.publish_group_id AND t.status='failed') THEN 'failed'
     WHEN EXISTS(SELECT 1 FROM publish_tasks t WHERE t.group_id=s.publish_group_id AND t.status='cancelled') THEN 'cancelled'
     ELSE 'completed' END
   ELSE p.status END AS status,
 COALESCE(v.progress,p.progress,0) AS progress,
 COALESCE(v.result,p.result) AS result,
 COALESCE(s.error_message,v.error_message,p.error_message) AS error,
 CASE WHEN s.charge_id IS NULL THEN 'free'
   WHEN EXISTS(SELECT 1 FROM credit_logs c WHERE c.original_charge_id=s.charge_id AND c.type='refund') THEN 'refunded'
   WHEN COALESCE(v.status,p.status)='completed' THEN 'settled' ELSE 'reserved' END AS billing_state
 FROM batch_pipeline_stages s JOIN batch_job_items i ON i.id=s.item_id JOIN batch_jobs b ON b.id=i.batch_id
 LEFT JOIN video_jobs v ON v.id=s.video_job_id LEFT JOIN production_jobs p ON p.id=s.production_job_id;
REVOKE ALL ON batch_pipeline_state FROM PUBLIC,anon,authenticated;
GRANT SELECT ON batch_pipeline_state TO service_role;

ALTER FUNCTION batch_video_snapshot(uuid,uuid) RENAME TO batch_video_snapshot_before_pipeline;
REVOKE ALL ON FUNCTION batch_video_snapshot_before_pipeline(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION batch_video_snapshot(p_user_id uuid,p_batch_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b batch_jobs%ROWTYPE; items jsonb; stats record; money record; state text;
BEGIN
 SELECT * INTO b FROM batch_jobs WHERE id=p_batch_id AND user_id=p_user_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT(b.request_payload ? 'pipeline') THEN RETURN batch_video_snapshot_before_pipeline(p_user_id,p_batch_id); END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY position),'[]') INTO items FROM (
   SELECT i.position,jsonb_build_object('id',i.id,'product_id',i.product_id,'product_name',i.product_name,
     'project_id',i.video_project_id,'video_job_id',i.video_job_id,
     'status',CASE WHEN count(*) FILTER(WHERE s.status NOT IN ('completed','failed','cancelled','awaiting_confirmation'))>0 THEN 'processing'
       WHEN count(*) FILTER(WHERE s.status='failed')>0 THEN 'failed'
       WHEN count(*) FILTER(WHERE s.status='cancelled')>0 THEN 'cancelled'
       WHEN count(*) FILTER(WHERE s.status='awaiting_confirmation')>0 THEN 'awaiting_publish' ELSE 'completed' END,
     'progress',round(avg(CASE WHEN s.status IN ('completed','failed','cancelled') THEN 100 ELSE s.progress END)),
     'needs_attention',bool_or(s.status='unknown'),
     'video_url',max(CASE WHEN s.kind='render' AND s.status='completed' THEN s.result->>'url' END),
     'error_message',max(s.error),
     'stages',jsonb_agg(jsonb_build_object('id',s.id,'kind',s.kind,'position',s.position,'status',s.status,
       'request_key',s.request_key,'progress',s.progress,'billing_state',s.billing_state,
       'credit_cost',s.credit_cost,'error_message',s.error,'publish_group_id',s.publish_group_id) ORDER BY s.position)
   ) x FROM batch_job_items i JOIN batch_pipeline_state s ON s.item_id=i.id
   WHERE i.batch_id=p_batch_id GROUP BY i.id
 ) q;
 SELECT count(*)::int total,count(*) FILTER(WHERE value->>'status'='completed')::int completed,
   count(*) FILTER(WHERE value->>'status'='failed')::int failed,
   count(*) FILTER(WHERE value->>'status'='cancelled')::int cancelled,
   count(*) FILTER(WHERE value->>'status'='awaiting_publish')::int awaiting,
   count(*) FILTER(WHERE (value->>'needs_attention')::boolean)::int attention,
   COALESCE(round(avg((value->>'progress')::numeric)),0)::int progress
   INTO stats FROM jsonb_array_elements(items);
 SELECT COALESCE(sum(credit_cost) FILTER(WHERE billing_state='reserved'),0)::int reserved,
   COALESCE(sum(credit_cost) FILTER(WHERE billing_state='settled'),0)::int settled,
   COALESCE(sum(credit_cost) FILTER(WHERE billing_state='refunded'),0)::int refunded,
   count(*) FILTER(WHERE status='waiting')::int queued,
   count(*) FILTER(WHERE status IN ('pending','processing','running','unknown'))::int running
   INTO money FROM batch_pipeline_state WHERE batch_id=p_batch_id;
 state:=CASE WHEN stats.completed+stats.failed+stats.cancelled=stats.total THEN
     CASE WHEN stats.completed=stats.total THEN 'completed' WHEN stats.completed>0 THEN 'partial'
       WHEN stats.failed>0 THEN 'failed' ELSE 'cancelled' END
   WHEN b.cancellation_requested THEN 'cancelling'
   WHEN stats.awaiting+stats.completed+stats.failed+stats.cancelled=stats.total THEN 'awaiting_publish'
   ELSE b.status END;
 RETURN jsonb_build_object('id',b.id,'name',b.name,'provider',b.provider,'status',state,'legacy',false,
   'pipeline',b.request_payload->'pipeline','created_at',b.created_at,'total_count',stats.total,
   'completed_count',stats.completed,'failed_count',stats.failed,'cancelled_count',stats.cancelled,
   'attention_count',stats.attention,'awaiting_count',stats.awaiting,'queued_count',money.queued,'running_count',money.running,
   'reserved_credits',money.reserved,'settled_credits',money.settled,'refunded_credits',money.refunded,
   'unit_cost',b.unit_cost,'credit_budget',b.credit_budget,'progress',stats.progress,'items',items);
END;
$$;

CREATE FUNCTION create_batch_pipeline(p_user uuid,p_key uuid,p_request jsonb,p_items jsonb,p_versions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b batch_jobs%ROWTYPE; item jsonb; shot jsonb; product products%ROWTYPE; iid uuid; project uuid;
 job jsonb; charge jsonb; sid uuid; deps uuid[]; ttsid uuid; subid uuid; renderid uuid;
 video_cost int; tts_cost int; sub_cost int; unit int; total int; pos int:=0; n int; version uuid; v_slot text;
BEGIN
 IF p_key IS NULL OR NOT(p_request ? 'pipeline') OR jsonb_typeof(p_request->'pipeline'->'shots') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_request->'pipeline'->'shots') NOT BETWEEN 2 AND 6 THEN RAISE EXCEPTION '批次编排参数非法'; END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
 SELECT * INTO b FROM batch_jobs WHERE user_id=p_user AND request_key=p_key;
 IF FOUND THEN
   IF b.request_payload IS DISTINCT FROM p_request THEN RAISE EXCEPTION '同一请求标识不能用于不同批次'; END IF;
   RETURN batch_video_snapshot(p_user,b.id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM user_plans u JOIN plans p ON p.id=u.plan_id WHERE u.user_id=p_user
   AND p.level>=1 AND u.status='active' AND (u.expires_at IS NULL OR u.expires_at>now())) THEN
   RAISE EXCEPTION '批量功能需要有效专业版或企业版套餐'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50
   OR (SELECT count(DISTINCT value->>'product_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN
   RAISE EXCEPTION '批次商品应为1–50个不同商品'; END IF;
 SELECT cost INTO video_cost FROM credit_costs WHERE action='generate_video' FOR SHARE;
 SELECT cost INTO tts_cost FROM credit_costs WHERE action='generate_tts' FOR SHARE;
 SELECT cost INTO sub_cost FROM credit_costs WHERE action='generate_edit_subtitles' FOR SHARE;
 n:=jsonb_array_length(p_request->'pipeline'->'shots');
 IF video_cost IS NULL OR video_cost<=0 OR tts_cost IS NULL OR tts_cost<0 OR sub_cost IS NULL OR sub_cost<0 THEN
   RAISE EXCEPTION '批次价格未配置'; END IF;
 unit:=video_cost*n+tts_cost+CASE WHEN (p_request->'pipeline'->>'subtitles')::boolean THEN sub_cost ELSE 0 END;
 total:=unit*jsonb_array_length(p_items);
 IF unit IS DISTINCT FROM (p_request->>'expected_unit_cost')::int THEN RAISE EXCEPTION '积分价格已更新，请重新确认预算'; END IF;
 IF (p_request->>'budget')::int<total OR (p_request->>'budget')::int>100000 THEN RAISE EXCEPTION '批次预算不足或非法'; END IF;
 IF (SELECT credits_total-credits_used FROM user_plans WHERE user_id=p_user)<total THEN RAISE EXCEPTION '积分不足'; END IF;
 IF (SELECT count(*) FROM batch_jobs x WHERE x.user_id=p_user AND (
   EXISTS(SELECT 1 FROM batch_job_items i JOIN video_jobs v ON v.id=i.video_job_id WHERE i.batch_id=x.id AND v.status IN ('pending','processing'))
   OR EXISTS(SELECT 1 FROM batch_pipeline_state s WHERE s.batch_id=x.id AND s.status NOT IN ('completed','failed','cancelled'))))>=5 THEN
   RAISE EXCEPTION '最多同时处理5个批次'; END IF;
 FOR v_slot,version IN SELECT key,value::text::uuid FROM jsonb_each_text(p_versions) LOOP
   PERFORM 1 FROM model_configs WHERE model_configs.slot=v_slot AND enabled AND current_version_id=version FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION '批次模型配置已更新或未启用'; END IF;
 END LOOP;
 IF NOT(p_versions ? ('video.'||(p_request->>'provider'))) OR NOT(p_versions ? 'audio.tts')
   OR (p_request->'pipeline'->>'subtitles')::boolean AND NOT(p_versions ? 'audio.asr') THEN RAISE EXCEPTION '批次模型配置缺失'; END IF;
 INSERT INTO batch_jobs(user_id,name,status,request_key,request_payload,provider,credit_budget,unit_cost,total_count)
 VALUES(p_user,p_request->>'name','processing',p_key,p_request,p_request->>'provider',(p_request->>'budget')::int,unit,jsonb_array_length(p_items))
 RETURNING * INTO b;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   SELECT * INTO product FROM products WHERE id=(item->>'product_id')::uuid AND user_id=p_user FOR SHARE;
   IF NOT FOUND OR jsonb_array_length(item->'shots') IS DISTINCT FROM n
     OR length(trim(COALESCE(item->>'narration',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION '商品或配音正文非法'; END IF;
   INSERT INTO video_projects(user_id,title,status,duration,aspect_ratio,resolution)
     VALUES(p_user,left(product.name||' · 批量成片',80),'draft',
       n*(p_request->'settings'->>'duration')::int,p_request->'settings'->>'ratio',p_request->'settings'->>'resolution') RETURNING id INTO project;
   INSERT INTO batch_job_items(batch_id,product_id,product_name,video_project_id,position,config)
     VALUES(b.id,product.id,product.name,project,pos,jsonb_build_object('pipeline',true)) RETURNING id INTO iid;
   deps:='{}'; pos:=pos+1;
   FOR shot IN SELECT value FROM jsonb_array_elements(item->'shots') LOOP
     sid:=gen_random_uuid();
     job:=create_video_job(p_user,sid,p_request->>'provider',shot,(p_versions->>('video.'||(p_request->>'provider')))::uuid);
     INSERT INTO batch_pipeline_stages(id,item_id,position,kind,request_key,state,spec,model_version,charge_id,credit_cost,video_job_id)
       VALUES(sid,iid,cardinality(deps),'video',sid,'active',shot,(job->>'model_config_version_id')::uuid,
         (job->>'charge_id')::uuid,video_cost,(job->>'id')::uuid);
     IF cardinality(deps)=0 THEN UPDATE batch_job_items SET video_job_id=(job->>'id')::uuid WHERE id=iid; END IF;
     deps:=array_append(deps,sid);
   END LOOP;
   charge:=NULL;
   IF tts_cost>0 THEN charge:=deduct_credits(p_user,tts_cost,'generate_tts'); END IF;
   INSERT INTO batch_pipeline_stages(item_id,position,kind,spec,model_version,charge_id,credit_cost)
     VALUES(iid,n,'tts',jsonb_build_object('input',item->>'narration','voice',p_request->'pipeline'->>'voice',
       'speed',1,'response_format','mp3','instruction','使用目标语言 '||(p_request->'settings'->>'language')),
       (p_versions->>'audio.tts')::uuid,(charge->>'charge_id')::uuid,tts_cost) RETURNING id INTO ttsid;
   deps:=array_append(deps,ttsid);
   charge:=NULL;
   IF (p_request->'pipeline'->>'subtitles')::boolean AND sub_cost>0 THEN
     charge:=deduct_credits(p_user,sub_cost,'generate_edit_subtitles'); END IF;
   INSERT INTO batch_pipeline_stages(item_id,position,kind,depends_on,model_version,charge_id,credit_cost)
     VALUES(iid,n+1,'subtitles',ARRAY[ttsid],CASE WHEN (p_request->'pipeline'->>'subtitles')::boolean
       THEN (p_versions->>'audio.asr')::uuid ELSE NULL END,(charge->>'charge_id')::uuid,
       CASE WHEN (p_request->'pipeline'->>'subtitles')::boolean THEN sub_cost ELSE 0 END) RETURNING id INTO subid;
   deps:=array_append(deps,subid);
   INSERT INTO batch_pipeline_stages(item_id,position,kind,depends_on)
     VALUES(iid,n+2,'render',deps) RETURNING id INTO renderid;
   IF p_request->'pipeline'->>'delivery'='publish' THEN
     INSERT INTO batch_pipeline_stages(item_id,position,kind,state,depends_on)
       VALUES(iid,n+3,'publish','awaiting_confirmation',ARRAY[renderid]);
   END IF;
 END LOOP;
 INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
   VALUES(p_user,'create_batch_pipeline','batch_jobs',b.id,jsonb_build_object('items',pos,'reserved_credits',total,'versions',p_versions));
 RETURN batch_video_snapshot(p_user,b.id);
END;
$$;

CREATE FUNCTION fail_batch_pipeline_stage(p_stage uuid,p_error text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s batch_pipeline_stages%ROWTYPE; uid uuid; bid uuid;
BEGIN
 SELECT b.user_id,b.id INTO STRICT uid,bid FROM batch_jobs b JOIN batch_job_items i ON i.batch_id=b.id
   JOIN batch_pipeline_stages x ON x.item_id=i.id WHERE x.id=p_stage;
 PERFORM 1 FROM user_plans WHERE user_id=uid FOR UPDATE;
 PERFORM 1 FROM batch_jobs WHERE id=bid FOR UPDATE;
 SELECT * INTO s FROM batch_pipeline_stages WHERE id=p_stage FOR UPDATE;
 IF s.state<>'waiting' THEN RETURN false; END IF;
 IF s.charge_id IS NOT NULL THEN PERFORM refund_credit_charge(uid,s.charge_id,p_error); END IF;
 UPDATE batch_pipeline_stages SET state='failed',error_message=left(p_error,500) WHERE id=p_stage;
 RETURN true;
END;
$$;

-- 失败、取消仅释放尚未启动阶段。已受理或未知阶段保留原任务，继续核对。
CREATE FUNCTION advance_batch_pipeline(p_batch uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE row record;
BEGIN
 FOR row IN SELECT DISTINCT b.id,b.user_id FROM batch_jobs b JOIN batch_job_items i ON i.batch_id=b.id
   JOIN batch_pipeline_stages s ON s.item_id=i.id WHERE (p_batch IS NULL OR b.id=p_batch)
   AND s.state IN ('waiting','awaiting_confirmation')
   AND (b.cancellation_requested OR EXISTS(SELECT 1 FROM batch_pipeline_state d
     WHERE d.id=ANY(s.depends_on) AND d.status IN ('failed','cancelled')))
   ORDER BY b.user_id,b.id LIMIT 50 LOOP
   PERFORM 1 FROM user_plans WHERE user_id=row.user_id FOR UPDATE;
   PERFORM 1 FROM batch_jobs WHERE id=row.id FOR UPDATE;
   WITH blocked AS (
     SELECT s.id,s.charge_id,b.cancellation_requested FROM batch_pipeline_stages s
     JOIN batch_job_items i ON i.id=s.item_id JOIN batch_jobs b ON b.id=i.batch_id
     WHERE b.id=row.id AND s.state IN ('waiting','awaiting_confirmation')
     AND (b.cancellation_requested OR EXISTS(SELECT 1 FROM batch_pipeline_state d
       WHERE d.id=ANY(s.depends_on) AND d.status IN ('failed','cancelled')))
   ), refunds AS (
     SELECT id,CASE WHEN charge_id IS NOT NULL THEN refund_credit_charge(row.user_id,charge_id,'批次取消或依赖失败，阶段未提交') END
     FROM blocked
   )
   UPDATE batch_pipeline_stages s SET state=CASE WHEN b.cancellation_requested THEN 'cancelled' ELSE 'failed' END,
     error_message='批次取消或前置阶段失败，未提交此阶段' FROM blocked b,refunds r WHERE s.id=b.id AND r.id=s.id;
 END LOOP;
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM (
   SELECT s.*,i.video_project_id AS project_id,b.request_payload AS request,i.product_name
   FROM batch_pipeline_state s JOIN batch_job_items i ON i.id=s.item_id JOIN batch_jobs b ON b.id=i.batch_id
   WHERE s.state='waiting' AND b.status='processing' AND NOT b.cancellation_requested
     AND (p_batch IS NULL OR b.id=p_batch)
     AND NOT EXISTS(SELECT 1 FROM batch_pipeline_state d WHERE d.id=ANY(s.depends_on) AND d.status<>'completed')
     AND (s.kind<>'tts' OR (SELECT count(*) FROM production_jobs p WHERE p.user_id=b.user_id
       AND p.kind IN ('tts','asr','voice_clone','avatar','lipsync') AND p.status IN ('pending','running','unknown'))<10)
     AND (s.kind<>'subtitles' OR (SELECT count(*) FROM production_jobs p WHERE p.user_id=b.user_id
       AND p.kind='edit_analysis' AND p.status IN ('pending','running','unknown'))<3)
     AND (s.kind<>'render' OR (SELECT count(*) FROM production_jobs p WHERE p.user_id=b.user_id
       AND p.kind='render' AND p.status IN ('pending','running','unknown'))<24)
   ORDER BY s.created_at,s.position LIMIT 10
 ) s),'[]');
END;
$$;

CREATE FUNCTION start_batch_pipeline_stage(p_stage uuid,p_payload jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s batch_pipeline_stages%ROWTYPE; b batch_jobs%ROWTYPE; project uuid; job jsonb; v_kind text;
BEGIN
 SELECT x.* INTO STRICT b FROM batch_jobs x JOIN batch_job_items i ON i.batch_id=x.id
   JOIN batch_pipeline_stages y ON y.item_id=i.id WHERE y.id=p_stage;
 PERFORM 1 FROM user_plans WHERE user_id=b.user_id FOR UPDATE;
 SELECT * INTO b FROM batch_jobs WHERE id=b.id FOR UPDATE;
 SELECT * INTO s FROM batch_pipeline_stages WHERE id=p_stage FOR UPDATE;
 IF s.state<>'waiting' OR b.status<>'processing' OR b.cancellation_requested THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM batch_pipeline_state d WHERE d.id=ANY(s.depends_on) AND d.status<>'completed') THEN RETURN false; END IF;
 SELECT video_project_id INTO project FROM batch_job_items WHERE id=s.item_id;
 v_kind:=CASE WHEN s.kind='subtitles' THEN 'edit_analysis' ELSE s.kind END;
 IF s.kind='tts' AND (SELECT count(*) FROM production_jobs WHERE user_id=b.user_id AND kind IN ('tts','asr','voice_clone','avatar','lipsync')
   AND status IN ('pending','running','unknown'))>=10 THEN RETURN false; END IF;
 IF s.kind='subtitles' AND (SELECT count(*) FROM production_jobs WHERE user_id=b.user_id AND kind='edit_analysis'
   AND status IN ('pending','running','unknown'))>=3 THEN RETURN false; END IF;
 IF s.kind='tts' THEN p_payload:=s.spec; END IF;
 IF s.kind='render' THEN
   IF (SELECT count(*) FROM production_jobs WHERE user_id=b.user_id AND kind='render' AND status IN ('pending','running','unknown'))>=24 THEN RETURN false; END IF;
   job:=create_production_job(b.user_id,s.request_key,'render',p_payload,project,NULL);
   UPDATE video_projects SET style_data=p_payload||jsonb_build_object('edit_mode',true,
     'editorAspect',CASE WHEN p_payload->>'ratio'='1:1' THEN 'aspect-square'
       ELSE 'aspect-['||replace(p_payload->>'ratio',':','/')||']' END,
     'appliedTrans',p_payload->>'transition'),status='processing',progress=0 WHERE id=project;
 ELSE
   IF s.kind<>'tts' AND s.kind<>'subtitles' THEN RAISE EXCEPTION '阶段不能自动启动'; END IF;
   INSERT INTO production_jobs(user_id,request_key,kind,payload,project_id,model_config_version_id,charge_id,credit_cost)
     VALUES(b.user_id,s.request_key,v_kind,p_payload,project,s.model_version,s.charge_id,s.credit_cost)
     RETURNING to_jsonb(production_jobs.*) INTO job;
 END IF;
 UPDATE batch_pipeline_stages SET production_job_id=(job->>'id')::uuid,state='active' WHERE id=p_stage;
 RETURN true;
END;
$$;

ALTER FUNCTION claim_video_job(uuid) RENAME TO claim_video_job_before_pipeline;
REVOKE ALL ON FUNCTION claim_video_job_before_pipeline(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION claim_video_job(p_job_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c record; job jsonb;
BEGIN
 FOR c IN SELECT v.id,s.batch_id,v.submission_state FROM video_jobs v
   LEFT JOIN batch_pipeline_state s ON s.video_job_id=v.id
   WHERE v.status IN ('pending','processing') AND (p_job_id IS NULL OR v.id=p_job_id)
   AND v.charge_id IS NOT NULL AND v.submission_state IN ('queued','submitting','submitted')
   AND (v.model_config_version_id IS NOT NULL OR v.resolution_event IS NOT NULL)
   AND v.next_poll_at<=now() AND (v.lease_until IS NULL OR v.lease_until<now())
   ORDER BY v.next_poll_at,v.created_at LIMIT 50 LOOP
   IF c.batch_id IS NOT NULL AND c.submission_state='queued' THEN
     PERFORM 1 FROM batch_jobs WHERE id=c.batch_id AND status='processing' AND NOT cancellation_requested FOR SHARE SKIP LOCKED;
     IF NOT FOUND THEN CONTINUE; END IF;
   END IF;
   job:=claim_video_job_before_pipeline(c.id);
   IF job IS NOT NULL THEN RETURN job; END IF;
 END LOOP;
 RETURN NULL;
END;
$$;
ALTER FUNCTION claim_production_job(text,uuid) RENAME TO claim_production_job_before_pipeline;
REVOKE ALL ON FUNCTION claim_production_job_before_pipeline(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION claim_production_job(p_kind text,p_job_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c record; job jsonb;
BEGIN
 FOR c IN SELECT p.id,s.batch_id,p.phase,p.evidence,p.resolution FROM production_jobs p
   LEFT JOIN publish_tasks t ON t.job_id=p.id
   LEFT JOIN batch_pipeline_state s ON s.production_job_id=p.id OR s.publish_group_id=t.group_id
   WHERE p.kind=CASE WHEN p_kind='edit_prepare' THEN 'edit_analysis' WHEN p_kind='analysis_prepare' THEN 'analysis' ELSE p_kind END
   AND p.status IN ('pending','running') AND (p_job_id IS NULL OR p.id=p_job_id) AND p.next_run_at<=now()
   AND (p.lease_until IS NULL OR p.lease_until<now())
   AND (p_kind NOT IN ('analysis_prepare','edit_prepare','analysis','edit_analysis')
     OR p_kind IN ('analysis_prepare','edit_prepare') AND p.evidence IS NULL AND p.resolution IS NULL
     OR p_kind IN ('analysis','edit_analysis') AND (p.evidence IS NOT NULL OR p.resolution IS NOT NULL))
   ORDER BY p.next_run_at,p.created_at LIMIT 50 LOOP
   IF c.batch_id IS NOT NULL AND c.resolution IS NULL AND
     (c.phase='ready' OR p_kind='edit_analysis' AND c.phase='accepted' AND c.evidence->'output' IS NULL) THEN
     PERFORM 1 FROM batch_jobs WHERE id=c.batch_id AND status='processing' AND NOT cancellation_requested FOR SHARE SKIP LOCKED;
     IF NOT FOUND THEN CONTINUE; END IF;
   END IF;
   job:=claim_production_job_before_pipeline(p_kind,c.id);
   IF job IS NOT NULL THEN RETURN job; END IF;
 END LOOP;
 RETURN NULL;
END;
$$;

ALTER FUNCTION control_batch_video(uuid,uuid,text) RENAME TO control_batch_video_before_pipeline;
REVOKE ALL ON FUNCTION control_batch_video_before_pipeline(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION control_batch_video(p_user_id uuid,p_batch_id uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b batch_jobs%ROWTYPE; s record;
BEGIN
 SELECT * INTO b FROM batch_jobs WHERE id=p_batch_id AND user_id=p_user_id;
 IF NOT FOUND OR b.request_key IS NULL THEN RAISE EXCEPTION '批次不存在或旧批次不能操作'; END IF;
 IF NOT(b.request_payload ? 'pipeline') THEN RETURN control_batch_video_before_pipeline(p_user_id,p_batch_id,p_action); END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user_id FOR UPDATE;
 SELECT * INTO b FROM batch_jobs WHERE id=p_batch_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '批次不存在'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('pause','resume','cancel') THEN RAISE EXCEPTION '批次操作非法'; END IF;
 IF b.cancellation_requested AND p_action<>'cancel' THEN RAISE EXCEPTION '已取消批次不能恢复'; END IF;
 UPDATE batch_jobs SET status=CASE p_action WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'processing' ELSE 'cancelled' END,
   cancellation_requested=(p_action='cancel'),updated_at=now() WHERE id=p_batch_id;
 IF p_action='cancel' THEN
   FOR s IN SELECT v.* FROM video_jobs v JOIN batch_pipeline_state x ON x.video_job_id=v.id
     WHERE x.batch_id=p_batch_id AND v.status IN ('pending','processing') AND v.submission_state='queued'
     AND v.provider_task_id IS NULL AND v.resolution_event IS NULL FOR UPDATE OF v LOOP
     PERFORM refund_credit_charge(p_user_id,s.charge_id,'用户取消未提交镜头');
     UPDATE video_jobs SET status='cancelled',billing_state='refunded',lease_token=NULL,lease_until=NULL,completed_at=now() WHERE id=s.id;
     UPDATE video_projects SET status='failed',error_message='用户取消未提交镜头' WHERE id=s.project_id;
   END LOOP;
   FOR s IN SELECT p.* FROM production_jobs p JOIN batch_pipeline_state x ON x.production_job_id=p.id
     WHERE x.batch_id=p_batch_id AND p.status='pending' AND p.phase='ready' AND p.lease_token IS NULL FOR UPDATE OF p LOOP
     IF s.charge_id IS NOT NULL THEN PERFORM refund_credit_charge(p_user_id,s.charge_id,'用户取消未启动阶段'); END IF;
     UPDATE production_jobs SET status='cancelled',completed_at=now() WHERE id=s.id;
   END LOOP;
   FOR s IN SELECT t.id FROM publish_tasks t JOIN batch_pipeline_state x ON x.publish_group_id=t.group_id
     WHERE x.batch_id=p_batch_id AND t.status IN ('draft','scheduled') LOOP
     PERFORM cancel_platform_publish(p_user_id,s.id);
   END LOOP;
   PERFORM advance_batch_pipeline(p_batch_id);
 END IF;
 INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
   VALUES(p_user_id,'batch_'||p_action,'batch_jobs',p_batch_id,'{}');
 RETURN batch_video_snapshot(p_user_id,p_batch_id);
END;
$$;

-- 实际配音长度由FFmpeg测量，不截断台词；原阶段spec保留确认时的时长上限。
ALTER FUNCTION update_production_job(uuid,uuid,text,jsonb) RENAME TO update_production_job_before_pipeline;
REVOKE ALL ON FUNCTION update_production_job_before_pipeline(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION update_production_job(p_job_id uuid,p_lease uuid,p_event text,p_data jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j production_jobs%ROWTYPE;
BEGIN
 SELECT * INTO STRICT j FROM production_jobs WHERE id=p_job_id;
 IF p_event IN ('prepared','completed') AND j.payload->'pipeline_audio'='true'::jsonb AND j.evidence IS NULL
   AND j.status NOT IN ('completed','failed','cancelled') THEN
   PERFORM 1 FROM user_plans WHERE user_id=j.user_id FOR UPDATE;
   SELECT * INTO STRICT j FROM production_jobs WHERE id=p_job_id FOR UPDATE;
   IF j.status<>'running' OR p_lease IS NULL OR j.lease_token IS DISTINCT FROM p_lease
     OR NOT EXISTS(SELECT 1 FROM batch_pipeline_stages WHERE production_job_id=j.id AND kind='subtitles')
     OR jsonb_typeof(p_data->'duration') IS DISTINCT FROM 'number'
     OR (p_data->>'duration')::numeric NOT BETWEEN .1 AND (j.payload->'source'->>'duration')::numeric THEN
     RAISE EXCEPTION '配音测量超出确认时长或租约失效'; END IF;
   UPDATE production_jobs SET payload=jsonb_set(payload,'{source,duration}',p_data->'duration') WHERE id=j.id;
   IF p_event='completed' THEN
     p_data:=jsonb_set(p_data,'{source,duration}',p_data->'duration');
   END IF;
 END IF;
 RETURN update_production_job_before_pipeline(p_job_id,p_lease,p_event,p_data);
END;
$$;

ALTER FUNCTION create_publish_group(uuid,uuid,jsonb,text,numeric) RENAME TO create_publish_group_before_pipeline;
REVOKE ALL ON FUNCTION create_publish_group_before_pipeline(uuid,uuid,jsonb,text,numeric) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION create_publish_group(p_user uuid,p_request uuid,p_payload jsonb,p_source text,p_duration numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s batch_pipeline_stages%ROWTYPE; b batch_jobs%ROWTYPE; gid uuid;
BEGIN
 IF NOT(p_payload ? 'batch_item_id') THEN RETURN create_publish_group_before_pipeline(p_user,p_request,p_payload,p_source,p_duration); END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
 SELECT x.* INTO b FROM batch_jobs x JOIN batch_job_items i ON i.batch_id=x.id
   WHERE i.id=(p_payload->>'batch_item_id')::uuid AND x.user_id=p_user AND i.video_project_id=(p_payload->>'project_id')::uuid FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION '批次成片不存在或无权访问'; END IF;
 SELECT * INTO s FROM batch_pipeline_stages WHERE item_id=(p_payload->>'batch_item_id')::uuid AND kind='publish' FOR UPDATE;
 IF NOT FOUND OR s.state NOT IN ('awaiting_confirmation','active')
   OR EXISTS(SELECT 1 FROM batch_pipeline_state d WHERE d.id=ANY(s.depends_on) AND d.status<>'completed') THEN
   RAISE EXCEPTION '批次尚未完成合成或发布已取消'; END IF;
 IF s.state='awaiting_confirmation' AND (b.cancellation_requested OR b.status='paused') THEN RAISE EXCEPTION '批次已取消或暂停'; END IF;
 IF s.request_key IS DISTINCT FROM p_request THEN RAISE EXCEPTION '批次发布请使用原阶段请求标识'; END IF;
 gid:=create_publish_group_before_pipeline(p_user,p_request,p_payload,p_source,p_duration);
 IF s.publish_group_id IS NOT NULL AND s.publish_group_id<>gid THEN RAISE EXCEPTION '批次已有原发布组，请恢复原请求'; END IF;
 UPDATE batch_pipeline_stages SET publish_group_id=gid,state='active' WHERE id=s.id;
 RETURN gid;
END;
$$;
CREATE FUNCTION guard_batch_pipeline_project() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.role()<>'service_role' AND EXISTS(SELECT 1 FROM batch_job_items i JOIN batch_pipeline_state s ON s.item_id=i.id
   WHERE i.video_project_id=OLD.id AND s.status NOT IN ('completed','failed','cancelled')) THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION '批次仍在处理，暂不能删除工程'; END IF;
   IF NEW.video_url IS DISTINCT FROM OLD.video_url OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.duration IS DISTINCT FROM OLD.duration THEN RAISE EXCEPTION '批次成片状态由服务端维护'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER batch_pipeline_project_guard BEFORE UPDATE OR DELETE ON video_projects
 FOR EACH ROW EXECUTE FUNCTION guard_batch_pipeline_project();
ALTER FUNCTION create_batch_video_jobs(uuid,uuid,text,text,jsonb,jsonb,uuid,integer,integer)
 RENAME TO create_batch_video_jobs_before_pipeline;
REVOKE ALL ON FUNCTION create_batch_video_jobs_before_pipeline(uuid,uuid,text,text,jsonb,jsonb,uuid,integer,integer)
 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION create_batch_video_jobs(p_user_id uuid,p_request_key uuid,p_name text,p_provider text,
 p_request jsonb,p_items jsonb,p_config_version uuid,p_expected_unit_cost integer,p_budget integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM user_plans WHERE user_id=p_user_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM batch_jobs WHERE user_id=p_user_id AND request_key=p_request_key)
   AND (SELECT count(*) FROM batch_jobs b WHERE b.user_id=p_user_id AND (
     EXISTS(SELECT 1 FROM batch_job_items i JOIN video_jobs v ON v.id=i.video_job_id
       WHERE i.batch_id=b.id AND v.status IN ('pending','processing'))
     OR EXISTS(SELECT 1 FROM batch_pipeline_state s WHERE s.batch_id=b.id AND s.status NOT IN ('completed','failed','cancelled'))))>=5 THEN
   RAISE EXCEPTION '最多同时处理5个批次'; END IF;
 RETURN create_batch_video_jobs_before_pipeline(p_user_id,p_request_key,p_name,p_provider,p_request,p_items,
   p_config_version,p_expected_unit_cost,p_budget);
END;
$$;
REVOKE ALL ON FUNCTION batch_video_snapshot(uuid,uuid),create_batch_pipeline(uuid,uuid,jsonb,jsonb,jsonb),fail_batch_pipeline_stage(uuid,text),
 advance_batch_pipeline(uuid),start_batch_pipeline_stage(uuid,jsonb),claim_video_job(uuid),claim_production_job(text,uuid),
 control_batch_video(uuid,uuid,text),update_production_job(uuid,uuid,text,jsonb),create_publish_group(uuid,uuid,jsonb,text,numeric),
 create_batch_video_jobs(uuid,uuid,text,text,jsonb,jsonb,uuid,integer,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION batch_video_snapshot(uuid,uuid),create_batch_pipeline(uuid,uuid,jsonb,jsonb,jsonb),fail_batch_pipeline_stage(uuid,text),
 advance_batch_pipeline(uuid),start_batch_pipeline_stage(uuid,jsonb),claim_video_job(uuid),claim_production_job(text,uuid),
 control_batch_video(uuid,uuid,text),update_production_job(uuid,uuid,text,jsonb),create_publish_group(uuid,uuid,jsonb,text,numeric),
 create_batch_video_jobs(uuid,uuid,text,text,jsonb,jsonb,uuid,integer,integer)
 TO service_role;
COMMIT;
