BEGIN;
CREATE TABLE operations_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rule text NOT NULL,source_type text NOT NULL,source_id uuid NOT NULL,
 user_id uuid REFERENCES auth.users(id),permission text NOT NULL
 CHECK(permission IN ('jobs:read','tickets:read','orders:read','costs:read')),
 severity text NOT NULL CHECK(severity IN ('warning','critical')),title text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
 version int NOT NULL DEFAULT 1,occurrences int NOT NULL DEFAULT 1,observations bigint NOT NULL DEFAULT 1,
 opened_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,acknowledged_at timestamptz,acknowledged_by uuid REFERENCES auth.users(id),note text,
 UNIQUE(rule,source_type,source_id)
);
CREATE INDEX operations_alert_active ON operations_alerts(status,opened_at,id);
CREATE INDEX supplier_cost_original_workload ON supplier_cost_entries(job_type,job_id) WHERE reversal_of IS NULL;
CREATE INDEX video_unknown_alert ON video_jobs(id) WHERE charge_id IS NOT NULL
 AND submission_state='unknown' AND status IN ('pending','processing');
CREATE INDEX production_unknown_alert ON production_jobs(id) WHERE status='unknown';
CREATE TABLE operations_alert_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),alert_id uuid NOT NULL REFERENCES operations_alerts(id),
 event text NOT NULL CHECK(event IN ('opened','acknowledged','resolved')),version int NOT NULL,
 actor_id uuid REFERENCES auth.users(id),note text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(alert_id,version)
);
CREATE TABLE operations_monitor_state (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),last_scan_at timestamptz NOT NULL DEFAULT now(),
 scheduler_healthy boolean NOT NULL DEFAULT true
);
INSERT INTO operations_monitor_state(id) VALUES(true);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['operations_alerts','operations_alert_events','operations_monitor_state'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON %I TO service_role',t);
 END LOOP;
END $$;
-- 只保存规则、原对象UUID与时间，不把配置、正文、商户或响应写入告警。
CREATE VIEW operations_alert_candidates WITH (security_invoker=true) AS
 SELECT 'submission_unknown'::text rule,'video'::text source_type,id source_id,user_id,'jobs:read'::text permission,
  'critical'::text severity,'视频受理结果待核对'::text title FROM video_jobs
  WHERE charge_id IS NOT NULL AND submission_state='unknown' AND status IN ('pending','processing')
 UNION ALL SELECT 'submission_unknown','production',id,user_id,'jobs:read','critical','生产任务结果待核对'
  FROM production_jobs WHERE status='unknown'
 UNION ALL SELECT 'queue_stalled','video',id,user_id,'jobs:read','warning','视频到期任务超过五分钟未推进'
  FROM video_jobs WHERE charge_id IS NOT NULL AND status IN ('pending','processing') AND submission_state<>'unknown'
  AND next_poll_at<now()-interval '5 minutes' AND created_at<now()-interval '5 minutes'
  AND (lease_until IS NULL OR lease_until<now()-interval '5 minutes')
 UNION ALL SELECT 'queue_stalled','production',id,user_id,'jobs:read','warning','生产到期任务超过五分钟未推进'
  FROM production_jobs WHERE status IN ('pending','running') AND next_run_at<now()-interval '5 minutes'
  AND created_at<now()-interval '5 minutes' AND (lease_until IS NULL OR lease_until<now()-interval '5 minutes')
 UNION ALL SELECT 'ticket_overdue','ticket',id,user_id,'tickets:read','warning','工单已超过响应期限'
  FROM support_tickets WHERE status NOT IN ('resolved','closed') AND due_at<now()
 UNION ALL SELECT 'cost_missing',job_type,id,user_id,'costs:read','warning','终态调用超过一天未核对现金账单'
  FROM supplier_cost_workloads w WHERE status IN ('completed','failed','success','error')
  AND CASE job_type WHEN 'video' THEN (SELECT COALESCE(j.completed_at,j.created_at) FROM video_jobs j WHERE j.id=w.id)
    WHEN 'production' THEN (SELECT COALESCE(j.completed_at,j.created_at) FROM production_jobs j WHERE j.id=w.id)
    ELSE created_at END<now()-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM supplier_cost_entries c
   WHERE c.job_type=w.job_type AND c.job_id=w.id AND c.reversal_of IS NULL)
 UNION ALL SELECT 'refund_unsettled','refund',r.id,o.user_id,'orders:read','critical','渠道退款成功但权益尚未结算'
  FROM alipay_refunds r JOIN orders o ON o.id=r.order_id
  WHERE r.status='success' AND r.applied_at IS NULL AND r.updated_at<now()-interval '3 minutes'
 UNION ALL SELECT 'refund_attention','refund',r.id,o.user_id,'orders:read','warning','原路退款需要人工核对'
  FROM alipay_refunds r JOIN orders o ON o.id=r.order_id
  WHERE r.needs_attention AND (r.lease_until IS NULL OR r.lease_until<now())
  AND r.status NOT IN ('success','closed') AND r.created_at<now()-interval '3 minutes'
 UNION ALL SELECT 'payment_attention','order',o.id,o.user_id,'orders:read','warning','微信原交易需要人工核对'
  FROM wechat_transactions t JOIN orders o ON o.id=t.order_id WHERE t.needs_attention AND o.status='pending'
  AND (t.lease_until IS NULL OR t.lease_until<now()) AND t.created_at<now()-interval '3 minutes'
 UNION ALL SELECT 'media_cleanup_stalled','media_deletion',id,user_id,'jobs:read','warning','私有对象删除持续失败'
  FROM media_deletions WHERE completed_at IS NULL AND attempts>=3 AND next_run_at<now()-interval '5 minutes'
  AND (lease_until IS NULL OR lease_until<now())
 UNION ALL SELECT 'scheduler_unhealthy','scheduler','00000000-0000-4000-8000-000000000058'::uuid,NULL,
  'jobs:read','critical','后台调度心跳失效或连续失败'
  FROM operations_monitor_state WHERE NOT scheduler_healthy;
