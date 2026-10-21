BEGIN;
ALTER TABLE products ADD COLUMN currency text DEFAULT 'CNY' CHECK(currency IS NULL OR currency ~ '^[A-Z]{3}$'),
 ADD COLUMN import_job_id uuid REFERENCES production_jobs(id),
 ADD COLUMN price numeric(10,2) GENERATED ALWAYS AS (COALESCE(sale_price,original_price)) STORED,
 ADD COLUMN source jsonb CHECK(source IS NULL OR jsonb_typeof(source)='object');
ALTER TABLE products ALTER COLUMN stock DROP NOT NULL, ALTER COLUMN stock DROP DEFAULT,
 ALTER COLUMN sales_count DROP NOT NULL, ALTER COLUMN sales_count DROP DEFAULT;
-- 旧商品继续保留已填写的数据；新商品的未知库存/销量不再被自动写成0。
REVOKE INSERT,UPDATE,DELETE ON products FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS allow_read_demo_products ON products;
CREATE TABLE product_mutation_receipts (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_key uuid NOT NULL, action text NOT NULL CHECK(action IN ('save','delete')),
 request_hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,request_key)
);
ALTER TABLE product_mutation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_mutation_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON product_mutation_receipts TO service_role;
CREATE TABLE product_import_links (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 job_id uuid NOT NULL REFERENCES production_jobs(id), product_id uuid REFERENCES products(id) ON DELETE SET NULL,
 PRIMARY KEY(user_id,job_id)
);
ALTER TABLE product_import_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_import_links FROM PUBLIC,anon,authenticated;
GRANT ALL ON product_import_links TO service_role;
CREATE UNIQUE INDEX products_import_once ON products(user_id,import_job_id) WHERE import_job_id IS NOT NULL;
ALTER TABLE production_jobs DROP CONSTRAINT production_jobs_kind_check;
ALTER TABLE production_jobs ADD CONSTRAINT production_jobs_kind_check CHECK(kind IN
 ('image','render','publish','metrics','tts','asr','voice_clone','avatar','lipsync','analysis','knowledge_index','knowledge_search',
 'intelligence_competitor','intelligence_products','product_import'));
CREATE FUNCTION guard_product_capacity() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM user_plans WHERE user_id=NEW.user_id FOR UPDATE;
 IF TG_TABLE_NAME='products' THEN
   IF (SELECT count(*) FROM products WHERE user_id=NEW.user_id)>=2000 THEN RAISE EXCEPTION '商品库最多2000个商品'; END IF;
 ELSIF NEW.kind IN ('product_import','intelligence_competitor','intelligence_products') AND
   (SELECT count(*) FROM production_jobs WHERE user_id=NEW.user_id AND kind IN
     ('product_import','intelligence_competitor','intelligence_products') AND status IN ('pending','running','unknown'))>=4 THEN
   RAISE EXCEPTION '商品与情报队列已满';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER products_capacity BEFORE INSERT ON products FOR EACH ROW EXECUTE FUNCTION guard_product_capacity();
CREATE TRIGGER production_products_capacity BEFORE INSERT ON production_jobs FOR EACH ROW
 WHEN(NEW.kind IN ('product_import','intelligence_competitor','intelligence_products')) EXECUTE FUNCTION guard_product_capacity();
