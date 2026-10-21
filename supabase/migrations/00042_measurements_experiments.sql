BEGIN;
INSERT INTO credit_costs(action,cost,description) VALUES
  ('generate_ab_variants',5,'结构化实验变体创作'),('extract_url_selling_points',2,'网页正文读取及商品卖点提取')
ON CONFLICT(action) DO NOTHING;
UPDATE credit_costs SET description='依据创意背景和真实观测生成内容建议' WHERE action='analyze_traffic';
-- 数据商密钥只允许业务API读取；原始用户标识不进入实验表。
CREATE TABLE public.measurement_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  authorization_reference text NOT NULL CHECK(length(authorization_reference) BETWEEN 10 AND 1000),
  key_ciphertext text NOT NULL,
  key_digest text NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.measurement_receipts (
  source_id uuid NOT NULL REFERENCES measurement_sources(id),
  request_key uuid NOT NULL,
  body_hash text NOT NULL CHECK(body_hash ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id,request_key)
);
CREATE TABLE public.delivery_measurements (
  source_id uuid NOT NULL REFERENCES measurement_sources(id),
  dataset_key text NOT NULL CHECK(length(dataset_key) BETWEEN 1 AND 200),
  business_date date NOT NULL,
  project_id uuid NOT NULL REFERENCES video_projects(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  revision bigint NOT NULL CHECK(revision>0),
  currency text NOT NULL CHECK(currency IN ('CNY','USD','EUR','GBP','SGD','HKD','AUD','CAD')),
  impressions bigint CHECK(impressions BETWEEN 0 AND 9007199254740991),
  clicks bigint CHECK(clicks BETWEEN 0 AND 9007199254740991),
  conversions bigint CHECK(conversions BETWEEN 0 AND 9007199254740991),
  spend_minor bigint CHECK(spend_minor BETWEEN 0 AND 9007199254740991),
  gmv_minor bigint CHECK(gmv_minor BETWEEN 0 AND 9007199254740991),
  refunds_minor bigint CHECK(refunds_minor BETWEEN 0 AND 9007199254740991),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id,dataset_key,business_date),
  CHECK(clicks IS NULL OR impressions IS NULL OR clicks<=impressions),
  CHECK(conversions IS NULL OR clicks IS NULL OR conversions<=clicks),
  CHECK(refunds_minor IS NULL OR gmv_minor IS NULL OR refunds_minor<=gmv_minor)
);
CREATE INDEX delivery_measurement_user_date ON delivery_measurements(user_id,business_date,project_id);
CREATE TABLE public.content_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  request_key uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES measurement_sources(id),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 150),
  primary_metric text NOT NULL CHECK(primary_metric IN ('ctr','conversion_per_exposure')),
  planned_sample integer NOT NULL CHECK(planned_sample BETWEEN 100 AND 1000000),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','running','closed')),
  starts_at timestamptz,
  ends_at timestamptz NOT NULL,
  closed_at timestamptz,
  specification jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_key)
);
CREATE TABLE public.content_experiment_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES content_experiments(id),
  project_id uuid NOT NULL REFERENCES video_projects(id),
  label text NOT NULL CHECK(label ~ '^[A-H]$'),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 150),
  UNIQUE(experiment_id,label),
  UNIQUE(experiment_id,id)
);
CREATE TABLE public.content_experiment_units (
  experiment_id uuid NOT NULL REFERENCES content_experiments(id),
  unit_hash text NOT NULL CHECK(unit_hash ~ '^[0-9a-f]{64}$'),
  variant_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  exposed_at timestamptz,
  clicked_at timestamptz,
  converted_at timestamptz,
  PRIMARY KEY(experiment_id,unit_hash),
  FOREIGN KEY(experiment_id,variant_id) REFERENCES content_experiment_variants(experiment_id,id),
  CHECK(clicked_at IS NULL OR exposed_at IS NOT NULL AND clicked_at>=exposed_at),
  CHECK(converted_at IS NULL OR clicked_at IS NOT NULL AND converted_at>=clicked_at)
);
CREATE INDEX experiment_variant_units ON content_experiment_units(experiment_id,variant_id);
CREATE INDEX measurement_video_user ON platform_video_metrics(user_id,publish_task_id);
CREATE INDEX measurement_publish_user_date ON publish_tasks(user_id,published_at);
CREATE INDEX measurement_project_user_date ON video_projects(user_id,created_at);
ALTER TABLE measurement_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_experiment_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_experiment_units ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON measurement_sources,measurement_receipts,delivery_measurements,content_experiments,
  content_experiment_variants,content_experiment_units FROM PUBLIC,anon,authenticated;
