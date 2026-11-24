BEGIN;

CREATE TABLE public.canvas_projects (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  document jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canvas_projects_owner_updated ON public.canvas_projects(user_id, updated_at DESC);
ALTER TABLE public.canvas_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY canvas_projects_owner_read ON public.canvas_projects FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY canvas_projects_owner_delete ON public.canvas_projects FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.canvas_projects FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.canvas_projects TO authenticated;
GRANT ALL ON public.canvas_projects TO service_role;

CREATE FUNCTION public.validate_canvas_document(p_document jsonb, p_user uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE n jsonb; e jsonb; source_type text; target_type text;
BEGIN
  IF p_user IS NULL OR jsonb_typeof(p_document) IS DISTINCT FROM 'object'
    OR p_document->>'schemaVersion' IS DISTINCT FROM '1'
    OR jsonb_typeof(p_document->'nodes') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_document->'edges') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_document->'viewport') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '画布工程格式或版本非法';
  END IF;
  IF jsonb_array_length(p_document->'nodes') > 200 OR jsonb_array_length(p_document->'edges') > 400
    OR octet_length(p_document::text) > 2097152 THEN RAISE EXCEPTION '画布工程数量或大小超限'; END IF;
  FOR n IN SELECT value FROM jsonb_each(p_document->'viewport') LOOP
    IF jsonb_typeof(n) <> 'number' OR abs((n #>> '{}')::numeric) > 10000000 THEN RAISE EXCEPTION '视区坐标非法'; END IF;
  END LOOP;
  IF NOT (p_document->'viewport' ?& ARRAY['x','y','zoom'])
    OR (p_document->'viewport'->>'zoom')::numeric NOT BETWEEN .1 AND 4 THEN RAISE EXCEPTION '视区比例非法'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_document->'nodes') v GROUP BY v->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION '节点标识重复';
  END IF;
  FOR n IN SELECT value FROM jsonb_array_elements(p_document->'nodes') LOOP
    IF jsonb_typeof(n->'id') IS DISTINCT FROM 'string' OR char_length(n->>'id') NOT BETWEEN 1 AND 100
      OR n->>'type' NOT IN ('text','image','video','audio','group') OR n->>'type' IS NULL
      OR jsonb_typeof(n->'data'->'name') IS DISTINCT FROM 'string' OR char_length(n->'data'->>'name') > 200
      OR jsonb_typeof(n->'position'->'x') IS DISTINCT FROM 'number'
      OR jsonb_typeof(n->'position'->'y') IS DISTINCT FROM 'number'
      OR abs((n->'position'->>'x')::numeric) > 10000000 OR abs((n->'position'->>'y')::numeric) > 10000000 THEN
      RAISE EXCEPTION '节点名称、类型或坐标非法';
    END IF;
    IF n->'data' ? 'text' AND (jsonb_typeof(n->'data'->'text') <> 'string' OR char_length(n->'data'->>'text') > 8000)
      OR n->'data' ? 'prompt' AND (jsonb_typeof(n->'data'->'prompt') <> 'string' OR char_length(n->'data'->>'prompt') > 8000) THEN
      RAISE EXCEPTION '文字或提示词非法';
    END IF;
    IF n->>'type' = 'group' AND (jsonb_typeof(n->'width') IS DISTINCT FROM 'number'
      OR jsonb_typeof(n->'height') IS DISTINCT FROM 'number'
      OR (n->>'width')::numeric NOT BETWEEN 100 AND 10000000
      OR (n->>'height')::numeric NOT BETWEEN 100 AND 10000000) THEN RAISE EXCEPTION '分组尺寸非法'; END IF;
    IF n ? 'parentId' AND (n->>'type' = 'group' OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_document->'nodes') parent
        WHERE parent->>'id' = n->>'parentId' AND parent->>'type' = 'group')) THEN RAISE EXCEPTION '分组归属非法'; END IF;
    IF n->'data' ? 'url' AND (jsonb_typeof(n->'data'->'url') <> 'string'
      OR char_length(n->'data'->>'url') > 4096
      OR n->'data'->>'url' !~ '^https?://[^/]+/storage/v1/object/(authenticated|public|sign)/(materials|videos|thumbnails)/'
      OR NOT EXISTS (SELECT 1 FROM media_tree_objects(n->'data'->'url'))) THEN RAISE EXCEPTION '媒体地址非法'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM media_tree_objects(p_document) WHERE split_part(path, '/', 1) <> p_user::text
    OR path ~ '(^|/)\.\.?(/|$)') THEN RAISE EXCEPTION '不能引用其他账号的媒体'; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_document->'edges') LOOP
    SELECT v->>'type' INTO source_type FROM jsonb_array_elements(p_document->'nodes') v WHERE v->>'id' = e->>'source';
    SELECT v->>'type' INTO target_type FROM jsonb_array_elements(p_document->'nodes') v WHERE v->>'id' = e->>'target';
    IF jsonb_typeof(e->'id') IS DISTINCT FROM 'string' OR source_type IS NULL OR target_type IS DISTINCT FROM 'image'
      OR source_type NOT IN ('text','image') OR e->>'source' = e->>'target' THEN RAISE EXCEPTION '连线节点或类型非法'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_document->'edges') edge_row GROUP BY edge_row->>'id' HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_document->'edges') edge_row
      JOIN jsonb_array_elements(p_document->'nodes') node_row ON node_row->>'id' = edge_row->>'source'
      GROUP BY edge_row->>'target', node_row->>'type' HAVING count(*) > 1) THEN RAISE EXCEPTION '连线来源重复'; END IF;
  IF EXISTS (
    WITH RECURSIVE reach(s,t) AS (
      SELECT edge_row->>'source', edge_row->>'target' FROM jsonb_array_elements(p_document->'edges') edge_row
      UNION
      SELECT r.s, edge_row->>'target' FROM reach r JOIN jsonb_array_elements(p_document->'edges') edge_row ON edge_row->>'source' = r.t
    ) SELECT 1 FROM reach WHERE s = t
  ) THEN RAISE EXCEPTION '连线不能形成循环'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_canvas_document(jsonb,uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_canvas_project(p_id uuid, p_title text, p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := auth.uid(); project canvas_projects%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION '请先登录'; END IF;
  PERFORM validate_canvas_document(p_document, actor);
  INSERT INTO canvas_projects(id,user_id,title,document) VALUES (p_id,actor,p_title,p_document) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO project FROM canvas_projects WHERE id=p_id AND user_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION '画布不存在或无权访问'; END IF;
  RETURN to_jsonb(project);
END;
$$;
CREATE FUNCTION public.save_canvas_project(p_id uuid, p_revision integer, p_title text, p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := auth.uid(); project canvas_projects%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION '请先登录'; END IF;
  IF p_revision IS NULL OR p_revision < 1 THEN RAISE EXCEPTION '保存版本非法'; END IF;
  PERFORM validate_canvas_document(p_document, actor);
  SELECT * INTO project FROM canvas_projects WHERE id=p_id AND user_id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '画布不存在或无权保存'; END IF;
  IF project.revision <> p_revision THEN
    IF project.revision > p_revision AND project.title=p_title AND project.document=p_document THEN RETURN to_jsonb(project); END IF;
    RAISE SQLSTATE 'PT409' USING MESSAGE = '画布版本冲突，请重载或另存工程';
  END IF;
  UPDATE canvas_projects SET title=p_title, document=p_document, revision=revision+1, updated_at=now()
    WHERE id=p_id RETURNING * INTO project;
  RETURN to_jsonb(project);
END;
$$;
REVOKE ALL ON FUNCTION public.create_canvas_project(uuid,text,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_canvas_project(uuid,integer,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_canvas_project(uuid,text,jsonb),
  public.save_canvas_project(uuid,integer,text,jsonb) TO authenticated;
CREATE TRIGGER lifecycle_media_refs AFTER INSERT OR UPDATE OR DELETE ON public.canvas_projects
  FOR EACH ROW EXECUTE FUNCTION public.sync_media_references();

NOTIFY pgrst, 'reload schema';
COMMIT;
