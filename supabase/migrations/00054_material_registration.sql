-- 用户上传登记与原请求回执；删除后重放不复活素材。
CREATE TABLE public.material_upload_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  request jsonb NOT NULL,
  material_id uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  rights_confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,request_key)
);
ALTER TABLE public.material_upload_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.material_upload_receipts FROM anon,authenticated;
GRANT SELECT ON public.material_upload_receipts TO authenticated;
CREATE POLICY own_material_receipts ON public.material_upload_receipts FOR SELECT TO authenticated
  USING(user_id=auth.uid());
GRANT ALL ON public.material_upload_receipts TO service_role;

CREATE FUNCTION public.register_material_upload(p_user uuid,p_key uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage AS $$
DECLARE v_receipt material_upload_receipts%ROWTYPE; v_material materials%ROWTYPE;
  v_metadata jsonb; v_path text := p_request->>'path'; v_type text := p_request->>'type';
  v_size bigint; v_mime text;
BEGIN
  IF p_user IS NULL OR p_key IS NULL OR jsonb_typeof(p_request) IS DISTINCT FROM 'object'
    OR p_request->>'rights_confirmed' IS DISTINCT FROM 'true'
    OR length(trim(COALESCE(p_request->>'name',''))) NOT BETWEEN 1 AND 200
    OR COALESCE(v_type,'') NOT IN ('image','video','audio')
    OR v_path IS DISTINCT FROM p_user::text||'/uploads/'||p_key::text||'.'||(p_request->>'extension')
    OR COALESCE(p_request->>'extension','') NOT IN ('jpg','jpeg','png','webp','gif','mp4','mov','webm','mp3','wav','ogg','m4a','opus')
    OR COALESCE(p_request->>'source','') NOT IN ('upload','recording')
    OR p_request->>'source'='recording' AND v_type<>'audio'
    OR COALESCE(p_request->>'content_hash','') !~ '^[a-f0-9]{64}$'
    OR COALESCE(p_request->>'url','') !~ '^https://[^/?#]+/storage/v1/object/authenticated/materials/'
    OR right(p_request->>'url',length(v_path)) IS DISTINCT FROM v_path
    OR jsonb_typeof(p_request->'size') IS DISTINCT FROM 'number'
    OR (p_request->>'size')::numeric NOT BETWEEN 1 AND 52428800
    OR (p_request->>'size')::numeric <> trunc((p_request->>'size')::numeric)
    OR (v_type IN ('audio','video') AND (jsonb_typeof(p_request->'duration_sec') IS DISTINCT FROM 'number'
      OR (p_request->>'duration_sec')::numeric NOT BETWEEN .1 AND 36000))
  THEN RAISE EXCEPTION '素材登记参数或使用权确认无效'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('material-upload:'||p_user::text||':'||p_key::text,0));
  SELECT * INTO v_receipt FROM material_upload_receipts WHERE user_id=p_user AND request_key=p_key;
  IF FOUND THEN
    IF v_receipt.request IS DISTINCT FROM p_request THEN RAISE EXCEPTION '同一请求标识不能登记不同素材'; END IF;
    IF v_receipt.material_id IS NULL THEN RETURN jsonb_build_object('deleted',true,'request_key',p_key); END IF;
    SELECT * INTO STRICT v_material FROM materials WHERE id=v_receipt.material_id AND user_id=p_user;
    RETURN jsonb_build_object('material',to_jsonb(v_material),'request_key',p_key);
  END IF;
  SELECT metadata INTO v_metadata FROM storage.objects WHERE bucket_id='materials' AND name=v_path FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '原素材尚未上传，请重新选择原文件'; END IF;
  IF EXISTS(SELECT 1 FROM media_deletions WHERE bucket='materials' AND path=v_path)
    THEN RAISE EXCEPTION '原素材已进入清理流程，请重新上传'; END IF;
  v_size := COALESCE(v_metadata->>'size',v_metadata->>'contentLength')::bigint;
  v_mime := split_part(COALESCE(v_metadata->>'mimetype',''),';',1);
  IF v_size IS DISTINCT FROM (p_request->>'size')::bigint OR v_mime NOT LIKE v_type||'/%'
    OR v_mime IS DISTINCT FROM p_request->>'mime'
    THEN RAISE EXCEPTION '存储对象大小或媒体类型与登记不一致'; END IF;
  INSERT INTO materials(user_id,name,type,url,size,duration_sec,tags)
    VALUES(p_user,trim(p_request->>'name'),v_type,p_request->>'url',v_size,
      CASE WHEN v_type IN ('audio','video') THEN (p_request->>'duration_sec')::numeric END,
      ARRAY[CASE WHEN p_request->>'source'='recording' THEN '自有录音' ELSE '授权上传' END])
    RETURNING * INTO v_material;
  INSERT INTO material_upload_receipts(user_id,request_key,request,material_id)
    VALUES(p_user,p_key,p_request,v_material.id);
  RETURN jsonb_build_object('material',to_jsonb(v_material),'request_key',p_key);
END $$;
REVOKE ALL ON FUNCTION public.register_material_upload(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_material_upload(uuid,uuid,jsonb) TO service_role;