GRANT ALL ON measurement_sources,measurement_receipts,delivery_measurements,content_experiments,
  content_experiment_variants,content_experiment_units TO service_role;
-- 旧变体保留为历史草稿，不再允许客户端伪造计数或分两次标记获胜。
REVOKE INSERT,UPDATE,DELETE ON ab_test_variants FROM anon,authenticated;

CREATE FUNCTION public.manage_measurement_source(p_actor uuid,p_user uuid,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_source measurement_sources%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND raw_app_meta_data->>'role'='admin') THEN
    RAISE EXCEPTION '仅平台管理员可登记授权数据源';
  END IF;
  IF p_data->>'action'='create' THEN
    PERFORM 1 FROM auth.users WHERE id=p_user FOR UPDATE;
    SELECT * INTO v_source FROM measurement_sources WHERE id=(p_data->>'id')::uuid;
    IF FOUND THEN
      IF v_source.user_id<>p_user OR v_source.name IS DISTINCT FROM p_data->>'name'
        OR v_source.authorization_reference IS DISTINCT FROM p_data->>'authorization_reference'
        OR v_source.key_digest IS DISTINCT FROM p_data->>'key_digest' THEN RAISE EXCEPTION '同一请求不能登记不同数据源'; END IF;
      RETURN to_jsonb(v_source)-'key_ciphertext'-'key_digest';
    END IF;
    IF (SELECT count(*) FROM measurement_sources WHERE user_id=p_user AND enabled)>=20 THEN RAISE EXCEPTION '最多20个启用数据源'; END IF;
    IF length(p_data->>'key_ciphertext')<10 THEN RAISE EXCEPTION '缺少数据签名密钥'; END IF;
    INSERT INTO measurement_sources(id,user_id,name,authorization_reference,key_ciphertext,key_digest,created_by)
    VALUES((p_data->>'id')::uuid,p_user,p_data->>'name',p_data->>'authorization_reference',p_data->>'key_ciphertext',p_data->>'key_digest',p_actor)
    RETURNING * INTO v_source;
  ELSIF p_data->>'action'='disable' THEN
    UPDATE measurement_sources SET enabled=false WHERE id=(p_data->>'id')::uuid AND user_id=p_user RETURNING * INTO STRICT v_source;
  ELSE RAISE EXCEPTION '数据源操作不支持'; END IF;
  INSERT INTO audit_logs(user_id,action,table_name,record_id,new_data)
  VALUES(p_actor,'measurement_source_'||(p_data->>'action'),'measurement_sources',v_source.id,
    jsonb_build_object('user_id',p_user,'name',v_source.name,'enabled',v_source.enabled));
  RETURN to_jsonb(v_source)-'key_ciphertext'-'key_digest';
END;
$$;

