BEGIN;
-- 工单、租户策略、人工风险处置及实际供应商账单。所有写入共用原UUID回执。
ALTER TABLE teams ADD COLUMN state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','suspended')),
 ADD COLUMN ops_version int NOT NULL DEFAULT 1,
 ADD COLUMN daily_credit_budget int NOT NULL DEFAULT 0 CHECK(daily_credit_budget BETWEEN 0 AND 1000000);
CREATE TABLE team_credit_reservations (
 charge_id uuid PRIMARY KEY REFERENCES credit_logs(id),team_id uuid NOT NULL REFERENCES teams(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),amount int NOT NULL CHECK(amount>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_credit_daily ON team_credit_reservations(team_id,created_at);
CREATE TABLE workload_restrictions (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id),restricted boolean NOT NULL DEFAULT false,
 version int NOT NULL DEFAULT 1,reason text NOT NULL DEFAULT '',updated_by uuid REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE risk_events ADD COLUMN disposition text NOT NULL DEFAULT 'unreviewed'
 CHECK(disposition IN ('unreviewed','reviewing','dismissed','confirmed')),
 ADD COLUMN ops_version int NOT NULL DEFAULT 1,ADD COLUMN reviewed_by uuid REFERENCES auth.users(id),
 ADD COLUMN reviewed_at timestamptz,ADD COLUMN resolution_note text;
CREATE TABLE support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 category text NOT NULL CHECK(category IN ('task','payment','access','other')),
 related_type text CHECK(related_type IN ('video','production','order')),
 related_id uuid,status text NOT NULL DEFAULT 'open'
 CHECK(status IN ('open','in_progress','waiting_customer','resolved','closed')),
 priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
 assignee_id uuid REFERENCES auth.users(id),version int NOT NULL DEFAULT 1,
 due_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((related_type IS NULL)=(related_id IS NULL))
);
CREATE INDEX support_ticket_scope ON support_tickets(user_id,updated_at DESC,id);
CREATE INDEX support_ticket_due ON support_tickets(due_at) WHERE status NOT IN ('resolved','closed');
CREATE TABLE support_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ticket_id uuid NOT NULL REFERENCES support_tickets(id),
 author_id uuid NOT NULL REFERENCES auth.users(id),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 internal boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_message_ticket ON support_messages(ticket_id,created_at,id);
CREATE TABLE supplier_cost_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),
 job_type text NOT NULL CHECK(job_type IN ('video','production','model_call')),job_id uuid NOT NULL,
 model_version uuid REFERENCES model_config_versions(id),provider text NOT NULL,
 provider_task_id text,currency text NOT NULL CHECK(currency IN ('CNY','USD','EUR')),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN -1000000000 AND 1000000000),
 statement_ref text NOT NULL CHECK(length(statement_ref) BETWEEN 1 AND 120),
 line_ref text NOT NULL CHECK(length(line_ref) BETWEEN 1 AND 120),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 reversal_of uuid UNIQUE REFERENCES supplier_cost_entries(id),
 recorded_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((reversal_of IS NULL AND amount_minor>=0) OR (reversal_of IS NOT NULL AND amount_minor<=0))
);
CREATE UNIQUE INDEX supplier_statement_line ON supplier_cost_entries(statement_ref,line_ref);
CREATE INDEX supplier_cost_scope ON supplier_cost_entries(user_id,created_at DESC,id);
CREATE VIEW supplier_cost_workloads WITH (security_invoker=true) AS
 SELECT 'video'::text AS job_type,id,user_id,provider AS kind,status,created_at FROM video_jobs WHERE charge_id IS NOT NULL
 UNION ALL SELECT 'production',id,user_id,kind,status,created_at FROM production_jobs WHERE model_config_version_id IS NOT NULL
 UNION ALL SELECT 'model_call',id,user_id,action,status,created_at FROM model_calls WHERE provider IS NOT NULL AND status IN ('success','error');