CREATE FUNCTION create_product_import(p_user uuid,p_key uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE;
BEGIN
 IF p_key IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR p_input->>'mode' IS NULL
   OR p_input->>'mode' NOT IN ('url','text') OR length(p_input->>'content') NOT BETWEEN 1 AND 8000 THEN
   RAISE EXCEPTION '商品导入参数非法';
 END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
 SELECT * INTO v_job FROM production_jobs WHERE user_id=p_user AND request_key=p_key;
 IF FOUND THEN
   IF v_job.kind<>'product_import' OR v_job.payload IS DISTINCT FROM p_input THEN RAISE EXCEPTION '同一请求标识不能用于不同任务'; END IF;
   RETURN to_jsonb(v_job);
 END IF;
 IF (SELECT count(*) FROM production_jobs WHERE user_id=p_user AND kind IN
   ('product_import','intelligence_competitor','intelligence_products') AND status IN ('pending','running','unknown'))>=4 THEN
   RAISE EXCEPTION '商品与情报队列已满'; END IF;
 INSERT INTO production_jobs(user_id,request_key,kind,payload) VALUES(p_user,p_key,'product_import',p_input) RETURNING * INTO v_job;
 RETURN to_jsonb(v_job);
END;
$$;
ALTER FUNCTION update_production_job(uuid,uuid,text,jsonb) RENAME TO update_production_job_before_products;
REVOKE ALL ON FUNCTION update_production_job_before_products(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION update_production_job(p_job_id uuid,p_lease uuid,p_event text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_job production_jobs%ROWTYPE; v_result jsonb;
BEGIN
 SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id;
 IF v_job.kind<>'product_import' THEN RETURN update_production_job_before_products(p_job_id,p_lease,p_event,p_data); END IF;
 PERFORM 1 FROM user_plans WHERE user_id=v_job.user_id FOR UPDATE;
 SELECT * INTO STRICT v_job FROM production_jobs WHERE id=p_job_id FOR UPDATE;
 IF v_job.status IN ('completed','failed') AND v_job.final_lease_token=p_lease THEN RETURN to_jsonb(v_job); END IF;
 IF p_lease IS NULL OR v_job.lease_token IS DISTINCT FROM p_lease OR v_job.status<>'running' THEN RAISE EXCEPTION '商品提取租约已失效'; END IF;
 IF p_event='retry' AND v_job.attempts>=3 AND v_job.evidence IS NULL AND v_job.resolution IS NULL THEN
   p_event:='failed'; p_data:=jsonb_build_object('error','商品来源连续三次读取失败');
 END IF;
 IF p_event='completed' AND (
   p_data->'source'->>'mode' IS DISTINCT FROM v_job.payload->>'mode'
   OR COALESCE(p_data->'source'->>'content_hash','') !~ '^[a-f0-9]{64}$'
   OR length(COALESCE(p_data->'draft'->>'name','')) NOT BETWEEN 1 AND 200
   OR octet_length(p_data::text)>60000
   OR v_job.payload->>'mode'='url' AND COALESCE(p_data->'source'->>'url','') !~ '^https://'
 ) THEN RAISE EXCEPTION '商品来源或提取结果非法'; END IF;
 v_result:=update_production_job_before_products(p_job_id,p_lease,p_event,p_data);
 IF p_event IN ('completed','failed') THEN UPDATE production_jobs SET evidence=NULL,resolution=NULL WHERE id=p_job_id; END IF;
 RETURN v_result;
END;
$$;
CREATE FUNCTION mutate_products(p_user uuid,p_key uuid,p_action text,p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_receipt product_mutation_receipts%ROWTYPE; v_hash text; v_item jsonb; v_product products%ROWTYPE;
 v_job production_jobs%ROWTYPE; v_ids jsonb:='[]'; v_result jsonb; v_id uuid; v_source jsonb; v_row products%ROWTYPE;
BEGIN
 IF p_key IS NULL OR p_action IS NULL OR p_action NOT IN ('save','delete')
   OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100
   OR octet_length(p_items::text)>1000000 THEN RAISE EXCEPTION '商品操作参数非法或超出100个上限'; END IF;
 PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '用户套餐不存在'; END IF;
 v_hash:=encode(digest(p_items::text,'sha256'),'hex');
 SELECT * INTO v_receipt FROM product_mutation_receipts WHERE user_id=p_user AND request_key=p_key;
 IF FOUND THEN
   IF v_receipt.action IS DISTINCT FROM p_action OR v_receipt.request_hash IS DISTINCT FROM v_hash THEN
     RAISE EXCEPTION '同一请求标识不能用于不同商品操作';
   END IF;
   RETURN v_receipt.result;
 END IF;
 IF (SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(p_items) item)
   <(SELECT count(*) FROM jsonb_array_elements(p_items) item WHERE item->>'id' IS NOT NULL) THEN
   RAISE EXCEPTION '商品标识不能重复';
 END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   v_id:=NULL; v_source:=NULL; v_product:=NULL; v_job:=NULL;
   IF v_item->>'id' IS NOT NULL THEN
     SELECT * INTO v_product FROM products WHERE id=(v_item->>'id')::uuid AND user_id=p_user FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION '商品不存在或无权访问'; END IF;
     IF (v_item->>'expected_updated_at')::timestamptz IS DISTINCT FROM v_product.updated_at THEN
       RAISE EXCEPTION '商品已被更新，请刷新后重试';
     END IF;
   ELSIF p_action='delete' THEN RAISE EXCEPTION '删除商品必须提供标识'; END IF;
   IF p_action='delete' THEN
     DELETE FROM products WHERE id=v_product.id;
     v_id:=v_product.id;
   ELSE
     v_row:=jsonb_populate_record(NULL::products,v_item->'draft');
     IF length(trim(COALESCE(v_row.name,''))) NOT BETWEEN 1 AND 200
       OR length(COALESCE(v_row.category,'')) NOT BETWEEN 1 AND 50 OR v_row.status IS NULL
       OR v_row.status NOT IN ('active','inactive','draft') OR v_row.stock<0 OR v_row.sales_count<0
       OR v_row.original_price<0 OR v_row.sale_price<0 OR v_row.sale_price>v_row.original_price
       OR (v_row.original_price IS NOT NULL OR v_row.sale_price IS NOT NULL) AND v_row.currency IS NULL
       OR cardinality(v_row.images)>8 OR cardinality(v_row.selling_points)>6
       OR v_row.cover_image IS NOT NULL AND NOT(v_row.cover_image=ANY(v_row.images)) THEN
       RAISE EXCEPTION '商品内容非法';
     END IF;
     IF v_item->>'import_job_id' IS NOT NULL THEN
       IF v_product.id IS NOT NULL THEN RAISE EXCEPTION '现有商品不能更换导入来源'; END IF;
       SELECT * INTO v_job FROM production_jobs WHERE id=(v_item->>'import_job_id')::uuid AND user_id=p_user
         AND kind='product_import' AND status='completed' FOR UPDATE;
       IF NOT FOUND OR v_job.result->>'expired'='true' THEN RAISE EXCEPTION '商品导入来源不存在、过期或无权访问'; END IF;
       IF EXISTS(SELECT 1 FROM product_import_links WHERE user_id=p_user AND job_id=v_job.id) THEN
         RAISE EXCEPTION '该提取结果已导入，请编辑原商品';
       END IF;
       v_source:=v_job.result->'source';
     END IF;
     IF v_product.id IS NULL THEN
       IF (SELECT count(*) FROM products WHERE user_id=p_user)>=2000 THEN RAISE EXCEPTION '商品库最多2000个商品'; END IF;
       INSERT INTO products(user_id,name,category,sub_category,description,original_price,sale_price,currency,
         stock,sales_count,selling_points,specs,images,cover_image,status,import_job_id,source)
       VALUES(p_user,v_row.name,v_row.category,v_row.sub_category,v_row.description,v_row.original_price,v_row.sale_price,v_row.currency,
         v_row.stock,v_row.sales_count,COALESCE(v_row.selling_points,'{}'),COALESCE(v_row.specs,'[]'),COALESCE(v_row.images,'{}'),
         v_row.cover_image,v_row.status,v_job.id,v_source) RETURNING id INTO v_id;
       IF v_job.id IS NOT NULL THEN INSERT INTO product_import_links(user_id,job_id,product_id) VALUES(p_user,v_job.id,v_id); END IF;
     ELSE
       UPDATE products SET name=v_row.name,category=v_row.category,sub_category=v_row.sub_category,description=v_row.description,
         original_price=v_row.original_price,sale_price=v_row.sale_price,currency=v_row.currency,stock=v_row.stock,
         sales_count=v_row.sales_count,selling_points=v_row.selling_points,specs=v_row.specs,images=v_row.images,
         cover_image=v_row.cover_image,status=v_row.status
       WHERE id=v_product.id RETURNING id INTO v_id;
     END IF;
   END IF;
   v_ids:=v_ids||to_jsonb(v_id);
 END LOOP;
 v_result:=jsonb_build_object('action',p_action,'ids',v_ids,'count',jsonb_array_length(v_ids));
 INSERT INTO product_mutation_receipts(user_id,request_key,action,request_hash,result) VALUES(p_user,p_key,p_action,v_hash,v_result);
 INSERT INTO audit_logs(user_id,action,table_name,new_data) VALUES(p_user,'products_'||p_action,'products',v_result);
 RETURN v_result;
END;
$$;
CREATE OR REPLACE FUNCTION import_intelligence_product(p_user uuid,p_sample uuid,p_item text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item jsonb; v_product uuid; v_source jsonb; v_price numeric(10,2);
BEGIN
 PERFORM 1 FROM user_plans WHERE user_id=p_user FOR UPDATE;
 SELECT product_id INTO v_product FROM product_intelligence_links WHERE user_id=p_user AND sample_id=p_sample AND item_id=p_item;
 IF FOUND THEN
   IF v_product IS NULL THEN RAISE EXCEPTION '原商品已删除，请在商品库手动创建'; END IF;
   RETURN v_product;
 END IF;
 SELECT item,s.data->'source' INTO v_item,v_source FROM intelligence_samples s JOIN production_jobs j ON j.id=s.job_id,
   LATERAL jsonb_array_elements(s.data->'items') item
 WHERE s.job_id=p_sample AND s.user_id=p_user AND j.kind='intelligence_products' AND item->>'id'=p_item;
 IF v_item IS NULL OR length(v_item->>'title') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '商品采集来源不存在或无权访问'; END IF;
 IF v_item->>'price' ~ '^\d{1,8}(\.\d{1,2})?$' THEN v_price:=(v_item->>'price')::numeric; END IF;
 INSERT INTO products(user_id,name,category,selling_points,status,original_price,currency,stock,sales_count,source)
 VALUES(p_user,v_item->>'title','待分类','{}','draft',v_price,v_item->>'currency',NULL,NULL,
   jsonb_build_object('mode','intelligence','url',v_item->>'url','observed_at',v_source->>'observed_at',
     'sample_id',p_sample,'item_id',p_item,'facts',v_item,'source',v_source)) RETURNING id INTO v_product;
 INSERT INTO product_intelligence_links(user_id,sample_id,item_id,product_id) VALUES(p_user,p_sample,p_item,v_product);
 RETURN v_product;
END;
$$;
CREATE FUNCTION prune_product_imports() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count int;
BEGIN
 UPDATE production_jobs SET result='{"expired":true}'::jsonb,payload=payload-'content',evidence=NULL,resolution=NULL
 WHERE kind='product_import' AND status IN ('completed','failed') AND completed_at<now()-interval '30 days'
   AND result IS DISTINCT FROM '{"expired":true}'::jsonb;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION create_product_import(uuid,uuid,jsonb),update_production_job(uuid,uuid,text,jsonb),
 mutate_products(uuid,uuid,text,jsonb),prune_product_imports() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION create_product_import(uuid,uuid,jsonb),update_production_job(uuid,uuid,text,jsonb),
 mutate_products(uuid,uuid,text,jsonb),prune_product_imports() TO service_role;
COMMIT;