REVOKE ALL ON operations_alert_candidates FROM PUBLIC,anon,authenticated;
GRANT SELECT ON operations_alert_candidates TO service_role;
CREATE FUNCTION refresh_operations_alerts(p_scheduler_healthy boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n timestamptz:=clock_timestamp(); opened int; resolved int;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅后台可刷新告警' USING ERRCODE='42501'; END IF;
 IF p_scheduler_healthy IS NULL THEN RAISE EXCEPTION '缺少真实调度状态' USING ERRCODE='22023'; END IF;
 IF NOT pg_try_advisory_xact_lock(7348219902) THEN RETURN '{"skipped":true}'::jsonb; END IF;
 UPDATE operations_monitor_state SET last_scan_at=n,scheduler_healthy=p_scheduler_healthy WHERE id;
 WITH changes AS (
  INSERT INTO operations_alerts AS a(rule,source_type,source_id,user_id,permission,severity,title,opened_at,last_seen_at)
  SELECT rule,source_type,source_id,user_id,permission,severity,title,n,n FROM operations_alert_candidates
  ON CONFLICT(rule,source_type,source_id) DO UPDATE SET
   last_seen_at=n,observations=a.observations+1,status=CASE WHEN a.status='resolved' THEN 'open' ELSE a.status END,
   version=a.version+CASE WHEN a.status='resolved' THEN 1 ELSE 0 END,
   occurrences=a.occurrences+CASE WHEN a.status='resolved' THEN 1 ELSE 0 END,
   opened_at=CASE WHEN a.status='resolved' THEN n ELSE a.opened_at END,resolved_at=NULL,
   acknowledged_at=CASE WHEN a.status='resolved' THEN NULL ELSE a.acknowledged_at END,
   acknowledged_by=CASE WHEN a.status='resolved' THEN NULL ELSE a.acknowledged_by END,
   note=CASE WHEN a.status='resolved' THEN NULL ELSE a.note END
  RETURNING id,version,status
 ), events AS (
  INSERT INTO operations_alert_events(alert_id,event,version)
  SELECT id,'opened',version FROM changes WHERE status='open'
  ON CONFLICT(alert_id,version) DO NOTHING RETURNING id
 ) SELECT count(*) INTO opened FROM events;
 WITH changes AS (
  UPDATE operations_alerts a SET status='resolved',resolved_at=n,version=version+1
  WHERE status<>'resolved' AND NOT EXISTS(SELECT 1 FROM operations_alert_candidates c
   WHERE c.rule=a.rule AND c.source_type=a.source_type AND c.source_id=a.source_id)
  RETURNING id,version
 ), events AS (
  INSERT INTO operations_alert_events(alert_id,event,version) SELECT id,'resolved',version FROM changes RETURNING id
 ) SELECT count(*) INTO resolved FROM events;
 RETURN jsonb_build_object('opened',opened,'resolved',resolved,'observed_at',n,
  'active',(SELECT count(*) FROM operations_alerts WHERE status<>'resolved'));
END;
$$;
CREATE FUNCTION operator_alert_can(p_actor uuid,p_permission text,p_scope uuid,p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT operator_can(p_actor,CASE WHEN NOT p_write THEN p_permission ELSE CASE p_permission
  WHEN 'jobs:read' THEN 'budgets:write' WHEN 'tickets:read' THEN 'tickets:write'
  WHEN 'orders:read' THEN 'refunds:write' WHEN 'costs:read' THEN 'costs:write' END END,p_scope);
$$;
ALTER FUNCTION operator_access(uuid) RENAME TO operator_access_before_alerts;
REVOKE ALL ON FUNCTION operator_access_before_alerts(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION operator_access(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; extra jsonb:='[]';
BEGIN
 result:=operator_access_before_alerts(p_actor);
 IF result->'permissions' ?| ARRAY['jobs:read','tickets:read','orders:read','costs:read'] THEN extra:=extra||'["alerts:read"]'::jsonb; END IF;
 IF result->'permissions' ?| ARRAY['budgets:write','tickets:write','refunds:write','costs:write'] THEN extra:=extra||'["alerts:write"]'::jsonb; END IF;
 RETURN jsonb_set(result,'{permissions}',result->'permissions'||extra);
END;
$$;
ALTER FUNCTION operator_list(uuid,text,int,uuid,text) RENAME TO operator_list_before_alerts;
REVOKE ALL ON FUNCTION operator_list_before_alerts(uuid,text,int,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION operator_list(p_actor uuid,p_domain text,p_page int DEFAULT 1,p_user uuid DEFAULT NULL,p_keyword text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE items jsonb; total bigint; n timestamptz:=clock_timestamp(); state jsonb;
BEGIN
 IF p_domain<>'alerts' THEN RETURN operator_list_before_alerts(p_actor,p_domain,p_page,p_user,p_keyword); END IF;
 IF NOT(operator_access(p_actor)->'permissions' ? 'alerts:read') THEN RAISE EXCEPTION '无运营权限' USING ERRCODE='42501'; END IF;
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000 OR length(COALESCE(p_keyword,''))>64 THEN
  RAISE EXCEPTION '告警分页或搜索非法' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO total FROM operations_alerts a WHERE operator_alert_can(p_actor,a.permission,a.user_id)
  AND (p_user IS NULL OR a.user_id=p_user) AND position(COALESCE(p_keyword,'') in a.title||a.rule)>0;
 SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO items FROM (
  SELECT a.*,operator_alert_can(p_actor,a.permission,a.user_id,true) can_ack FROM operations_alerts a
  WHERE operator_alert_can(p_actor,a.permission,a.user_id) AND (p_user IS NULL OR a.user_id=p_user)
   AND position(COALESCE(p_keyword,'') in a.title||a.rule)>0
  ORDER BY (a.status='resolved'),(a.severity='critical') DESC,a.opened_at DESC,a.id DESC LIMIT 25 OFFSET (p_page-1)*25
 ) q;
 SELECT jsonb_build_object('last_scan_at',last_scan_at,'stale',last_scan_at<n-interval '3 minutes')
 INTO state FROM operations_monitor_state WHERE id;
 RETURN jsonb_build_object('items',items,'total',total,'page',p_page,'page_size',25,'observed_at',n,'monitor',state);
END;
$$;
ALTER FUNCTION operator_mutate(uuid,uuid,text,jsonb) RENAME TO operator_mutate_before_alerts;
REVOKE ALL ON FUNCTION operator_mutate_before_alerts(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION operator_mutate(p_actor uuid,p_key uuid,p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE alert operations_alerts%ROWTYPE; prior operator_mutations%ROWTYPE; result jsonb; reason text;
BEGIN
 IF p_action<>'alert_ack' THEN RETURN operator_mutate_before_alerts(p_actor,p_key,p_action,p_payload); END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可确认告警' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>12000
  OR NOT(p_payload ?& ARRAY['alert_id','expected','reason']) THEN RAISE EXCEPTION '告警申请非法' USING ERRCODE='22023'; END IF;
 SELECT * INTO alert FROM operations_alerts WHERE id=(p_payload->>'alert_id')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION '告警不存在' USING ERRCODE='P0002'; END IF;
 IF NOT operator_alert_can(p_actor,alert.permission,alert.user_id,true) THEN RAISE EXCEPTION '无运营权限' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,471));
 SELECT * INTO prior FROM operator_mutations WHERE request_key=p_key;
 IF FOUND THEN
  IF prior.actor_id<>p_actor OR prior.action<>p_action OR prior.payload<>p_payload THEN RAISE EXCEPTION '同一运营申请不能修改参数'; END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO alert FROM operations_alerts WHERE id=alert.id FOR UPDATE;
 reason:=trim(COALESCE(p_payload->>'reason',''));
 IF length(reason) NOT BETWEEN 1 AND 2000 OR jsonb_typeof(p_payload->'expected') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION '告警原因或版本非法' USING ERRCODE='22023'; END IF;
 IF alert.version IS DISTINCT FROM (p_payload->>'expected')::int OR alert.status<>'open' THEN
  RAISE EXCEPTION '告警版本已变化，请刷新后重试'; END IF;
 UPDATE operations_alerts SET status='acknowledged',acknowledged_at=now(),acknowledged_by=p_actor,
  note=reason,version=version+1 WHERE id=alert.id RETURNING * INTO alert;
 INSERT INTO operations_alert_events(alert_id,event,version,actor_id,note) VALUES(alert.id,'acknowledged',alert.version,p_actor,reason);
 result:=to_jsonb(alert);
 INSERT INTO operator_mutations(request_key,actor_id,action,payload,result) VALUES(p_key,p_actor,p_action,p_payload,result);
 INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
 VALUES(p_actor,'operator_alert_ack','operations_alerts',alert.id,jsonb_build_object('request_key',p_key,'version',alert.version,'reason',reason));
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION refresh_operations_alerts(boolean),operator_alert_can(uuid,text,uuid,boolean),
 operator_access(uuid),operator_list(uuid,text,int,uuid,text),operator_mutate(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION refresh_operations_alerts(boolean),operator_access(uuid),operator_list(uuid,text,int,uuid,text),
 operator_mutate(uuid,uuid,text,jsonb) TO service_role;
COMMIT;