REVOKE ALL ON supplier_cost_workloads FROM PUBLIC,anon,authenticated;
GRANT SELECT ON supplier_cost_workloads TO service_role;
CREATE FUNCTION immutable_supplier_cost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '现金成本只能追加原流水冲销，禁止覆盖或删除'; END;
$$;
CREATE TRIGGER supplier_cost_immutable BEFORE UPDATE OR DELETE ON supplier_cost_entries
 FOR EACH ROW EXECUTE FUNCTION immutable_supplier_cost();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['team_credit_reservations','workload_restrictions','support_tickets','support_messages','supplier_cost_entries'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON %I TO service_role',t);
 END LOOP;
END $$;
-- 风险与租户状态不能由个人资料字段或API Key管理。
CREATE OR REPLACE FUNCTION operator_can(p_actor uuid,p_permission text,p_scope uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor
 AND (u.banned_until IS NULL OR u.banned_until<=now()) AND
 (u.raw_app_meta_data->>'role'='admin' OR EXISTS(SELECT 1 FROM operator_grants g
 WHERE g.operator_id=u.id AND g.revoked_at IS NULL AND (g.scope_user_id IS NULL OR g.scope_user_id=p_scope)
 AND CASE g.role
 WHEN 'finance' THEN p_permission IN ('orders:read','refunds:write','credits:read','costs:read','costs:write')
 WHEN 'operations' THEN p_permission IN ('customers:read','jobs:read','budgets:write','tickets:read','tickets:write','tenants:read','tenants:write')
 WHEN 'risk' THEN p_permission IN ('risk:read','risk:write','customers:read','tickets:read')
 WHEN 'auditor' THEN p_permission IN ('orders:read','credits:read','customers:read','jobs:read','risk:read','audit:read','tickets:read','tenants:read','costs:read')
 ELSE false END)));
$$;
CREATE OR REPLACE FUNCTION operator_access(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE perms jsonb; grants jsonb; root boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可读取运营身份' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(raw_app_meta_data->>'role'='admin',false) INTO root FROM auth.users
 WHERE id=p_actor AND (banned_until IS NULL OR banned_until<=now());
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'role',role,'scope_user_id',scope_user_id)),'[]')
 INTO grants FROM operator_grants WHERE operator_id=p_actor AND revoked_at IS NULL;
 SELECT COALESCE(jsonb_agg(permission),'[]') INTO perms FROM unnest(ARRAY[
 'orders:read','refunds:write','credits:read','customers:read','jobs:read','budgets:write','risk:read',
 'audit:read','operators:write','tickets:read','tickets:write','tenants:read','tenants:write','risk:write','costs:read','costs:write'
 ]) permission WHERE operator_can(p_actor,permission,NULL) OR EXISTS(SELECT 1 FROM operator_grants
 WHERE operator_id=p_actor AND revoked_at IS NULL AND operator_can(p_actor,permission,scope_user_id));
 RETURN jsonb_build_object('root',COALESCE(root,false),'permissions',perms,'grants',grants);
END;
$$;
CREATE OR REPLACE FUNCTION is_team_member(t_id uuid,u_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM team_members m JOIN teams t ON t.id=m.team_id
 WHERE m.team_id=t_id AND m.user_id=u_id AND m.status='active' AND t.state='active');
$$;
ALTER FUNCTION manage_team(uuid,text,jsonb) RENAME TO manage_team_before_ops;
REVOKE ALL ON FUNCTION manage_team_before_ops(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION manage_team(p_user uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t teams%ROWTYPE; tid uuid; result jsonb; current_version int;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端管理团队' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team-user:'||p_user,0));
 tid:=CASE WHEN p_action='accept' THEN (SELECT team_id FROM team_invitations WHERE token=p_data->>'token')
 ELSE (p_data->>'team_id')::uuid END;
 IF tid IS NOT NULL THEN
  SELECT * INTO t FROM teams WHERE id=tid FOR UPDATE;
  IF t.state='suspended' AND p_action NOT IN ('remove') THEN RAISE EXCEPTION '租户已暂停，请联系运营'; END IF;
 END IF;
 result:=manage_team_before_ops(p_user,p_action,p_data);
 IF tid IS NOT NULL THEN
  UPDATE teams SET ops_version=ops_version+1,updated_at=now() WHERE id=tid RETURNING ops_version INTO current_version;
  result:=result||jsonb_build_object('ops_version',current_version);
 END IF;
 RETURN result;
END;
$$;
-- 锁顺序：用户团队串行锁 → 团队行 → 用户套餐行；成员变动和预算变动也持有团队行。
ALTER FUNCTION deduct_credits(uuid,int,text) RENAME TO deduct_credits_before_ops;
REVOKE ALL ON FUNCTION deduct_credits_before_ops(uuid,int,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION deduct_credits(p_user_id uuid,p_amount int,p_action text DEFAULT 'AI视频生成')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t teams%ROWTYPE; result jsonb; used bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id) THEN
  RAISE EXCEPTION '禁止操作其他用户积分' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team-user:'||p_user_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('workload-user:'||p_user_id,0));
 IF EXISTS(SELECT 1 FROM workload_restrictions WHERE user_id=p_user_id AND restricted) THEN
  RAISE EXCEPTION '账号的新计费任务已受限，可通过工单申诉' USING ERRCODE='42501'; END IF;
 SELECT x.* INTO t FROM teams x JOIN team_members m ON m.team_id=x.id
 WHERE m.user_id=p_user_id AND m.status='active' ORDER BY x.id LIMIT 1 FOR UPDATE OF x;
 IF FOUND THEN
  IF t.state='suspended' THEN RAISE EXCEPTION '租户已暂停新计费任务，可通过工单联系运营' USING ERRCODE='42501'; END IF;
  IF t.daily_credit_budget>0 THEN
   SELECT COALESCE(sum(amount),0) INTO used FROM team_credit_reservations WHERE team_id=t.id
    AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
   IF used+p_amount>t.daily_credit_budget THEN RAISE EXCEPTION '团队日积分预算不足'; END IF;
  END IF;
 END IF;
 result:=deduct_credits_before_ops(p_user_id,p_amount,p_action);
 IF t.id IS NOT NULL THEN
  INSERT INTO team_credit_reservations(charge_id,team_id,user_id,amount)
  VALUES((result->>'charge_id')::uuid,t.id,p_user_id,p_amount);
 END IF;
 RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION deduct_credits(uuid,int,text) TO authenticated,service_role;

