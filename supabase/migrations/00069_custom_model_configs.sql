BEGIN;
-- 保留初始创建请求，以便网络重试不重复创建，也不覆盖后续配置版本。
ALTER TABLE model_slot_catalog ADD COLUMN creation_settings jsonb;
ALTER TABLE model_slot_catalog ADD COLUMN created_by uuid REFERENCES auth.users(id);

CREATE FUNCTION create_custom_model_config(p_slot text,p_settings jsonb,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_inserted text; v_settings jsonb; v_actor uuid; v_current uuid;
BEGIN
 IF p_slot IS NULL OR p_slot !~ '^custom\.(text|video|image|audio|3d|embedding)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(p_settings) IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_settings->'name') IS DISTINCT FROM 'string'
   OR length(trim(p_settings->>'name')) NOT BETWEEN 1 AND 200 THEN
   RAISE EXCEPTION '自建模型配置参数不正确';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND raw_app_meta_data->>'role'='admin') THEN
   RAISE EXCEPTION '仅平台管理员可修改模型配置';
 END IF;
 INSERT INTO model_slot_catalog(slot,creation_settings,created_by)
   VALUES(p_slot,p_settings,p_actor) ON CONFLICT DO NOTHING RETURNING slot INTO v_inserted;
 IF v_inserted IS NULL THEN
   SELECT creation_settings,created_by INTO v_settings,v_actor FROM model_slot_catalog WHERE slot=p_slot FOR UPDATE;
   IF v_settings IS DISTINCT FROM p_settings OR v_actor IS DISTINCT FROM p_actor THEN
     RAISE EXCEPTION '创建标识已被使用';
   END IF;
   SELECT current_version_id INTO v_current FROM model_configs WHERE slot=p_slot;
   RETURN v_current;
 END IF;
 RETURN save_model_config(p_slot,NULL,p_settings,false,NULL,p_actor,false);
END;
$$;
REVOKE ALL ON FUNCTION create_custom_model_config(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION create_custom_model_config(text,jsonb,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
