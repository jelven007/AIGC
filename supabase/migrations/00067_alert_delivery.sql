BEGIN;
CREATE TABLE operations_alert_deliveries (
 event_id uuid NOT NULL REFERENCES operations_alert_events(id),channel text NOT NULL
 CHECK(channel ~ '^[a-z][a-z0-9_]{0,63}$'),payload jsonb,
 attempts int NOT NULL DEFAULT 0 CHECK(attempts>=0),next_run_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,lease_until timestamptz,delivered_at timestamptz,receipt jsonb,
 PRIMARY KEY(event_id,channel),CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX operations_alert_delivery_due ON operations_alert_deliveries(channel,next_run_at,event_id)
 WHERE delivered_at IS NULL;
ALTER TABLE operations_alert_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON operations_alert_deliveries FROM PUBLIC,anon,authenticated;
GRANT ALL ON operations_alert_deliveries TO service_role;

CREATE FUNCTION claim_alert_delivery(p_channel text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item operations_alert_deliveries%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅后台可投递告警' USING ERRCODE='42501'; END IF;
 IF p_channel IS NULL OR p_channel !~ '^[a-z][a-z0-9_]{0,63}$' THEN RAISE EXCEPTION '告警渠道非法' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_channel,67001));
 -- 扫描所有尚未建回执的原事件；created_at并非提交顺序，不能用时间游标漏掉晚提交事件。
 INSERT INTO operations_alert_deliveries(event_id,channel,payload)
 SELECT e.id,p_channel,jsonb_build_object('event_id',e.id,'alert_id',e.alert_id,'event',e.event,
   'version',e.version,'created_at',e.created_at,'rule',a.rule,'source_type',a.source_type,
   'source_id',a.source_id,'severity',a.severity,'title',a.title)
 FROM operations_alert_events e JOIN operations_alerts a ON a.id=e.alert_id
 WHERE NOT EXISTS(SELECT 1 FROM operations_alert_deliveries d WHERE d.event_id=e.id AND d.channel=p_channel)
 ON CONFLICT DO NOTHING;
 IF EXISTS(SELECT 1 FROM operations_alert_deliveries WHERE channel=p_channel AND lease_until>now()) THEN RETURN NULL; END IF;
 SELECT * INTO item FROM operations_alert_deliveries WHERE channel=p_channel AND delivered_at IS NULL
   AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<=now())
   ORDER BY next_run_at,event_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE operations_alert_deliveries SET lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',
   attempts=attempts+1 WHERE event_id=item.event_id AND channel=p_channel RETURNING * INTO item;
 RETURN jsonb_build_object('event_id',item.event_id,'lease_token',item.lease_token,'payload',item.payload);
END;
$$;
CREATE FUNCTION finish_alert_delivery(p_channel text,p_event uuid,p_lease uuid,p_receipt jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE accepted boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION '仅后台可核对告警' USING ERRCODE='42501'; END IF;
 -- 仅白名单回执字段入库；响应正文、渠道密钥不进入事件/日志。
 accepted:=COALESCE(jsonb_typeof(p_receipt)='object' AND p_receipt->'accepted'='true'::jsonb
   AND p_receipt->>'event_id'=p_event::text,false);
 UPDATE operations_alert_deliveries SET
   delivered_at=CASE WHEN accepted THEN now() ELSE NULL END,
   receipt=CASE WHEN accepted THEN jsonb_build_object('event_id',p_event,'accepted',true) ELSE NULL END,
   next_run_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts-1,7))::int)),
   lease_token=NULL,lease_until=NULL
 WHERE event_id=p_event AND channel=p_channel AND lease_token=p_lease AND lease_until>now() AND delivered_at IS NULL;
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION claim_alert_delivery(text),finish_alert_delivery(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION claim_alert_delivery(text),finish_alert_delivery(text,uuid,uuid,jsonb) TO service_role;
COMMIT;
