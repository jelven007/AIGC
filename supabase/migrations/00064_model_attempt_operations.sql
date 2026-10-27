BEGIN;
-- 同步尝试复用已有现金账单、冲销、权限和原UUID申请；积分不混入现金。
ALTER TABLE supplier_cost_entries DROP CONSTRAINT supplier_cost_entries_job_type_check;
ALTER TABLE supplier_cost_entries ADD CONSTRAINT supplier_cost_entries_job_type_check
  CHECK(job_type IN ('video','production','model_call','model_attempt'));
CREATE OR REPLACE VIEW supplier_cost_workloads WITH (security_invoker=true) AS
 SELECT 'video'::text AS job_type,id,user_id,provider AS kind,status,created_at FROM video_jobs WHERE charge_id IS NOT NULL
 UNION ALL SELECT 'production',id,user_id,kind,status,created_at FROM production_jobs WHERE model_config_version_id IS NOT NULL
 UNION ALL SELECT 'model_call',id,user_id,action,status,created_at FROM model_calls WHERE provider IS NOT NULL AND status IN ('success','error')
 UNION ALL SELECT 'model_attempt',id,user_id,action,status,created_at FROM model_attempts;
CREATE VIEW model_attempt_operations WITH (security_invoker=true) AS
 SELECT a.id,a.user_id,a.request_id,a.action,a.slot,a.config_version_id,a.model,a.status,a.context_versions,
 a.upstream_id,a.prompt_tokens,a.completion_tokens,a.total_tokens,a.latency_ms,a.created_at,a.completed_at,
 a.status IN ('started','unknown','interrupted') AS needs_reconciliation,
 CASE WHEN EXISTS(SELECT 1 FROM supplier_cost_entries c WHERE c.job_type='model_attempt' AND c.job_id=a.id)
   THEN 'recorded' ELSE 'unrecorded' END AS cash_state
 FROM model_attempts a;
REVOKE ALL ON model_attempt_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON model_attempt_operations TO service_role;

ALTER FUNCTION operator_list(uuid,text,int,uuid,text) RENAME TO operator_list_before_attempts;
REVOKE ALL ON FUNCTION operator_list_before_attempts(uuid,text,int,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION operator_list(p_actor uuid,p_domain text,p_page int DEFAULT 1,p_user uuid DEFAULT NULL,p_keyword text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE items jsonb; total bigint;
BEGIN
 IF p_domain<>'model_attempts' THEN RETURN operator_list_before_attempts(p_actor,p_domain,p_page,p_user,p_keyword); END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可读取调用核对' USING ERRCODE='42501'; END IF;
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000 OR length(COALESCE(p_keyword,''))>64 THEN RAISE EXCEPTION '分页或搜索非法'; END IF;
 IF NOT operator_can(p_actor,'costs:read',p_user) AND NOT EXISTS(SELECT 1 FROM operator_grants
  WHERE operator_id=p_actor AND revoked_at IS NULL AND (p_user IS NULL OR scope_user_id=p_user)
  AND operator_can(p_actor,'costs:read',scope_user_id)) THEN RAISE EXCEPTION '无运营权限' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO total FROM model_attempt_operations WHERE operator_can(p_actor,'costs:read',user_id)
  AND (p_user IS NULL OR user_id=p_user) AND position(COALESCE(p_keyword,'') in action)>0;
 SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO items FROM (
  SELECT * FROM model_attempt_operations WHERE operator_can(p_actor,'costs:read',user_id)
   AND (p_user IS NULL OR user_id=p_user) AND position(COALESCE(p_keyword,'') in action)>0
  ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET (p_page-1)*25) q;
 RETURN jsonb_build_object('items',items,'total',total,'page',p_page,'page_size',25,'observed_at',clock_timestamp());
END $$;

ALTER FUNCTION operator_mutate(uuid,uuid,text,jsonb) RENAME TO operator_mutate_before_attempts;
REVOKE ALL ON FUNCTION operator_mutate_before_attempts(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION operator_mutate(p_actor uuid,p_key uuid,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a model_attempts%ROWTYPE; prior operator_mutations%ROWTYPE; cost supplier_cost_entries%ROWTYPE;
 note text; money bigint;
BEGIN
 IF p_action<>'cost_record' OR p_payload->>'job_type' IS DISTINCT FROM 'model_attempt' THEN
  RETURN operator_mutate_before_attempts(p_actor,p_key,p_action,p_payload); END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可登记调用成本' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>12000 THEN
  RAISE EXCEPTION '运营申请非法' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM model_attempts WHERE id=(p_payload->>'job_id')::uuid;
 IF NOT FOUND OR a.user_id IS NULL THEN RAISE EXCEPTION '成本原调用不存在' USING ERRCODE='P0002'; END IF;
 PERFORM require_operator(p_actor,'costs:write',a.user_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,471));
 SELECT * INTO prior FROM operator_mutations WHERE request_key=p_key;
 IF FOUND THEN
  IF prior.actor_id<>p_actor OR prior.action<>p_action OR prior.payload<>p_payload THEN RAISE EXCEPTION '同一运营申请不能修改参数'; END IF;
  RETURN prior.result;
 END IF;
 note:=trim(COALESCE(p_payload->>'reason','')); money:=(p_payload->>'amount_minor')::bigint;
 IF length(note) NOT BETWEEN 1 AND 2000 OR COALESCE(p_payload->>'evidence_sha256','') !~ '^[0-9a-f]{64}$'
  OR length(COALESCE(p_payload->>'statement_ref','')) NOT BETWEEN 1 AND 120
  OR length(COALESCE(p_payload->>'line_ref','')) NOT BETWEEN 1 AND 120
  OR money IS NULL OR money NOT BETWEEN 0 AND 1000000000
  OR COALESCE(p_payload->>'currency','') NOT IN ('CNY','USD','EUR') THEN RAISE EXCEPTION '现金账单参数非法' USING ERRCODE='22023'; END IF;
 INSERT INTO supplier_cost_entries(user_id,job_type,job_id,model_version,provider,provider_task_id,currency,amount_minor,
  statement_ref,line_ref,evidence_sha256,recorded_by)
 VALUES(a.user_id,'model_attempt',a.id,a.config_version_id,a.slot,a.upstream_id,p_payload->>'currency',money,
  p_payload->>'statement_ref',p_payload->>'line_ref',p_payload->>'evidence_sha256',p_actor) RETURNING * INTO cost;
 INSERT INTO operator_mutations(request_key,actor_id,action,payload,result) VALUES(p_key,p_actor,p_action,p_payload,to_jsonb(cost));
 INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
 VALUES(p_actor,'operator_cost_record','supplier_cost_entries',cost.id,jsonb_build_object('result',to_jsonb(cost),'reason',note,'request_key',p_key));
 RETURN to_jsonb(cost);
END $$;
REVOKE ALL ON FUNCTION operator_list(uuid,text,int,uuid,text),operator_mutate(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION operator_list(uuid,text,int,uuid,text),operator_mutate(uuid,uuid,text,jsonb) TO service_role;
COMMIT;
