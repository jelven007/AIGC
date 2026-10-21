BEGIN;
INSERT INTO model_slot_catalog(slot) VALUES ('intelligence.youtube'),('intelligence.ebay'),('intelligence.licensed');
ALTER TABLE production_jobs DROP CONSTRAINT production_jobs_kind_check;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_kind_check CHECK(kind IN
 ('image','render','publish','metrics','tts','asr','voice_clone','avatar','lipsync','analysis','knowledge_index','knowledge_search',
 'intelligence_competitor','intelligence_products'));
INSERT INTO credit_costs(action,cost,description) VALUES
 ('generate_intelligence_competitor',2,'授权竞品统计：每次最多20条近期视频'),
 ('generate_intelligence_products',2,'授权商品搜索：每次最多20条商品')
 ON CONFLICT(action) DO NOTHING;
-- 旧表可能存有演示快照，不能作为正式采集证据；保留历史，只读。
REVOKE ALL ON competitor_accounts,competitor_snapshots FROM PUBLIC,anon,authenticated;
GRANT SELECT ON competitor_accounts,competitor_snapshots TO authenticated;
CREATE TABLE intelligence_targets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_key uuid NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN ('intelligence_competitor','intelligence_products')),
 source_slot text NOT NULL REFERENCES model_slot_catalog(slot),
 params jsonb NOT NULL CHECK(jsonb_typeof(params)='object'),
 monitoring boolean NOT NULL DEFAULT false, remaining_runs int NOT NULL DEFAULT 0 CHECK(remaining_runs BETWEEN 0 AND 30),
 remaining_budget int NOT NULL DEFAULT 0 CHECK(remaining_budget>=0),
 confirmed_cost int, schedule_version uuid REFERENCES model_config_versions(id),
 next_run_at timestamptz, last_collected_at timestamptz, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_key)
);
CREATE INDEX intelligence_targets_due ON intelligence_targets(next_run_at) WHERE monitoring;
CREATE TABLE intelligence_schedule_receipts (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, request_key uuid NOT NULL,
 target_id uuid NOT NULL REFERENCES intelligence_targets(id) ON DELETE CASCADE,
 request jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,request_key)
);
REVOKE ALL ON intelligence_schedule_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON intelligence_schedule_receipts TO service_role;
CREATE TABLE intelligence_samples (
 job_id uuid PRIMARY KEY REFERENCES production_jobs(id),
 target_id uuid NOT NULL REFERENCES intelligence_targets(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND octet_length(data::text)<=200000),
 collected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX intelligence_samples_target ON intelligence_samples(target_id,collected_at DESC);
CREATE INDEX intelligence_samples_retention ON intelligence_samples(collected_at);
CREATE INDEX intelligence_jobs_retention ON production_jobs(completed_at)
 WHERE kind IN ('intelligence_competitor','intelligence_products') AND status IN ('completed','failed');
CREATE TABLE product_intelligence_links (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 sample_id uuid NOT NULL REFERENCES intelligence_samples(job_id) ON DELETE CASCADE,
 item_id text NOT NULL,
 product_id uuid REFERENCES products(id) ON DELETE SET NULL,
 PRIMARY KEY(user_id,sample_id,item_id)
);
ALTER TABLE intelligence_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_intelligence_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY intelligence_targets_own ON intelligence_targets FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY intelligence_samples_own ON intelligence_samples FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY product_intelligence_links_own ON product_intelligence_links FOR SELECT TO authenticated USING(user_id=auth.uid());
REVOKE ALL ON intelligence_targets,intelligence_samples,product_intelligence_links FROM PUBLIC,anon,authenticated;
GRANT SELECT ON intelligence_targets,intelligence_samples,product_intelligence_links TO authenticated;
GRANT ALL ON intelligence_targets,intelligence_samples,product_intelligence_links TO service_role;

CREATE FUNCTION save_intelligence_target(p_user uuid,p_key uuid,p_name text,p_kind text,p_slot text,p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_target intelligence_targets%ROWTYPE;
BEGIN
 IF p_key IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 200 OR jsonb_typeof(p_params) IS DISTINCT FROM 'object'
   OR p_kind IS NULL OR p_kind NOT IN ('intelligence_competitor','intelligence_products')
   OR p_slot IS NULL OR NOT(p_slot='intelligence.licensed' OR p_slot='intelligence.youtube' AND p_kind='intelligence_competitor'
      OR p_slot='intelligence.ebay' AND p_kind='intelligence_products') THEN RAISE EXCEPTION '情报对象参数非法'; END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
 SELECT * INTO v_target FROM intelligence_targets WHERE user_id=p_user AND request_key=p_key;
 IF FOUND THEN
   IF v_target.params IS DISTINCT FROM p_params OR v_target.source_slot IS DISTINCT FROM p_slot
      OR v_target.kind IS DISTINCT FROM p_kind OR v_target.name IS DISTINCT FROM trim(p_name) THEN
     RAISE EXCEPTION '同一请求标识不能保存不同对象';
   END IF;
   RETURN to_jsonb(v_target);
 END IF;
 IF (SELECT count(*) FROM intelligence_targets WHERE user_id=p_user)>=50 THEN RAISE EXCEPTION '情报对象最多50个'; END IF;
 INSERT INTO intelligence_targets(user_id,request_key,name,kind,source_slot,params)
 VALUES(p_user,p_key,trim(p_name),p_kind,p_slot,p_params) RETURNING * INTO v_target;
 RETURN to_jsonb(v_target);
END;
$$;
CREATE FUNCTION schedule_intelligence_target(p_user uuid,p_target uuid,p_key uuid,p_runs int,p_budget int,p_cost int,p_version uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_target intelligence_targets%ROWTYPE; v_cost int; v_prior intelligence_schedule_receipts%ROWTYPE;
BEGIN
 PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
 SELECT * INTO STRICT v_target FROM intelligence_targets WHERE id=p_target AND user_id=p_user FOR UPDATE;
 IF p_key IS NULL OR p_runs IS NULL OR p_runs NOT BETWEEN 0 AND 30 OR p_budget IS NULL OR p_budget<0 THEN RAISE EXCEPTION '监控次数与预算非法'; END IF;
 IF p_runs=0 AND p_budget<>0 THEN RAISE EXCEPTION '停止监控的预算应为0'; END IF;
 SELECT * INTO v_prior FROM intelligence_schedule_receipts WHERE user_id=p_user AND request_key=p_key;
 IF FOUND THEN
   IF v_prior.target_id IS DISTINCT FROM p_target OR v_prior.request IS DISTINCT FROM jsonb_build_object('runs',p_runs,'budget',p_budget,'cost',p_cost) THEN
     RAISE EXCEPTION '同一请求标识不能用于不同监控计划';
   END IF;
   RETURN to_jsonb(v_target);
 END IF;
 IF p_runs>0 THEN
   SELECT cost INTO v_cost FROM credit_costs WHERE action='generate_'||v_target.kind;
   IF v_cost IS NULL OR v_cost<0 OR p_cost IS DISTINCT FROM v_cost OR p_budget<>p_runs*v_cost THEN
     RAISE EXCEPTION '监控价格或预算已更新，请重新确认';
   END IF;
   PERFORM 1 FROM model_configs WHERE slot=v_target.source_slot AND enabled AND current_version_id=p_version FOR SHARE;
   IF NOT FOUND OR p_version IS NULL THEN RAISE EXCEPTION '数据源配置已更新或未启用'; END IF;
 END IF;
 UPDATE intelligence_targets SET monitoring=p_runs>0,remaining_runs=p_runs,remaining_budget=p_budget,
   confirmed_cost=p_cost,schedule_version=p_version,next_run_at=CASE WHEN p_runs>0 THEN now() ELSE NULL END,
   last_error=NULL WHERE id=p_target RETURNING * INTO v_target;
 INSERT INTO intelligence_schedule_receipts(user_id,request_key,target_id,request)
   VALUES(p_user,p_key,p_target,jsonb_build_object('runs',p_runs,'budget',p_budget,'cost',p_cost));
 RETURN to_jsonb(v_target);
END;
$$;
CREATE FUNCTION create_intelligence_job(p_user uuid,p_key uuid,p_target uuid,p_cost int,p_version uuid,p_scheduled boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_target intelligence_targets%ROWTYPE; v_job production_jobs%ROWTYPE; v_cost int; v_charge jsonb; v_request jsonb;
BEGIN
 IF p_key IS NULL OR p_target IS NULL OR p_cost IS NULL OR p_cost<0 THEN RAISE EXCEPTION '情报请求参数非法'; END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
 v_request:=jsonb_build_object('target_id',p_target,'confirmed_credit_cost',p_cost);
 SELECT * INTO v_job FROM production_jobs WHERE user_id=p_user AND request_key=p_key;
 IF FOUND THEN
   IF v_job.kind NOT IN ('intelligence_competitor','intelligence_products') OR v_job.payload->'request' IS DISTINCT FROM v_request THEN
     RAISE EXCEPTION '同一请求标识不能用于不同任务';
   END IF;
   RETURN to_jsonb(v_job);
 END IF;
 SELECT * INTO STRICT v_target FROM intelligence_targets WHERE id=p_target AND user_id=p_user FOR UPDATE;
 IF p_scheduled AND (NOT v_target.monitoring OR v_target.remaining_runs<=0 OR v_target.next_run_at>now()) THEN RETURN NULL; END IF;
 SELECT cost INTO v_cost FROM credit_costs WHERE action='generate_'||v_target.kind;
 IF v_cost IS NULL OR v_cost<0 OR v_cost IS DISTINCT FROM p_cost THEN RAISE EXCEPTION '情报价格已更新，请重新确认'; END IF;
 IF p_scheduled AND (v_target.confirmed_cost IS DISTINCT FROM v_cost OR v_target.schedule_version IS DISTINCT FROM p_version
    OR v_target.remaining_budget<v_cost) THEN RAISE EXCEPTION '监控预算或配置版本不匹配'; END IF;
 IF EXISTS(SELECT 1 FROM production_jobs WHERE user_id=p_user AND payload->'request'->>'target_id'=p_target::text
    AND kind=v_target.kind AND status IN ('pending','running','unknown')) THEN
   IF p_scheduled THEN RETURN NULL; END IF;
   RAISE EXCEPTION '此对象已有采集任务';
 END IF;
 IF (SELECT count(*) FROM production_jobs WHERE user_id=p_user AND kind IN ('intelligence_competitor','intelligence_products')
    AND status IN ('pending','running','unknown'))>=4 THEN RAISE EXCEPTION '情报队列已满'; END IF;
 PERFORM 1 FROM model_configs WHERE slot=v_target.source_slot AND enabled AND current_version_id=p_version FOR SHARE;
 IF NOT FOUND OR p_version IS NULL THEN RAISE EXCEPTION '数据源配置已更新或未启用'; END IF;
 IF v_cost>0 THEN v_charge:=deduct_credits(p_user,v_cost,'generate_'||v_target.kind); END IF;
 INSERT INTO production_jobs(user_id,request_key,kind,payload,model_config_version_id,charge_id,credit_cost)
 VALUES(p_user,p_key,v_target.kind,jsonb_build_object('request',v_request,'source_slot',v_target.source_slot,'params',v_target.params),
   p_version,(v_charge->>'charge_id')::uuid,v_cost) RETURNING * INTO v_job;
 IF p_scheduled THEN UPDATE intelligence_targets SET remaining_runs=remaining_runs-1,remaining_budget=remaining_budget-v_cost,
   monitoring=remaining_runs>1,next_run_at=now()+interval '24 hours' WHERE id=p_target; END IF;
 RETURN to_jsonb(v_job);
END;
$$;
CREATE FUNCTION enqueue_intelligence_schedule() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_target intelligence_targets%ROWTYPE; v_job jsonb; v_count int:=0; v_error text;
BEGIN
 FOR v_target IN SELECT t.* FROM intelligence_targets t WHERE monitoring AND next_run_at<=now()
   AND NOT EXISTS(SELECT 1 FROM production_jobs j WHERE j.user_id=t.user_id AND j.kind=t.kind
      AND j.payload->'request'->>'target_id'=t.id::text AND j.status IN ('pending','running','unknown'))
   ORDER BY next_run_at LIMIT 10 LOOP
   BEGIN
     v_job:=create_intelligence_job(v_target.user_id,
       md5('intelligence:'||v_target.id::text||':'||v_target.next_run_at::text)::uuid,v_target.id,
       v_target.confirmed_cost,v_target.schedule_version,true);
     IF v_job IS NOT NULL THEN v_count:=v_count+1; END IF;
   EXCEPTION WHEN OTHERS THEN
     v_error:=SQLERRM;
     -- 在子事务回滚后停用计划，避免配置/余额故障每10秒重试。
     UPDATE intelligence_targets SET monitoring=CASE WHEN v_error LIKE '%队列已满%' THEN monitoring ELSE false END,
       next_run_at=CASE WHEN v_error LIKE '%队列已满%' THEN now()+interval '15 minutes' ELSE next_run_at END,
       last_error=left(v_error,200) WHERE id=v_target.id;
   END;
 END LOOP;
 RETURN v_count;
END;
$$;
CREATE FUNCTION read_intelligence_catalog(p_user uuid,p_kind text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(to_jsonb(t)||jsonb_build_object('latest',(
   SELECT jsonb_build_object('job_id',s.job_id,'data',s.data,'collected_at',s.collected_at)
   FROM intelligence_samples s WHERE s.target_id=t.id AND s.user_id=p_user ORDER BY s.collected_at DESC LIMIT 1),
   'history',(SELECT COALESCE(jsonb_agg(h ORDER BY h.collected_at),'[]') FROM (
     SELECT s.job_id,s.collected_at,s.data->'account'->'followers' AS followers FROM intelligence_samples s
     WHERE s.target_id=t.id AND s.user_id=p_user ORDER BY s.collected_at DESC LIMIT 30) h)
   ) ORDER BY t.created_at DESC),'[]') FROM intelligence_targets t WHERE t.user_id=p_user AND t.kind=p_kind;
$$;
ALTER FUNCTION update_production_job(uuid,uuid,text,jsonb) RENAME TO update_production_job_before_intelligence;
REVOKE ALL ON FUNCTION update_production_job_before_intelligence(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION update_production_job(p_job_id uuid,p_lease uuid,p_event text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_target intelligence_targets%ROWTYPE; v_result jsonb;
BEGIN
 SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id;
 IF v_job.kind NOT IN ('intelligence_competitor','intelligence_products') THEN
   RETURN update_production_job_before_intelligence(p_job_id,p_lease,p_event,p_data);
 END IF;
 PERFORM 1 FROM user_plans WHERE user_id=v_job.user_id FOR UPDATE;
 SELECT * INTO v_target FROM intelligence_targets WHERE id=(v_job.payload->'request'->>'target_id')::uuid AND user_id=v_job.user_id FOR UPDATE;
 SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id FOR UPDATE;
 IF v_job.status IN ('completed','failed') AND v_job.final_lease_token=p_lease THEN RETURN to_jsonb(v_job); END IF;
 IF p_lease IS NULL OR v_job.lease_token IS DISTINCT FROM p_lease OR v_job.status<>'running' THEN RAISE EXCEPTION '采集租约已失效'; END IF;
 IF p_event='retry' AND v_job.attempts>=3 AND v_job.evidence IS NULL AND v_job.resolution IS NULL THEN
   p_event:='failed'; p_data:=jsonb_build_object('error','数据源连续三次读取失败，请检查权限或配额');
 END IF;
 IF p_event='completed' THEN
   IF v_target.id IS NULL THEN RAISE EXCEPTION '采集对象已删除'; END IF;
   IF p_data->'source'->>'version_id' IS DISTINCT FROM v_job.model_config_version_id::text
     OR p_data->'source'->>'slot' IS DISTINCT FROM v_job.payload->>'source_slot'
     OR jsonb_typeof(p_data->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'items')>20
     OR octet_length(p_data::text)>200000 THEN RAISE EXCEPTION '采集来源或结果非法'; END IF;
   INSERT INTO intelligence_samples(job_id,target_id,user_id,data)
     VALUES(v_job.id,v_target.id,v_job.user_id,p_data) ON CONFLICT(job_id) DO NOTHING;
   UPDATE intelligence_targets SET last_collected_at=now(),last_error=NULL WHERE id=v_target.id;
 ELSIF p_event='failed' THEN
   UPDATE intelligence_targets SET monitoring=false,last_error=left(p_data->>'error',200) WHERE id=v_target.id;
 END IF;
 v_result:=update_production_job_before_intelligence(p_job_id,p_lease,p_event,p_data);
 IF p_event IN ('completed','failed') THEN
   UPDATE production_jobs SET evidence=NULL,resolution=NULL WHERE id=p_job_id;
 END IF;
 RETURN v_result;
END;
$$;
CREATE FUNCTION import_intelligence_product(p_user uuid,p_sample uuid,p_item text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item jsonb; v_product uuid;
BEGIN
 PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
 SELECT product_id INTO v_product FROM product_intelligence_links WHERE user_id=p_user AND sample_id=p_sample AND item_id=p_item;
 IF FOUND THEN
   IF v_product IS NULL THEN RAISE EXCEPTION '原商品已删除，请在商品库手动创建'; END IF;
   RETURN v_product;
 END IF;
 SELECT item INTO v_item FROM intelligence_samples s JOIN production_jobs j ON j.id=s.job_id,
   LATERAL jsonb_array_elements(s.data->'items') item
 WHERE s.job_id=p_sample AND s.user_id=p_user AND j.kind='intelligence_products' AND item->>'id'=p_item;
 IF v_item IS NULL OR length(v_item->>'title') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '商品采集来源不存在或无权访问'; END IF;
 INSERT INTO products(user_id,name,category,selling_points) VALUES(p_user,v_item->>'title','待分类','{}') RETURNING id INTO v_product;
 INSERT INTO product_intelligence_links(user_id,sample_id,item_id,product_id) VALUES(p_user,p_sample,p_item,v_product);
 RETURN v_product;
END;
$$;
CREATE FUNCTION delete_intelligence_target(p_user uuid,p_target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
 PERFORM 1 FROM intelligence_targets WHERE id=p_target AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '情报对象不存在或无权访问'; END IF;
 IF EXISTS(SELECT 1 FROM production_jobs WHERE user_id=p_user AND payload->'request'->>'target_id'=p_target::text
   AND kind IN ('intelligence_competitor','intelligence_products') AND status IN ('pending','running','unknown')) THEN
   RAISE EXCEPTION '存在活跃采集任务，暂不能删除';
 END IF;
 UPDATE production_jobs SET result='{"deleted":true}'::jsonb,evidence=NULL,resolution=NULL,payload=payload-'params'
 WHERE user_id=p_user AND payload->'request'->>'target_id'=p_target::text
   AND kind IN ('intelligence_competitor','intelligence_products') AND status IN ('completed','failed');
 DELETE FROM intelligence_targets WHERE id=p_target AND user_id=p_user;
END;
$$;
CREATE FUNCTION prune_intelligence_data() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count int;
BEGIN
 DELETE FROM intelligence_samples WHERE collected_at<now()-interval '30 days';
 GET DIAGNOSTICS v_count=ROW_COUNT;
 UPDATE production_jobs SET result=jsonb_build_object('expired',true),evidence=NULL,resolution=NULL,payload=payload-'params'
 WHERE kind IN ('intelligence_competitor','intelligence_products') AND status IN ('completed','failed')
   AND completed_at<now()-interval '30 days' AND result IS DISTINCT FROM '{"expired":true}'::jsonb;
 RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION save_intelligence_target(uuid,uuid,text,text,text,jsonb),
 schedule_intelligence_target(uuid,uuid,uuid,int,int,int,uuid),create_intelligence_job(uuid,uuid,uuid,int,uuid,boolean),
 enqueue_intelligence_schedule(),read_intelligence_catalog(uuid,text),update_production_job(uuid,uuid,text,jsonb),
 import_intelligence_product(uuid,uuid,text),delete_intelligence_target(uuid,uuid),prune_intelligence_data() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION save_intelligence_target(uuid,uuid,text,text,text,jsonb),
 schedule_intelligence_target(uuid,uuid,uuid,int,int,int,uuid),create_intelligence_job(uuid,uuid,uuid,int,uuid,boolean),
 enqueue_intelligence_schedule(),read_intelligence_catalog(uuid,text),update_production_job(uuid,uuid,text,jsonb),
 import_intelligence_product(uuid,uuid,text),delete_intelligence_target(uuid,uuid),prune_intelligence_data() TO service_role;
COMMIT;
