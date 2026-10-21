BEGIN;
-- 密钥只能由业务 API 写入；用户读取列表时不获得摘要或自行提高限额。
ALTER TABLE public.api_keys ADD COLUMN issuance_version int NOT NULL DEFAULT 0;
UPDATE public.api_keys SET is_active=false WHERE issuance_version=0;
DROP POLICY IF EXISTS ak_own ON public.api_keys;
DROP POLICY IF EXISTS ak_own_insert ON public.api_keys;
REVOKE ALL ON public.api_keys FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,user_id,name,key_prefix,scopes,rate_limit,last_used_at,expires_at,is_active,total_calls,created_at)
  ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
CREATE POLICY api_keys_read ON public.api_keys FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE FUNCTION public.consume_api_key(p_hash text,p_scope text,p_endpoint text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_key api_keys%ROWTYPE; v_start timestamptz:=date_trunc('minute',now()); v_allowed boolean;
BEGIN
  SELECT * INTO v_key FROM api_keys WHERE key_hash=p_hash AND is_active AND issuance_version=1
    AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','invalid_key','status',401); END IF;
  IF NOT p_scope=ANY(v_key.scopes) THEN RETURN jsonb_build_object('error','scope_denied','status',403); END IF;
  v_allowed:=upsert_rate_limit('api-key:'||v_key.id||':'||v_start::text,'api-key:'||v_key.id,
    v_start+interval '1 minute',LEAST(100,GREATEST(1,v_key.rate_limit)));
  IF NOT v_allowed THEN RETURN jsonb_build_object('error','rate_limited','status',429); END IF;
  UPDATE api_keys SET last_used_at=now(),total_calls=total_calls+1 WHERE id=v_key.id;
  INSERT INTO api_call_logs(api_key_id,user_id,endpoint) VALUES(v_key.id,v_key.user_id,left(p_endpoint,100));
  RETURN jsonb_build_object('user_id',v_key.user_id,'key_id',v_key.id);
END;
$$;
REVOKE ALL ON FUNCTION consume_api_key(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION consume_api_key(text,text,text) TO service_role;

-- 团队写入均经过事务接口；移除旧“user_id=self 即可加入任意团队”的策略。
REVOKE INSERT,UPDATE,DELETE ON public.teams,public.team_members,public.team_invitations FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.is_team_owner(t_id uuid,u_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM teams WHERE id=t_id AND owner_id=u_id);
$$;
CREATE OR REPLACE FUNCTION public.is_team_member(t_id uuid,u_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM team_members WHERE team_id=t_id AND user_id=u_id AND status='active');
$$;
CREATE POLICY team_roster_read ON public.team_members FOR SELECT TO authenticated
  USING(public.is_team_member(team_id,auth.uid()));
CREATE FUNCTION public.manage_team(p_user uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_team teams%ROWTYPE; v_member team_members%ROWTYPE; v_inv team_invitations%ROWTYPE;
  v_role text:=p_data->>'role'; v_email text; v_id uuid;
BEGIN
  -- 同一用户的加入/创建串行；邀请接受再锁团队，容量与消费在同事务核对。
  PERFORM pg_advisory_xact_lock(hashtextextended('team-user:'||p_user,0));
  IF p_action='create' THEN
    IF length(trim(COALESCE(p_data->>'name',''))) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION '团队名称须为1–80字'; END IF;
    IF EXISTS(SELECT 1 FROM team_members WHERE user_id=p_user AND status='active') THEN RAISE EXCEPTION '已加入团队'; END IF;
    INSERT INTO teams(name,owner_id) VALUES(trim(p_data->>'name'),p_user) RETURNING * INTO v_team;
    INSERT INTO team_members(team_id,user_id,role) VALUES(v_team.id,p_user,'owner');
    RETURN to_jsonb(v_team);
  ELSIF p_action='accept' THEN
    SELECT team_id INTO v_id FROM team_invitations WHERE token=p_data->>'token';
    SELECT * INTO STRICT v_team FROM teams WHERE id=v_id FOR UPDATE;
    SELECT * INTO STRICT v_inv FROM team_invitations WHERE token=p_data->>'token' FOR UPDATE;
    SELECT lower(email) INTO STRICT v_email FROM auth.users WHERE id=p_user;
    IF v_inv.email<>v_email OR v_inv.expires_at<=now() THEN RAISE EXCEPTION '邀请已过期或邮箱不匹配'; END IF;
    IF v_inv.accepted_at IS NOT NULL THEN
      IF EXISTS(SELECT 1 FROM team_members WHERE team_id=v_team.id AND user_id=p_user AND status='active') THEN RETURN to_jsonb(v_team); END IF;
      RAISE EXCEPTION '邀请已使用';
    END IF;
    IF EXISTS(SELECT 1 FROM team_members WHERE user_id=p_user AND status='active') THEN RAISE EXCEPTION '已加入团队'; END IF;
    IF (SELECT count(*) FROM team_members WHERE team_id=v_team.id AND status='active')>=v_team.max_members THEN RAISE EXCEPTION '团队名额已满'; END IF;
    INSERT INTO team_members(team_id,user_id,role,status) VALUES(v_team.id,p_user,v_inv.role,'active')
      ON CONFLICT(team_id,user_id) DO UPDATE SET role=excluded.role,status='active',joined_at=now();
    UPDATE team_invitations SET accepted_at=now() WHERE id=v_inv.id;
    RETURN to_jsonb(v_team);
  ELSE
    SELECT * INTO STRICT v_team FROM teams WHERE id=(p_data->>'team_id')::uuid FOR UPDATE;
    IF v_team.owner_id<>p_user THEN RAISE EXCEPTION '只有团队所有者可管理成员'; END IF;
    IF p_action='invite' THEN
      v_email:=lower(trim(p_data->>'email'));
      IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        OR length(v_email)>254 OR v_role NOT IN ('admin','editor','viewer') OR v_role IS NULL THEN RAISE EXCEPTION '邮箱或角色非法'; END IF;
      INSERT INTO team_invitations(team_id,email,role,invited_by) VALUES(v_team.id,v_email,v_role,p_user) RETURNING * INTO v_inv;
      RETURN jsonb_build_object('token',v_inv.token,'expires_at',v_inv.expires_at);
    ELSIF p_action IN ('remove','role') THEN
      SELECT * INTO STRICT v_member FROM team_members WHERE id=(p_data->>'member_id')::uuid AND team_id=v_team.id FOR UPDATE;
      IF v_member.user_id=v_team.owner_id THEN RAISE EXCEPTION '不能修改所有者身份'; END IF;
      IF p_action='remove' THEN UPDATE team_members SET status='removed' WHERE id=v_member.id;
      ELSE
        IF v_role NOT IN ('admin','editor','viewer') OR v_role IS NULL THEN RAISE EXCEPTION '角色非法'; END IF;
        UPDATE team_members SET role=v_role WHERE id=v_member.id;
      END IF;
      RETURN jsonb_build_object('ok',true);
    END IF;
  END IF;
  RAISE EXCEPTION '团队操作不支持';
END;
$$;
REVOKE ALL ON FUNCTION manage_team(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION manage_team(uuid,text,jsonb) TO service_role;

ALTER TABLE public.avatars ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.avatars ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.avatars ADD COLUMN IF NOT EXISTS cover_url text;
DROP POLICY IF EXISTS avatars_public_read ON public.avatars;
CREATE POLICY avatars_read ON public.avatars FOR SELECT TO authenticated USING(user_id IS NULL OR user_id=auth.uid());
CREATE POLICY avatars_insert ON public.avatars FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
CREATE POLICY avatars_update ON public.avatars FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE POLICY avatars_delete ON public.avatars FOR DELETE TO authenticated USING(user_id=auth.uid());
REVOKE ALL ON public.avatars FROM anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.avatars TO authenticated;

CREATE TABLE public.team_asset_shares (
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  bucket text NOT NULL CHECK(bucket IN ('materials','videos','thumbnails')),
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(material_id,team_id)
);
CREATE INDEX team_asset_path ON public.team_asset_shares(bucket,path);
ALTER TABLE public.team_asset_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_asset_shares FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.team_asset_shares TO authenticated;
GRANT ALL ON public.team_asset_shares TO service_role;
CREATE POLICY team_shares_read ON public.team_asset_shares FOR SELECT TO authenticated
  USING(owner_id=auth.uid() OR public.is_team_member(team_id,auth.uid()));
CREATE POLICY team_materials_read ON public.materials FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM team_asset_shares s WHERE s.material_id=materials.id AND public.is_team_member(s.team_id,auth.uid())));
CREATE FUNCTION public.can_read_media(p_uid uuid,p_bucket text,p_path text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND p_uid IS DISTINCT FROM auth.uid() THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM media_deletions WHERE bucket=p_bucket AND path=p_path) THEN RETURN false; END IF;
  RETURN p_bucket IN ('materials','videos','thumbnails') AND (
    owns_storage_path(p_path,p_uid)
    OR EXISTS(SELECT 1 FROM legacy_media_access WHERE bucket=p_bucket AND path=p_path AND user_id=p_uid)
    OR EXISTS(SELECT 1 FROM team_asset_shares s WHERE s.bucket=p_bucket AND s.path=p_path
      AND public.is_team_member(s.team_id,p_uid)));
END;
$$;
REVOKE ALL ON FUNCTION can_read_media(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION can_read_media(uuid,text,text) TO authenticated,service_role;
DROP POLICY IF EXISTS private_media_read ON storage.objects;
CREATE POLICY private_media_read ON storage.objects FOR SELECT TO authenticated
  USING(public.can_read_media(auth.uid(),bucket_id,name));

-- 删除业务行和待删除对象同事务；Storage 故障由 outbox 重试，不丢失清理信息。
CREATE TABLE public.media_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
  bucket text NOT NULL, path text NOT NULL, attempts int NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(), last_error text, completed_at timestamptz,
  UNIQUE(bucket,path)
);
ALTER TABLE public.media_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_deletions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.media_deletions TO service_role;
DROP POLICY IF EXISTS private_media_upload ON storage.objects;
CREATE FUNCTION public.can_upload_media(p_uid uuid,p_bucket text,p_path text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_uid IS DISTINCT FROM auth.uid() THEN RETURN false; END IF;
  RETURN p_bucket IN ('materials','videos','thumbnails') AND split_part(p_path,'/',1)=p_uid::text
    AND NOT EXISTS(SELECT 1 FROM media_deletions WHERE bucket=p_bucket AND path=p_path);
END;
$$;
REVOKE ALL ON FUNCTION can_upload_media(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION can_upload_media(uuid,text,text) TO authenticated;
CREATE POLICY private_media_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK(public.can_upload_media(auth.uid(),bucket_id,name));
DROP POLICY IF EXISTS private_media_update ON storage.objects;
CREATE POLICY private_media_update ON storage.objects FOR UPDATE TO authenticated
  USING(public.can_upload_media(auth.uid(),bucket_id,name))
  WITH CHECK(public.can_upload_media(auth.uid(),bucket_id,name));
CREATE FUNCTION public.claim_media_deletions() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_items jsonb;
BEGIN
  WITH due AS (
    SELECT id FROM media_deletions WHERE completed_at IS NULL AND next_run_at<=now()
      ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 10
  ), claimed AS (
    UPDATE media_deletions SET next_run_at=now()+interval '5 minutes',attempts=attempts+1
      WHERE id IN (SELECT id FROM due) RETURNING *
  ) SELECT COALESCE(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO v_items FROM claimed;
  RETURN v_items;
END;
$$;
REVOKE ALL ON FUNCTION claim_media_deletions() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION claim_media_deletions() TO service_role;
REVOKE DELETE ON public.materials FROM anon,authenticated;
CREATE FUNCTION public.delete_owned_material(p_user uuid,p_material uuid,p_bucket text,p_path text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_material materials%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_material FROM materials WHERE id=p_material AND user_id=p_user FOR UPDATE;
  IF p_path IS NOT NULL THEN
    IF p_bucket NOT IN ('materials','videos','thumbnails') OR NOT (
      owns_storage_path(p_path,p_user) OR EXISTS(SELECT 1 FROM legacy_media_access WHERE bucket=p_bucket AND path=p_path AND user_id=p_user)
    ) THEN RAISE EXCEPTION '无权删除此对象'; END IF;
    IF EXISTS(SELECT 1 FROM materials WHERE id<>p_material AND split_part(url,'?',1)=split_part(v_material.url,'?',1))
      OR EXISTS(SELECT 1 FROM video_projects WHERE video_url=v_material.url OR thumbnail_url=v_material.url)
      OR EXISTS(SELECT 1 FROM video_projects WHERE materials::text LIKE '%'||v_material.url||'%' OR style_data::text LIKE '%'||v_material.url||'%')
      OR EXISTS(SELECT 1 FROM products WHERE v_material.url=ANY(images))
      OR EXISTS(SELECT 1 FROM cover_candidates WHERE image_url=v_material.url)
      OR EXISTS(SELECT 1 FROM avatars WHERE preview_image=v_material.url OR cover_url=v_material.url OR sample_video=v_material.url)
      OR EXISTS(SELECT 1 FROM production_jobs WHERE status IN ('pending','running','unknown') AND payload::text LIKE '%'||v_material.url||'%')
      OR EXISTS(SELECT 1 FROM video_jobs WHERE status NOT IN ('completed','failed','cancelled') AND payload::text LIKE '%'||v_material.url||'%')
      THEN RAISE EXCEPTION '素材仍被作品、形象或任务引用，请先移除引用'; END IF;
    INSERT INTO media_deletions(user_id,bucket,path) VALUES(p_user,p_bucket,p_path)
      ON CONFLICT(bucket,path) DO UPDATE SET completed_at=NULL,next_run_at=now(),last_error=NULL;
  END IF;
  DELETE FROM materials WHERE id=p_material;
END;
$$;
REVOKE ALL ON FUNCTION delete_owned_material(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION delete_owned_material(uuid,uuid,text,text) TO service_role;
COMMIT;