CREATE FUNCTION public.manage_content_experiment(p_user uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_exp content_experiments%ROWTYPE; v_item jsonb; v_index integer:=0; v_source uuid;
BEGIN
  PERFORM 1 FROM auth.users WHERE id=p_user FOR UPDATE;
  IF p_action='create' THEN
    SELECT * INTO v_exp FROM content_experiments WHERE user_id=p_user AND request_key=(p_data->>'request_key')::uuid;
    IF FOUND THEN
      IF v_exp.specification IS DISTINCT FROM p_data THEN RAISE EXCEPTION '同一请求不能创建不同实验'; END IF;
      RETURN to_jsonb(v_exp);
    END IF;
    IF (SELECT count(*) FROM content_experiments WHERE user_id=p_user AND status<>'closed')>=10 THEN RAISE EXCEPTION '最多10个未结案实验'; END IF;
    v_source:=(p_data->>'source_id')::uuid;
    PERFORM 1 FROM measurement_sources WHERE id=v_source AND user_id=p_user AND enabled;
    IF NOT FOUND THEN RAISE EXCEPTION '授权数据源不可用'; END IF;
    IF jsonb_typeof(p_data->'variants') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'variants') NOT BETWEEN 2 AND 8
      OR (p_data->>'ends_at')::timestamptz NOT BETWEEN now()+interval '1 hour' AND now()+interval '90 days' THEN
      RAISE EXCEPTION '实验需要2到8个变体和有效结束时间';
    END IF;
    INSERT INTO content_experiments(user_id,request_key,source_id,title,primary_metric,planned_sample,ends_at,specification)
    VALUES(p_user,(p_data->>'request_key')::uuid,v_source,p_data->>'title',p_data->>'primary_metric',
      (p_data->>'planned_sample')::integer,(p_data->>'ends_at')::timestamptz,p_data) RETURNING * INTO v_exp;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_data->'variants') LOOP
      PERFORM 1 FROM video_projects WHERE id=(v_item->>'project_id')::uuid AND user_id=p_user AND status='completed';
      IF NOT FOUND THEN RAISE EXCEPTION '变体作品未完成或不属于当前用户'; END IF;
      INSERT INTO content_experiment_variants(experiment_id,project_id,label,title)
      VALUES(v_exp.id,(v_item->>'project_id')::uuid,chr(65+v_index),v_item->>'title');
      v_index:=v_index+1;
    END LOOP;
  ELSE
    SELECT * INTO STRICT v_exp FROM content_experiments WHERE id=(p_data->>'id')::uuid AND user_id=p_user FOR UPDATE;
    IF p_action='start' AND v_exp.status='draft' THEN
      IF v_exp.ends_at<=now()+interval '1 hour' OR NOT EXISTS(SELECT 1 FROM measurement_sources WHERE id=v_exp.source_id AND enabled) THEN
        RAISE EXCEPTION '实验窗口或授权数据源已失效';
      END IF;
      UPDATE content_experiments SET status='running',starts_at=now() WHERE id=v_exp.id RETURNING * INTO v_exp;
    ELSIF p_action='close' AND v_exp.status IN ('draft','running') THEN
      IF v_exp.status='running' AND now()<v_exp.ends_at+interval '24 hours' THEN RAISE EXCEPTION '实验需等待窗口结束及24小时回流'; END IF;
      UPDATE content_experiments SET status='closed',closed_at=now() WHERE id=v_exp.id RETURNING * INTO v_exp;
    ELSIF NOT (p_action='start' AND v_exp.status='running' OR p_action='close' AND v_exp.status='closed') THEN
      RAISE EXCEPTION '实验状态不支持此操作';
    END IF;
  END IF;
  RETURN to_jsonb(v_exp);
END;
$$;

