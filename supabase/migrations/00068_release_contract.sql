BEGIN;
ALTER FUNCTION worker_capabilities() RENAME TO worker_capabilities_before_00068;
REVOKE ALL ON FUNCTION worker_capabilities_before_00068() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION worker_capabilities() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prior jsonb; missing text[]; item record; column_name text; signature text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅后台可核对能力' USING ERRCODE='42501'; END IF;
 prior:=worker_capabilities_before_00068();
 SELECT COALESCE(array_agg(value),'{}') INTO missing FROM jsonb_array_elements_text(prior->'missing');
 FOR item IN SELECT * FROM jsonb_each('{
   "knowledge_chunks":["embedding_norm"],
   "operations_alert_events":["id","alert_id","version"],
   "operations_alert_deliveries":["event_id","channel","payload","attempts","lease_token","lease_until","receipt","delivered_at"]
 }'::jsonb) LOOP
  FOR column_name IN SELECT jsonb_array_elements_text(item.value) LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.'||item.key)
     AND attname=column_name AND attnum>0 AND NOT attisdropped) THEN
     missing:=array_append(missing,item.key); EXIT;
   END IF;
  END LOOP;
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['claim_alert_delivery(text)','finish_alert_delivery(text,uuid,uuid,jsonb)'] LOOP
  IF to_regprocedure('public.'||signature) IS NULL OR NOT COALESCE(
    has_function_privilege('service_role',to_regprocedure('public.'||signature),'EXECUTE'),false) THEN
    missing:=array_append(missing,signature);
  END IF;
 END LOOP;
 RETURN prior||jsonb_build_object('ready',cardinality(missing)=0,'version',24,
   'required_migration','00068','missing',to_jsonb(missing));
END;
$$;
REVOKE ALL ON FUNCTION worker_capabilities() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION worker_capabilities() TO service_role;
COMMIT;