ALTER FUNCTION operator_list(uuid,text,int,uuid,text) RENAME TO operator_list_before_ops;
REVOKE ALL ON FUNCTION operator_list_before_ops(uuid,text,int,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION operator_list(p_actor uuid,p_domain text,p_page int DEFAULT 1,p_user uuid DEFAULT NULL,p_keyword text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE permission text; items jsonb; total bigint; offset_rows int;
BEGIN
 IF p_domain NOT IN ('tickets','tenants','costs','cost_missing','risk','customers') THEN
  RETURN operator_list_before_ops(p_actor,p_domain,p_page,p_user,p_keyword); END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端可读取运营数据' USING ERRCODE='42501'; END IF;
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000 OR length(COALESCE(p_keyword,''))>64 THEN RAISE EXCEPTION '分页或搜索非法'; END IF;
 permission:=CASE p_domain WHEN 'tickets' THEN 'tickets:read' WHEN 'tenants' THEN 'tenants:read'
 WHEN 'costs' THEN 'costs:read' WHEN 'cost_missing' THEN 'costs:read' WHEN 'risk' THEN 'risk:read' ELSE 'customers:read' END;
 IF p_domain='tenants' THEN PERFORM require_operator(p_actor,permission,NULL);
 ELSIF NOT operator_can(p_actor,permission,p_user) AND NOT EXISTS(SELECT 1 FROM operator_grants
 WHERE operator_id=p_actor AND revoked_at IS NULL AND (p_user IS NULL OR scope_user_id=p_user)
 AND operator_can(p_actor,permission,scope_user_id)) THEN RAISE EXCEPTION '无运营权限' USING ERRCODE='42501'; END IF;
 offset_rows:=(p_page-1)*25;
 IF p_domain='tickets' THEN
  SELECT count(*) INTO total FROM support_tickets WHERE operator_can(p_actor,permission,user_id)
  AND (p_user IS NULL OR user_id=p_user) AND position(COALESCE(p_keyword,'') in title)>0;
  SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO items FROM (
   SELECT * FROM support_tickets WHERE operator_can(p_actor,permission,user_id) AND (p_user IS NULL OR user_id=p_user)
   AND position(COALESCE(p_keyword,'') in title)>0 ORDER BY updated_at DESC,id DESC LIMIT 25 OFFSET offset_rows
  ) q;
 ELSIF p_domain='tenants' THEN
  SELECT count(*) INTO total FROM teams WHERE (p_user IS NULL OR owner_id=p_user) AND position(COALESCE(p_keyword,'') in name)>0;
  SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO items FROM (
   SELECT t.id,t.name,t.owner_id,t.state,t.ops_version,t.max_members,t.daily_credit_budget,t.created_at,
    (SELECT count(*) FROM team_members m WHERE m.team_id=t.id AND m.status='active') AS active_members,
    (SELECT COALESCE(sum(amount),0) FROM team_credit_reservations c WHERE c.team_id=t.id
     AND c.created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS daily_reserved
   FROM teams t WHERE (p_user IS NULL OR owner_id=p_user) AND position(COALESCE(p_keyword,'') in name)>0
   ORDER BY t.created_at DESC,t.id DESC LIMIT 25 OFFSET offset_rows
  ) q;
 ELSIF p_domain='costs' THEN
  SELECT count(*) INTO total FROM supplier_cost_entries WHERE operator_can(p_actor,permission,user_id)
  AND (p_user IS NULL OR user_id=p_user) AND position(COALESCE(p_keyword,'') in statement_ref)>0;
  SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO items FROM (
   SELECT * FROM supplier_cost_entries WHERE operator_can(p_actor,permission,user_id) AND (p_user IS NULL OR user_id=p_user)
   AND position(COALESCE(p_keyword,'') in statement_ref)>0 ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET offset_rows
  ) q;
 ELSIF p_domain='cost_missing' THEN
  SELECT count(*) INTO total FROM supplier_cost_workloads w WHERE operator_can(p_actor,permission,w.user_id)
  AND (p_user IS NULL OR w.user_id=p_user) AND position(COALESCE(p_keyword,'') in w.kind)>0
  AND NOT EXISTS(SELECT 1 FROM supplier_cost_entries c WHERE c.job_type=w.job_type AND c.job_id=w.id);
  SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO items FROM (
   SELECT w.* FROM supplier_cost_workloads w WHERE operator_can(p_actor,permission,w.user_id)
   AND (p_user IS NULL OR w.user_id=p_user) AND position(COALESCE(p_keyword,'') in w.kind)>0
   AND NOT EXISTS(SELECT 1 FROM supplier_cost_entries c WHERE c.job_type=w.job_type AND c.job_id=w.id)
   ORDER BY w.created_at DESC,w.id DESC LIMIT 25 OFFSET offset_rows
  ) q;
 ELSIF p_domain='risk' THEN
  SELECT count(*) INTO total FROM risk_events WHERE operator_can(p_actor,permission,user_id)
  AND (p_user IS NULL OR user_id=p_user) AND position(COALESCE(p_keyword,'') in COALESCE(action,''))>0;
  SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO items FROM (
   SELECT id,user_id,source,action,decision,category,confidence,disposition,ops_version,reviewed_at,resolution_note,created_at
   FROM risk_events WHERE operator_can(p_actor,permission,user_id) AND (p_user IS NULL OR user_id=p_user)
   AND position(COALESCE(p_keyword,'') in COALESCE(action,''))>0 ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET offset_rows
  ) q;
 ELSE
  SELECT count(*) INTO total FROM profiles p WHERE operator_can(p_actor,permission,p.id)
  AND (p_user IS NULL OR p.id=p_user) AND (position(COALESCE(p_keyword,'') in p.username)>0 OR position(COALESCE(p_keyword,'') in p.email)>0);
  SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO items FROM (
   SELECT p.id,p.username,p.email,p.created_at,up.credits_total-up.credits_used AS credit_balance,up.daily_credit_budget,
   up.plan_id,up.status AS plan_status,COALESCE(r.restricted,false) AS restricted,COALESCE(r.version,0) AS restriction_version,r.reason AS restriction_reason
   FROM profiles p JOIN user_plans up ON up.user_id=p.id LEFT JOIN workload_restrictions r ON r.user_id=p.id
   WHERE operator_can(p_actor,permission,p.id) AND (p_user IS NULL OR p.id=p_user)
   AND (position(COALESCE(p_keyword,'') in p.username)>0 OR position(COALESCE(p_keyword,'') in p.email)>0)
   ORDER BY p.created_at DESC,p.id DESC LIMIT 25 OFFSET offset_rows
  ) q;
 END IF;
 RETURN jsonb_build_object('items',items,'total',total,'page',p_page,'page_size',25,'observed_at',clock_timestamp());
END;
$$;
CREATE FUNCTION supplier_cost_report(p_actor uuid,p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE totals jsonb; missing bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端读取成本' USING ERRCODE='42501'; END IF;
 IF NOT operator_can(p_actor,'costs:read',p_user) AND NOT EXISTS(SELECT 1 FROM operator_grants
 WHERE operator_id=p_actor AND revoked_at IS NULL AND (p_user IS NULL OR scope_user_id=p_user)
 AND operator_can(p_actor,'costs:read',scope_user_id)) THEN RAISE EXCEPTION '无运营权限' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO totals FROM (
  SELECT currency,sum(amount_minor) AS amount_minor,count(*) AS entry_count FROM supplier_cost_entries
  WHERE operator_can(p_actor,'costs:read',user_id) AND (p_user IS NULL OR user_id=p_user) GROUP BY currency ORDER BY currency
 ) q;
 SELECT count(*) INTO missing FROM supplier_cost_workloads w WHERE operator_can(p_actor,'costs:read',w.user_id)
 AND (p_user IS NULL OR w.user_id=p_user) AND NOT EXISTS(SELECT 1 FROM supplier_cost_entries c WHERE c.job_type=w.job_type AND c.job_id=w.id);
 RETURN jsonb_build_object('totals',totals,'unrecorded_workloads',missing,'observed_at',clock_timestamp());
END;
$$;
CREATE FUNCTION support_read(p_actor uuid,p_ticket uuid DEFAULT NULL,p_page int DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t support_tickets%ROWTYPE; items jsonb; total bigint; staff boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端读取工单' USING ERRCODE='42501'; END IF;
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION '工单分页非法'; END IF;
 IF p_ticket IS NULL THEN
  SELECT count(*) INTO total FROM support_tickets WHERE user_id=p_actor;
  SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO items FROM (
   SELECT * FROM support_tickets WHERE user_id=p_actor ORDER BY updated_at DESC,id DESC LIMIT 25 OFFSET (p_page-1)*25
  ) q;
  RETURN jsonb_build_object('items',items,'total',total,'page',p_page,'page_size',25,'observed_at',clock_timestamp());
 END IF;
 SELECT * INTO t FROM support_tickets WHERE id=p_ticket;
 IF NOT FOUND THEN RAISE EXCEPTION '工单不存在' USING ERRCODE='P0002'; END IF;
 staff:=operator_can(p_actor,'tickets:read',t.user_id);
 IF t.user_id<>p_actor AND NOT staff THEN RAISE EXCEPTION '无工单权限' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO total FROM support_messages WHERE ticket_id=t.id AND (staff OR NOT internal);
 SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]') INTO items FROM (
  SELECT * FROM support_messages WHERE ticket_id=t.id AND (staff OR NOT internal)
  ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET (p_page-1)*25
 ) q;
 RETURN jsonb_build_object('ticket',to_jsonb(t),'items',items,'total',total,'page',p_page,'page_size',25,'staff',staff);
END;
$$;
CREATE FUNCTION tenant_read(p_actor uuid,p_team uuid,p_page int DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t teams%ROWTYPE; items jsonb; total bigint;
BEGIN
 PERFORM require_operator(p_actor,'tenants:read',NULL);
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION '租户分页非法' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM teams WHERE id=p_team;
 IF NOT FOUND THEN RAISE EXCEPTION '租户不存在' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO total FROM team_members WHERE team_id=t.id;
 SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO items FROM (
  SELECT m.id,m.user_id,m.role,m.status,m.joined_at,p.username,p.email
  FROM team_members m LEFT JOIN profiles p ON p.id=m.user_id WHERE m.team_id=t.id
  ORDER BY m.joined_at DESC,m.id DESC LIMIT 25 OFFSET (p_page-1)*25
 ) q;
 RETURN jsonb_build_object('tenant',to_jsonb(t),'items',items,'total',total,'page',p_page,'page_size',25);
END;
$$;
ALTER FUNCTION operator_mutate(uuid,uuid,text,jsonb) RENAME TO operator_mutate_before_ops;
REVOKE ALL ON FUNCTION operator_mutate_before_ops(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION operator_mutate(p_actor uuid,p_key uuid,p_action text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prior operator_mutations%ROWTYPE; result jsonb; scope uuid; permission text;
 t support_tickets%ROWTYPE; tenant teams%ROWTYPE; risk risk_events%ROWTYPE; cost supplier_cost_entries%ROWTYPE;
 rid uuid; table_name text; restriction_version int; staff boolean; note text; job_type text; job_id uuid;
 model_version uuid; provider text; provider_task text; target uuid; desired text; currency text; money bigint;
BEGIN
 IF p_action IN ('budget','grant','revoke') THEN RETURN operator_mutate_before_ops(p_actor,p_key,p_action,p_payload); END IF;
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅服务端处理申请' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>12000 THEN
  RAISE EXCEPTION '运营申请非法' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND (banned_until IS NULL OR banned_until<=now())) THEN
  RAISE EXCEPTION '登录账号不可用' USING ERRCODE='42501'; END IF;
 -- 先按原记录或请求确定范围，恢复前仍核对当前权限。
 IF p_action='ticket_create' THEN
  scope:=COALESCE((p_payload->>'user_id')::uuid,p_actor);
  IF scope<>p_actor THEN permission:='tickets:write'; END IF;
 ELSIF p_action IN ('ticket_reply','ticket_update') THEN
  SELECT * INTO t FROM support_tickets WHERE id=(p_payload->>'ticket_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION '工单不存在' USING ERRCODE='P0002'; END IF;
  scope:=t.user_id; staff:=operator_can(p_actor,'tickets:write',scope);
  IF scope<>p_actor OR COALESCE((p_payload->>'internal')::boolean,false) THEN permission:='tickets:write'; END IF;
 ELSIF p_action IN ('tenant_update','tenant_member') THEN permission:='tenants:write'; scope:=NULL;
 ELSIF p_action='risk_review' THEN
  SELECT * INTO risk FROM risk_events WHERE id=(p_payload->>'event_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION '风险事件不存在' USING ERRCODE='P0002'; END IF;
  permission:='risk:write'; scope:=risk.user_id;
 ELSIF p_action='restriction' THEN permission:='risk:write'; scope:=(p_payload->>'user_id')::uuid;
 ELSIF p_action='cost_record' THEN
  job_type:=p_payload->>'job_type'; job_id:=(p_payload->>'job_id')::uuid;
  IF job_type='video' THEN SELECT user_id,model_config_version_id,provider_task_id INTO scope,model_version,provider_task FROM video_jobs WHERE id=job_id;
  ELSIF job_type='production' THEN SELECT user_id,model_config_version_id,COALESCE(evidence->>'provider_task_id',evidence->>'task_id')
   INTO scope,model_version,provider_task FROM production_jobs WHERE id=job_id;
  ELSIF job_type='model_call' THEN SELECT user_id,model_calls.provider INTO scope,provider FROM model_calls WHERE id=job_id;
  ELSE RAISE EXCEPTION '成本任务类型非法' USING ERRCODE='22023'; END IF;
  IF scope IS NULL THEN RAISE EXCEPTION '成本原任务不存在' USING ERRCODE='P0002'; END IF;
  IF model_version IS NOT NULL THEN SELECT slot INTO provider FROM model_config_versions WHERE id=model_version; END IF;
  IF provider IS NULL THEN RAISE EXCEPTION '原任务缺少可核对供应商，须先核对原任务' USING ERRCODE='22023'; END IF;
  permission:='costs:write';
 ELSIF p_action='cost_reverse' THEN
  SELECT * INTO cost FROM supplier_cost_entries WHERE id=(p_payload->>'entry_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION '成本流水不存在' USING ERRCODE='P0002'; END IF;
  scope:=cost.user_id; permission:='costs:write';
 ELSE RAISE EXCEPTION '运营操作不支持' USING ERRCODE='22023'; END IF;
 IF permission IS NOT NULL THEN PERFORM require_operator(p_actor,permission,scope); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,471));
 SELECT * INTO prior FROM operator_mutations WHERE request_key=p_key;
 IF FOUND THEN
  IF prior.actor_id<>p_actor OR prior.action<>p_action OR prior.payload<>p_payload THEN
   RAISE EXCEPTION '同一运营申请不能修改参数'; END IF;
  RETURN prior.result;
 END IF;
 note:=trim(COALESCE(p_payload->>'reason',''));
 IF p_action='ticket_create' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('support-user:'||scope,0));
  IF (SELECT count(*) FROM support_tickets WHERE user_id=scope AND status NOT IN ('resolved','closed'))>=10 THEN
   RAISE EXCEPTION '未结案工单已达10条' USING ERRCODE='22023'; END IF;
  IF NOT (p_payload ?& ARRAY['title','category','body']) OR length(trim(p_payload->>'title')) NOT BETWEEN 1 AND 120
   OR p_payload->>'category' NOT IN ('task','payment','access','other') OR length(trim(p_payload->>'body')) NOT BETWEEN 1 AND 2000 THEN
   RAISE EXCEPTION '工单标题、类别或正文非法' USING ERRCODE='22023'; END IF;
  job_type:=p_payload->>'related_type'; job_id:=(p_payload->>'related_id')::uuid;
  IF job_type IS NOT NULL OR job_id IS NOT NULL THEN
   IF NOT (CASE job_type WHEN 'video' THEN EXISTS(SELECT 1 FROM video_jobs WHERE id=job_id AND user_id=scope)
    WHEN 'production' THEN EXISTS(SELECT 1 FROM production_jobs WHERE id=job_id AND user_id=scope)
    WHEN 'order' THEN EXISTS(SELECT 1 FROM orders WHERE id=job_id AND user_id=scope) ELSE false END) THEN
    RAISE EXCEPTION '关联原任务或订单不属于工单客户' USING ERRCODE='22023'; END IF;
  END IF;
  INSERT INTO support_tickets(user_id,title,category,related_type,related_id)
  VALUES(scope,trim(p_payload->>'title'),p_payload->>'category',job_type,job_id) RETURNING * INTO t;
  INSERT INTO support_messages(ticket_id,author_id,body) VALUES(t.id,p_actor,trim(p_payload->>'body'));
  result:=to_jsonb(t); rid:=t.id; table_name:='support_tickets';
 ELSIF p_action IN ('ticket_reply','ticket_update') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('support-user:'||scope,0));
  SELECT * INTO t FROM support_tickets WHERE id=t.id FOR UPDATE;
  IF (p_payload->>'expected')::int IS DISTINCT FROM t.version THEN RAISE EXCEPTION '工单版本已变化，请刷新后重试'; END IF;
  IF t.status IN ('resolved','closed') AND (p_action='ticket_reply' AND NOT staff OR p_payload->>'status'='open')
   AND (SELECT count(*) FROM support_tickets WHERE user_id=scope AND status NOT IN ('resolved','closed'))>=10 THEN
   RAISE EXCEPTION '未结案工单已达10条' USING ERRCODE='22023'; END IF;
  IF p_action='ticket_reply' THEN
   IF t.status='closed' OR length(trim(COALESCE(p_payload->>'body',''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION '已关闭工单不可回复或正文非法' USING ERRCODE='22023'; END IF;
   INSERT INTO support_messages(ticket_id,author_id,body,internal)
   VALUES(t.id,p_actor,trim(p_payload->>'body'),COALESCE((p_payload->>'internal')::boolean,false));
   UPDATE support_tickets SET version=version+1,updated_at=now(),
    status=CASE WHEN NOT staff AND status IN ('waiting_customer','resolved') THEN 'open' ELSE status END
    WHERE id=t.id RETURNING * INTO t;
  ELSE
   desired:=p_payload->>'status';
   IF desired IS NULL OR desired NOT IN ('open','in_progress','waiting_customer','resolved','closed')
    OR length(note) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION '工单处置状态或原因非法' USING ERRCODE='22023'; END IF;
   IF NOT staff AND NOT(t.status='resolved' AND desired IN ('closed','open')) THEN
    RAISE EXCEPTION '用户只能关闭或重新打开已解决工单' USING ERRCODE='42501'; END IF;
   IF desired='closed' AND t.status<>'resolved' OR t.status='closed' AND desired<>'open' THEN
    RAISE EXCEPTION '工单状态转换非法' USING ERRCODE='22023'; END IF;
   target:=(p_payload->>'assignee_id')::uuid;
   IF target IS NOT NULL AND (NOT staff OR NOT operator_can(target,'tickets:write',scope)) THEN
    RAISE EXCEPTION '处理人没有该客户工单权限' USING ERRCODE='42501'; END IF;
   IF p_payload ? 'priority' AND (NOT staff OR p_payload->>'priority' IS NULL OR p_payload->>'priority' NOT IN ('low','normal','high')) THEN
    RAISE EXCEPTION '工单优先级非法' USING ERRCODE='22023'; END IF;
   INSERT INTO support_messages(ticket_id,author_id,body) VALUES(t.id,p_actor,note);
   UPDATE support_tickets SET status=desired,version=version+1,updated_at=now(),
    assignee_id=CASE WHEN staff AND p_payload ? 'assignee_id' THEN target ELSE assignee_id END,
    priority=COALESCE(p_payload->>'priority',priority),
    due_at=CASE WHEN desired='open' OR p_payload ? 'priority' THEN now()+CASE COALESCE(p_payload->>'priority',priority)
      WHEN 'high' THEN interval '4 hours' WHEN 'low' THEN interval '72 hours' ELSE interval '24 hours' END ELSE due_at END
    WHERE id=t.id RETURNING * INTO t;
  END IF;
  result:=to_jsonb(t); rid:=t.id; table_name:='support_tickets';
 ELSIF p_action IN ('tenant_update','tenant_member') THEN
  SELECT * INTO tenant FROM teams WHERE id=(p_payload->>'team_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '租户不存在' USING ERRCODE='P0002'; END IF;
  IF tenant.ops_version IS DISTINCT FROM (p_payload->>'expected')::int THEN RAISE EXCEPTION '租户版本已变化，请刷新后重试'; END IF;
  IF p_action='tenant_member' THEN
   IF length(note) NOT BETWEEN 1 AND 2000 OR COALESCE(p_payload->>'member_action','') NOT IN ('role','remove') THEN
    RAISE EXCEPTION '成员处置或原因非法' USING ERRCODE='22023'; END IF;
   IF p_payload->>'member_action'='role' AND COALESCE(p_payload->>'role','') NOT IN ('admin','editor','viewer') THEN
    RAISE EXCEPTION '成员角色非法' USING ERRCODE='22023'; END IF;
   UPDATE team_members SET status=CASE WHEN p_payload->>'member_action'='remove' THEN 'removed' ELSE status END,
    role=CASE WHEN p_payload->>'member_action'='role' THEN p_payload->>'role' ELSE role END
    WHERE id=(p_payload->>'member_id')::uuid AND team_id=tenant.id AND status='active' AND user_id<>tenant.owner_id
    RETURNING id INTO rid;
   IF rid IS NULL THEN RAISE EXCEPTION '成员不存在、已移除或为所有者' USING ERRCODE='22023'; END IF;
   UPDATE teams SET ops_version=ops_version+1,updated_at=now() WHERE id=tenant.id RETURNING * INTO tenant;
   result:=jsonb_build_object('tenant',to_jsonb(tenant),'member_id',p_payload->>'member_id');
  ELSE
  IF length(note) NOT BETWEEN 1 AND 2000 OR NOT(p_payload ?& ARRAY['name','state','max_members','daily_credit_budget'])
   OR length(trim(p_payload->>'name')) NOT BETWEEN 1 AND 80 OR p_payload->>'state' NOT IN ('active','suspended')
   OR (p_payload->>'max_members')::int NOT BETWEEN 1 AND 1000 OR (p_payload->>'daily_credit_budget')::int NOT BETWEEN 0 AND 1000000 THEN
   RAISE EXCEPTION '租户策略或原因非法' USING ERRCODE='22023'; END IF;
  IF (p_payload->>'max_members')::int<(SELECT count(*) FROM team_members WHERE team_id=tenant.id AND status='active') THEN
   RAISE EXCEPTION '成员上限不能低于当前有效成员数' USING ERRCODE='22023'; END IF;
  target:=COALESCE((p_payload->>'owner_id')::uuid,tenant.owner_id);
  IF target<>tenant.owner_id THEN
   IF NOT EXISTS(SELECT 1 FROM team_members WHERE team_id=tenant.id AND user_id=target AND status='active') THEN
    RAISE EXCEPTION '新所有者须为当前有效成员' USING ERRCODE='22023'; END IF;
   UPDATE team_members SET role='admin' WHERE team_id=tenant.id AND user_id=tenant.owner_id;
   UPDATE team_members SET role='owner' WHERE team_id=tenant.id AND user_id=target;
  END IF;
  UPDATE teams SET name=trim(p_payload->>'name'),state=p_payload->>'state',max_members=(p_payload->>'max_members')::int,
   daily_credit_budget=(p_payload->>'daily_credit_budget')::int,owner_id=target,ops_version=ops_version+1,updated_at=now()
   WHERE id=tenant.id RETURNING * INTO tenant;
  result:=to_jsonb(tenant);
  END IF;
  rid:=tenant.id; table_name:='teams';
 ELSIF p_action='risk_review' THEN
  SELECT * INTO risk FROM risk_events WHERE id=risk.id FOR UPDATE;
  IF risk.ops_version IS DISTINCT FROM (p_payload->>'expected')::int THEN RAISE EXCEPTION '风险版本已变化，请刷新后重试'; END IF;
  IF length(note) NOT BETWEEN 1 AND 2000 OR COALESCE(p_payload->>'disposition','') NOT IN ('reviewing','dismissed','confirmed') THEN
   RAISE EXCEPTION '风险处置或原因非法' USING ERRCODE='22023'; END IF;
  UPDATE risk_events SET disposition=p_payload->>'disposition',ops_version=ops_version+1,
   reviewed_by=p_actor,reviewed_at=now(),resolution_note=note WHERE id=risk.id RETURNING * INTO risk;
  result:=jsonb_build_object('id',risk.id,'disposition',risk.disposition,'ops_version',risk.ops_version);
  rid:=risk.id; table_name:='risk_events';
 ELSIF p_action='restriction' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('workload-user:'||scope,0));
  IF scope IS NULL OR scope=p_actor OR length(note) NOT BETWEEN 1 AND 2000 OR jsonb_typeof(p_payload->'restricted') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION '限制对象、状态或原因非法' USING ERRCODE='22023'; END IF;
  SELECT r.version INTO restriction_version FROM workload_restrictions r WHERE user_id=scope FOR UPDATE;
  IF COALESCE(restriction_version,0) IS DISTINCT FROM (p_payload->>'expected')::int THEN RAISE EXCEPTION '限制版本已变化，请刷新后重试'; END IF;
  INSERT INTO workload_restrictions(user_id,restricted,reason,updated_by)
   VALUES(scope,(p_payload->>'restricted')::boolean,note,p_actor)
   ON CONFLICT(user_id) DO UPDATE SET restricted=excluded.restricted,reason=excluded.reason,updated_by=p_actor,
    version=workload_restrictions.version+1,updated_at=now() RETURNING to_jsonb(workload_restrictions.*) INTO result;
  rid:=scope; table_name:='workload_restrictions';
 ELSE
  IF length(note) NOT BETWEEN 1 AND 2000 OR COALESCE(p_payload->>'evidence_sha256','') !~ '^[0-9a-f]{64}$'
   OR length(COALESCE(p_payload->>'statement_ref','')) NOT BETWEEN 1 AND 120 OR length(COALESCE(p_payload->>'line_ref','')) NOT BETWEEN 1 AND 120 THEN
   RAISE EXCEPTION '账单凭证、行号或原因非法' USING ERRCODE='22023'; END IF;
  IF p_action='cost_reverse' THEN
   IF cost.reversal_of IS NOT NULL THEN RAISE EXCEPTION '冲销流水不能再次冲销' USING ERRCODE='22023'; END IF;
   job_type:=cost.job_type; job_id:=cost.job_id; model_version:=cost.model_version; provider:=cost.provider;
   provider_task:=cost.provider_task_id; money:=-cost.amount_minor; currency:=cost.currency;
  ELSE
   money:=(p_payload->>'amount_minor')::bigint; currency:=p_payload->>'currency';
   IF money IS NULL OR money NOT BETWEEN 0 AND 1000000000 OR currency IS NULL OR currency NOT IN ('CNY','USD','EUR') THEN
    RAISE EXCEPTION '现金成本金额或币种非法' USING ERRCODE='22023'; END IF;
  END IF;
  INSERT INTO supplier_cost_entries(user_id,job_type,job_id,model_version,provider,provider_task_id,currency,amount_minor,
   statement_ref,line_ref,evidence_sha256,reversal_of,recorded_by)
  VALUES(scope,job_type,job_id,model_version,provider,provider_task,currency,money,p_payload->>'statement_ref',
   p_payload->>'line_ref',p_payload->>'evidence_sha256',CASE WHEN p_action='cost_reverse' THEN cost.id END,p_actor)
  RETURNING * INTO cost;
  result:=to_jsonb(cost); rid:=cost.id; table_name:='supplier_cost_entries';
 END IF;
 INSERT INTO operator_mutations(request_key,actor_id,action,payload,result) VALUES(p_key,p_actor,p_action,p_payload,result);
 INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
 VALUES(p_actor,'operator_'||p_action,table_name,rid,jsonb_build_object('result',result,'reason',note,'request_key',p_key));
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION manage_team(uuid,text,jsonb),operator_mutate(uuid,uuid,text,jsonb),
 operator_list(uuid,text,int,uuid,text),support_read(uuid,uuid,int),tenant_read(uuid,uuid,int),supplier_cost_report(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION manage_team(uuid,text,jsonb),operator_mutate(uuid,uuid,text,jsonb),
 operator_list(uuid,text,int,uuid,text),support_read(uuid,uuid,int),tenant_read(uuid,uuid,int),supplier_cost_report(uuid,uuid) TO service_role;
COMMIT;