-- 仅签名校验后的Edge函数调用。一个回执内的数据与响应一起提交，响应丢失可重放。
CREATE FUNCTION public.ingest_measurement(p_source uuid,p_key uuid,p_hash text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_source measurement_sources%ROWTYPE; v_receipt measurement_receipts%ROWTYPE;
  v_exp content_experiments%ROWTYPE; v_unit content_experiment_units%ROWTYPE; v_variant content_experiment_variants%ROWTYPE;
  v_prior delivery_measurements%ROWTYPE; v_item jsonb; v_result jsonb; v_at timestamptz; v_day date; v_project uuid;
BEGIN
  SELECT * INTO STRICT v_source FROM measurement_sources WHERE id=p_source AND enabled FOR UPDATE;
  SELECT * INTO v_receipt FROM measurement_receipts WHERE source_id=p_source AND request_key=p_key;
  IF FOUND THEN
    IF v_receipt.body_hash<>p_hash THEN RAISE EXCEPTION '同一请求的正文已变化'; END IF;
    RETURN v_receipt.response;
  END IF;
  IF p_data->>'action'='daily' THEN
    IF jsonb_typeof(p_data->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'rows') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '数据批次大小不正确'; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_data->'rows') LOOP
      v_project:=(v_item->>'project_id')::uuid; v_day:=(v_item->>'business_date')::date; v_at:=(v_item->>'observed_at')::timestamptz;
      IF v_day IS NULL OR v_at IS NULL OR v_day>current_date OR v_day<current_date-365
        OR v_at>now()+interval '5 minutes' OR v_at<now()-interval '366 days' THEN RAISE EXCEPTION '数据观测时间不正确'; END IF;
      PERFORM 1 FROM video_projects WHERE id=v_project AND user_id=v_source.user_id;
      IF NOT FOUND THEN RAISE EXCEPTION '数据作品不属于授权账户'; END IF;
      SELECT * INTO v_prior FROM delivery_measurements WHERE source_id=p_source AND dataset_key=v_item->>'dataset_key' AND business_date=v_day;
      IF FOUND AND (v_prior.project_id<>v_project OR v_prior.currency IS DISTINCT FROM v_item->>'currency'
        OR v_prior.revision>=(v_item->>'revision')::bigint OR v_prior.observed_at>v_at) THEN RAISE EXCEPTION '数据版本过期或归属变化'; END IF;
      INSERT INTO delivery_measurements(source_id,dataset_key,business_date,project_id,user_id,revision,currency,
        impressions,clicks,conversions,spend_minor,gmv_minor,refunds_minor,observed_at)
      VALUES(p_source,v_item->>'dataset_key',v_day,v_project,v_source.user_id,(v_item->>'revision')::bigint,v_item->>'currency',
        (v_item->>'impressions')::bigint,(v_item->>'clicks')::bigint,(v_item->>'conversions')::bigint,
        (v_item->>'spend_minor')::bigint,(v_item->>'gmv_minor')::bigint,(v_item->>'refunds_minor')::bigint,v_at)
      ON CONFLICT(source_id,dataset_key,business_date) DO UPDATE SET revision=EXCLUDED.revision,
        impressions=EXCLUDED.impressions,clicks=EXCLUDED.clicks,conversions=EXCLUDED.conversions,spend_minor=EXCLUDED.spend_minor,
        gmv_minor=EXCLUDED.gmv_minor,refunds_minor=EXCLUDED.refunds_minor,observed_at=EXCLUDED.observed_at,received_at=now();
    END LOOP;
    v_result:=jsonb_build_object('accepted',jsonb_array_length(p_data->'rows'));
  ELSIF p_data->>'action' IN ('assign','events') THEN
    SELECT * INTO STRICT v_exp FROM content_experiments WHERE id=(p_data->>'experiment_id')::uuid
      AND source_id=p_source AND user_id=v_source.user_id AND status='running' FOR UPDATE;
    IF p_data->>'action'='assign' THEN
      IF now()>v_exp.ends_at THEN RAISE EXCEPTION '实验分组窗口已结束'; END IF;
      SELECT * INTO v_unit FROM content_experiment_units WHERE experiment_id=v_exp.id AND unit_hash=p_data->>'unit_hash';
      IF NOT FOUND THEN
        -- 唯一允许的随机数用途：服务器真实等比例分组。分组写入后重放永不重抽。
        SELECT * INTO STRICT v_variant FROM content_experiment_variants WHERE experiment_id=v_exp.id ORDER BY label
          OFFSET floor(random()*(SELECT count(*) FROM content_experiment_variants WHERE experiment_id=v_exp.id)) LIMIT 1;
        INSERT INTO content_experiment_units(experiment_id,unit_hash,variant_id)
        VALUES(v_exp.id,p_data->>'unit_hash',v_variant.id) RETURNING * INTO v_unit;
      END IF;
      SELECT * INTO STRICT v_variant FROM content_experiment_variants WHERE id=v_unit.variant_id;
      v_result:=jsonb_build_object('variant_id',v_variant.id,'label',v_variant.label,'project_id',v_variant.project_id);
    ELSE
      IF now()>v_exp.ends_at+interval '24 hours' OR jsonb_typeof(p_data->'events') IS DISTINCT FROM 'array'
        OR jsonb_array_length(p_data->'events') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '事件批次或回流窗口不正确'; END IF;
      FOR v_item IN SELECT value FROM jsonb_array_elements(p_data->'events') LOOP
        SELECT * INTO STRICT v_unit FROM content_experiment_units WHERE experiment_id=v_exp.id AND unit_hash=v_item->>'unit_hash' FOR UPDATE;
        v_at:=(v_item->>'occurred_at')::timestamptz;
        IF v_at IS NULL OR v_at<v_unit.assigned_at OR v_at>v_exp.ends_at OR v_at>now()+interval '5 minutes' THEN RAISE EXCEPTION '事件不在实验窗口'; END IF;
        IF v_item->>'type'='exposure' THEN
          UPDATE content_experiment_units SET exposed_at=COALESCE(exposed_at,v_at) WHERE experiment_id=v_exp.id AND unit_hash=v_unit.unit_hash;
        ELSIF v_item->>'type'='click' AND v_unit.exposed_at IS NOT NULL AND v_at>=v_unit.exposed_at THEN
          UPDATE content_experiment_units SET clicked_at=COALESCE(clicked_at,v_at) WHERE experiment_id=v_exp.id AND unit_hash=v_unit.unit_hash;
        ELSIF v_item->>'type'='conversion' AND v_unit.clicked_at IS NOT NULL AND v_at>=v_unit.clicked_at THEN
          UPDATE content_experiment_units SET converted_at=COALESCE(converted_at,v_at) WHERE experiment_id=v_exp.id AND unit_hash=v_unit.unit_hash;
        ELSE RAISE EXCEPTION '事件类型或曝光点击顺序不正确'; END IF;
      END LOOP;
      v_result:=jsonb_build_object('accepted',jsonb_array_length(p_data->'events'));
    END IF;
  ELSE RAISE EXCEPTION '采集操作不支持'; END IF;
  INSERT INTO measurement_receipts(source_id,request_key,body_hash,response) VALUES(p_source,p_key,p_hash,v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.read_content_experiments(p_user uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(e)-'specification'||jsonb_build_object('variants',
    (SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('assigned',c.assigned,'impressions',c.impressions,'clicks',c.clicks,'conversions',c.conversions) ORDER BY v.label)
     FROM content_experiment_variants v CROSS JOIN LATERAL
       (SELECT count(*) assigned,count(exposed_at) impressions,count(clicked_at) clicks,count(converted_at) conversions
        FROM content_experiment_units u WHERE u.experiment_id=e.id AND u.variant_id=v.id) c WHERE v.experiment_id=e.id))
    ORDER BY e.created_at DESC),'[]') FROM (SELECT * FROM content_experiments WHERE user_id=p_user ORDER BY created_at DESC LIMIT 100) e;
