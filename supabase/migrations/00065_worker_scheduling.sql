BEGIN;

-- 持久加权服务机会；不替换原任务租约、原计费或UNKNOWN语义。
CREATE TABLE worker_queue_budgets (
 lane text PRIMARY KEY,
 finance boolean NOT NULL DEFAULT false,
 weight int NOT NULL CHECK(weight BETWEEN 1 AND 2),
 virtual_finish numeric NOT NULL DEFAULT 0,
 dispatch_count bigint NOT NULL DEFAULT 0,
 last_dispatch_at timestamptz
);
INSERT INTO worker_queue_budgets(lane,finance,weight)
 SELECT lane,lane IN ('cash_refund','wechat_order','wechat_refund'),
   CASE WHEN lane IN ('cash_refund','wechat_order','wechat_refund') THEN 2 ELSE 1 END
 FROM unnest(ARRAY['video','image','publish','analysis','edit_analysis','batch_pipeline',
   'product_import','product_translate','cash_refund','wechat_order','wechat_refund',
   'knowledge_index','knowledge_search','intelligence_competitor','intelligence_products',
   'tts','asr','voice_clone','avatar','lipsync']) lane;
CREATE TABLE worker_dispatches (
 lease_token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lane text NOT NULL REFERENCES worker_queue_budgets(lane),
 lease_until timestamptz NOT NULL DEFAULT now()+interval '180 seconds'
);
CREATE TABLE worker_maintenance_state (
 task text PRIMARY KEY,
 interval_seconds int NOT NULL CHECK(interval_seconds BETWEEN 60 AND 86400),
 next_run_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,
 lease_until timestamptz,
 failures int NOT NULL DEFAULT 0,
 last_success_at timestamptz
);
INSERT INTO worker_maintenance_state(task,interval_seconds) VALUES
 ('enqueue_intelligence_schedule',60),('prune_intelligence_data',3600),('prune_product_imports',3600),
 ('prune_product_translations',3600),('prune_notifications',3600),('prune_job_evidence',3600),
 ('enqueue_expired_media',3600),('media_deletions',60),('voice_deletions',60),('metrics',900);
ALTER TABLE worker_queue_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_maintenance_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON worker_queue_budgets,worker_dispatches,worker_maintenance_state FROM anon,authenticated;
GRANT ALL ON worker_queue_budgets,worker_dispatches,worker_maintenance_state TO service_role;

CREATE FUNCTION worker_due_lanes() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(lane ORDER BY lane),'[]') FROM (
   SELECT DISTINCT kind AS lane FROM production_jobs
   WHERE status IN ('pending','running') AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now())
     AND kind<>'render'
     AND (kind NOT IN ('analysis','edit_analysis') OR evidence IS NOT NULL OR resolution IS NOT NULL)
   UNION
   SELECT 'video' WHERE EXISTS(SELECT 1 FROM video_jobs WHERE charge_id IS NOT NULL
     AND status IN ('pending','processing') AND submission_state IN ('queued','submitting','submitted')
     AND (model_config_version_id IS NOT NULL OR resolution_event IS NOT NULL)
     AND next_poll_at<=now() AND (lease_until IS NULL OR lease_until<now()))
   UNION
   SELECT 'cash_refund' WHERE EXISTS(SELECT 1 FROM alipay_refunds WHERE pay_channel='alipay'
     AND status IN ('requested','unknown','success') AND applied_at IS NULL AND attempts<100
     AND next_query_at<=now() AND (lease_until IS NULL OR lease_until<now()))
   UNION
   SELECT 'wechat_refund' WHERE EXISTS(SELECT 1 FROM alipay_refunds WHERE pay_channel='wechat'
     AND status IN ('requested','unknown') AND applied_at IS NULL
     AND next_query_at<=now() AND (lease_until IS NULL OR lease_until<now()))
   UNION
   SELECT 'wechat_order' WHERE EXISTS(SELECT 1 FROM wechat_transactions t JOIN orders o ON o.id=t.order_id
     WHERE o.status='pending' AND t.next_query_at<=now() AND (t.lease_until IS NULL OR t.lease_until<now()))
   UNION
   SELECT 'batch_pipeline' WHERE EXISTS(SELECT 1 FROM batch_jobs b JOIN batch_job_items i ON i.batch_id=b.id
     JOIN batch_pipeline_stages s ON s.item_id=i.id WHERE (b.status='processing' OR b.cancellation_requested)
     AND b.request_payload ? 'pipeline' AND s.state IN ('waiting','awaiting_confirmation'))
 ) due;