$$;

-- 自然视频只取每个账号/视频最后快照；历史快照不能累加为播放量。
CREATE FUNCTION public.read_measurement_report(p_user uuid,p_since timestamptz,p_project uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  WITH project_scope AS (
    SELECT * FROM video_projects WHERE user_id=p_user AND created_at>=p_since AND (p_project IS NULL OR id=p_project)
  ), natural_scope AS (
    SELECT DISTINCT ON(t.platform,t.connection_id,m.video_id) m.id,m.publish_task_id,t.project_id,t.title,t.connection_id,m.platform,m.video_id,
      m.view_count,m.like_count,m.comment_count,m.share_count,m.collected_at,t.published_at
    FROM platform_video_metrics m JOIN publish_tasks t ON t.id=m.publish_task_id
    WHERE m.user_id=p_user AND t.user_id=p_user AND (p_project IS NULL OR t.project_id=p_project)
      AND t.published_at>=p_since ORDER BY t.platform,t.connection_id,m.video_id,m.collected_at DESC
  )
  SELECT jsonb_build_object(
    'project_count',(SELECT count(*) FROM project_scope),
    'completed_count',(SELECT count(*) FROM project_scope WHERE status='completed'),
    'projects',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM
      (SELECT id,title,status,video_style,duration,created_at FROM project_scope ORDER BY created_at DESC LIMIT 100) p),'[]'),
    'style_distribution',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM
      (SELECT COALESCE(video_style,'未标注') name,count(*) count FROM project_scope GROUP BY 1 ORDER BY count(*) DESC LIMIT 50) s),'[]'),
    'duration_distribution',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM
      (SELECT CASE WHEN duration IS NULL THEN '未记录' WHEN duration<=15 THEN '≤15秒' WHEN duration<=30 THEN '15–30秒'
       WHEN duration<=60 THEN '30–60秒' ELSE '>60秒' END name,count(*) count FROM project_scope GROUP BY 1) s),'[]'),
    'creation_trend',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day) FROM
      (SELECT series.day::date AS day,count(p.id) created,count(p.id) FILTER(WHERE p.status='completed') completed
       FROM generate_series((p_since AT TIME ZONE 'UTC')::date::timestamp,(now() AT TIME ZONE 'UTC')::date::timestamp,interval '1 day') series(day)
       LEFT JOIN project_scope p ON (p.created_at AT TIME ZONE 'UTC')::date=series.day::date GROUP BY 1) d),'[]'),
    'natural_count',(SELECT count(*) FROM natural_scope),
    'natural_totals',(SELECT jsonb_object_agg(field,jsonb_build_object('value',value,'observed',observed,'total',(SELECT count(*) FROM natural_scope)))
      FROM (SELECT 'view_count' field,sum(view_count) value,count(view_count) observed FROM natural_scope
        UNION ALL SELECT 'like_count',sum(like_count),count(like_count) FROM natural_scope
        UNION ALL SELECT 'comment_count',sum(comment_count),count(comment_count) FROM natural_scope
        UNION ALL SELECT 'share_count',sum(share_count),count(share_count) FROM natural_scope) totals),
    'natural',COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM
      (SELECT * FROM natural_scope ORDER BY collected_at DESC LIMIT 500) m),'[]'),
    'delivery',COALESCE((SELECT jsonb_agg(to_jsonb(g)) FROM
      (SELECT d.source_id,s.name source_name,d.currency,count(*) buckets,
        CASE WHEN count(d.impressions)=count(*) THEN sum(d.impressions) END impressions,
        CASE WHEN count(d.clicks)=count(*) THEN sum(d.clicks) END clicks,
        CASE WHEN count(d.conversions)=count(*) THEN sum(d.conversions) END conversions,
        CASE WHEN count(d.spend_minor)=count(*) THEN sum(d.spend_minor) END spend_minor,
        CASE WHEN count(d.gmv_minor)=count(*) THEN sum(d.gmv_minor) END gmv_minor,
        CASE WHEN count(d.refunds_minor)=count(*) THEN sum(d.refunds_minor) END refunds_minor,
        min(d.business_date) since,max(d.business_date) until,max(d.received_at) received_at
       FROM delivery_measurements d JOIN measurement_sources s ON s.id=d.source_id WHERE d.user_id=p_user AND d.business_date>=(p_since AT TIME ZONE 'UTC')::date
       AND (p_project IS NULL OR d.project_id=p_project) GROUP BY d.source_id,s.name,d.currency) g),'[]'),
    'sync_issues',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'title',title,'platform',platform,'error',metrics_error))
      FROM (SELECT * FROM publish_tasks WHERE user_id=p_user AND metrics_error IS NOT NULL AND (p_project IS NULL OR project_id=p_project)
      AND published_at>=p_since ORDER BY published_at DESC LIMIT 100) issues),'[]'),
    'generated_at',now()
  );
$$;
REVOKE ALL ON FUNCTION manage_measurement_source(uuid,uuid,jsonb),manage_content_experiment(uuid,text,jsonb),
  ingest_measurement(uuid,uuid,text,jsonb),read_content_experiments(uuid),read_measurement_report(uuid,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION manage_measurement_source(uuid,uuid,jsonb),manage_content_experiment(uuid,text,jsonb),
  ingest_measurement(uuid,uuid,text,jsonb),read_content_experiments(uuid),read_measurement_report(uuid,timestamptz,uuid) TO service_role;
COMMIT;