$$;
CREATE FUNCTION claim_worker_dispatch(p_excluded jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE budget worker_queue_budgets%ROWTYPE; token uuid; total int; ordinary int;
BEGIN
 IF jsonb_typeof(p_excluded) IS DISTINCT FROM 'array' OR jsonb_array_length(p_excluded)>20 THEN
   RAISE EXCEPTION '队列过滤不正确';
 END IF;
 -- 跨调度进程的总执行上限8；其中2个机会只能用于资金核对。
 PERFORM pg_advisory_xact_lock(65001);
 DELETE FROM worker_dispatches WHERE lease_until<now();
 SELECT count(*),count(*) FILTER(WHERE NOT q.finance) INTO total,ordinary
   FROM worker_dispatches d JOIN worker_queue_budgets q USING(lane);
 IF total>=8 THEN RETURN NULL; END IF;
 SELECT q.* INTO budget FROM worker_queue_budgets q
 WHERE NOT p_excluded ? q.lane AND (q.finance OR ordinary<6)
   AND (SELECT count(*) FROM worker_dispatches d WHERE d.lane=q.lane)<2
 ORDER BY q.virtual_finish,q.lane LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO worker_dispatches(lane) VALUES(budget.lane) RETURNING lease_token INTO token;
 UPDATE worker_queue_budgets SET virtual_finish=virtual_finish+1.0/weight,
   dispatch_count=dispatch_count+1,last_dispatch_at=now() WHERE lane=budget.lane;
 RETURN jsonb_build_object('lane',budget.lane,'lease_token',token);
END;
$$;
CREATE FUNCTION finish_worker_dispatch(p_lease uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 DELETE FROM worker_dispatches WHERE lease_token=p_lease AND lease_until>now();
 RETURN FOUND;
END;
$$;
CREATE FUNCTION claim_worker_maintenance() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item worker_maintenance_state%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(65002);
 IF EXISTS(SELECT 1 FROM worker_maintenance_state WHERE lease_until>now()) THEN RETURN NULL; END IF;
 SELECT * INTO item FROM worker_maintenance_state WHERE next_run_at<=now()
   AND (lease_until IS NULL OR lease_until<now())
   ORDER BY next_run_at,task LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE worker_maintenance_state SET lease_token=gen_random_uuid(),lease_until=now()+interval '180 seconds'
 WHERE task=item.task RETURNING * INTO item;
 RETURN jsonb_build_object('task',item.task,'lease_token',item.lease_token);
END;
$$;
CREATE FUNCTION finish_worker_maintenance(p_lease uuid,p_success boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_success IS NULL THEN RAISE EXCEPTION '维护回执不正确'; END IF;
 UPDATE worker_maintenance_state SET
   next_run_at=now()+make_interval(secs=>CASE WHEN p_success THEN interval_seconds
     ELSE least(3600,60*power(2,least(failures,5))::int) END),
   failures=CASE WHEN p_success THEN 0 ELSE failures+1 END,
   last_success_at=CASE WHEN p_success THEN now() ELSE last_success_at END,
   lease_token=NULL,lease_until=NULL WHERE lease_token=p_lease AND lease_until>now();
 RETURN FOUND;
END;
$$;
CREATE FUNCTION worker_runtime_ready() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT count(*)=20 FROM worker_queue_budgets;
$$;

-- 发布预检保留原probe的列/价格/业务语义检查，并指出缺失项。普通健康不运行此函数。
CREATE FUNCTION worker_capabilities() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE missing text[]:='{}'; spec jsonb; item record; column_name text; signature text; result boolean;
BEGIN
 spec:='{
  "production_jobs":["id","kind","lease_token","evidence","source_erased_at"],
  "voice_clones":["id","model_config_version_id","revoked_at","provider_deleted_at"],
  "measurement_sources":["id","key_digest"],"content_experiments":["id","planned_sample"],
  "knowledge_entries":["id","content_hash"],"knowledge_chunks":["entry_id","version_id"],
  "intelligence_targets":["id","remaining_budget","schedule_version"],
  "publish_groups":["id","request_key"],"publish_tasks":["id","group_id","connection_id"],
  "products":["id","currency","source","import_job_id"],"product_mutation_receipts":["request_key","request_hash"],
  "alipay_refunds":["request_key","lease_token","applied_at","next_query_at","pay_channel","provider_refund_id","submitted_at"],
  "wechat_transactions":["order_id","mchid","lease_token","next_query_at"],
  "orders":["id","wechat_expires_at","wechat_close_requested_at","checkout_request_key"],
  "operator_mutations":["request_key","actor_id"],"notifications":["event_key","read_at","deleted_at"],
  "analysis_intelligence_references":["job_id","context"],"media_deletions":["id","lease_token","lease_until"],
  "media_references":["bucket","path","source_table"],"voice_deletions":["id","lease_token"],
  "voice_revocation_receipts":["request_key","clone_id"],
  "material_upload_receipts":["request_key","material_id","rights_confirmed_at"],
  "batch_pipeline_stages":["id","request_key","charge_id","depends_on","publish_group_id"],
  "support_tickets":["id","version","assignee_id","due_at"],"support_messages":["id","ticket_id","internal"],
  "teams":["state","ops_version","daily_credit_budget"],"team_credit_reservations":["charge_id","team_id"],
  "workload_restrictions":["user_id","restricted","version"],
  "supplier_cost_entries":["job_id","model_version","amount_minor","evidence_sha256"],
  "operations_alerts":["id","rule","status","version"],"operations_alert_events":["alert_id","event","version"],
  "operations_monitor_state":["last_scan_at","scheduler_healthy"],
  "ai_requests":["id","script_id","status"],"model_attempts":["id","request_id","status"],
  "worker_queue_budgets":["lane","weight","virtual_finish"],"worker_dispatches":["lease_token","lease_until"],
  "worker_maintenance_state":["task","next_run_at","failures"]
 }'::jsonb;
 FOR item IN SELECT * FROM jsonb_each(spec) LOOP
   FOR column_name IN SELECT jsonb_array_elements_text(item.value) LOOP
     IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.'||item.key)
       AND attname=column_name AND attnum>0 AND NOT attisdropped) THEN
       missing:=array_append(missing,item.key); EXIT;
     END IF;
   END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM credit_costs WHERE action=ANY(ARRAY[
   'generate_tts','generate_asr','generate_voice_clone','generate_avatar','generate_lipsync','generate_analysis',
   'generate_knowledge_index','generate_knowledge_search','generate_intelligence_competitor',
   'generate_intelligence_products','generate_product_translate','generate_edit_beats','generate_edit_subtitles'])
   AND cost IS NOT NULL AND cost>=0)<>13 THEN missing:=array_append(missing,'credit_costs'); END IF;
 FOREACH signature IN ARRAY ARRAY[
   'claim_production_job(text,uuid)','claim_video_job(uuid)','update_production_job(uuid,uuid,text,jsonb)',
   'worker_due_lanes()','claim_worker_dispatch(jsonb)','finish_worker_dispatch(uuid)','claim_worker_maintenance()',
   'finish_worker_maintenance(uuid,boolean)','begin_script_request(uuid,uuid,jsonb)',
   'checkpoint_script_result(uuid,uuid,text,jsonb)','begin_model_attempt(uuid,uuid,text,text,uuid,text,uuid,jsonb)'
 ] LOOP
   IF to_regprocedure('public.'||signature) IS NULL OR NOT COALESCE(
     has_function_privilege('service_role',to_regprocedure('public.'||signature),'EXECUTE'),false) THEN
     missing:=array_append(missing,signature);
   END IF;
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['profile_overview_schema_ready','reward_schema_ready',
   'account_credits_schema_ready','image_editing_schema_ready'] LOOP
   result:=false;
   BEGIN
     EXECUTE format('SELECT public.%I()',signature) INTO result;
   EXCEPTION WHEN OTHERS THEN result:=false;
   END;
   IF result IS DISTINCT FROM true THEN missing:=array_append(missing,signature); END IF;
 END LOOP;
 RETURN jsonb_build_object('ready',cardinality(missing)=0,'version',23,'render_version',4,'edit_version',2,
   'required_migration','00065','missing',to_jsonb(missing));
END;
$$;
REVOKE ALL ON FUNCTION worker_due_lanes(),claim_worker_dispatch(jsonb),finish_worker_dispatch(uuid),claim_worker_maintenance(),
 finish_worker_maintenance(uuid,boolean),worker_runtime_ready(),worker_capabilities() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION worker_due_lanes(),claim_worker_dispatch(jsonb),finish_worker_dispatch(uuid),claim_worker_maintenance(),
 finish_worker_maintenance(uuid,boolean),worker_runtime_ready(),worker_capabilities() TO service_role;
COMMIT;
