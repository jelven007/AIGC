BEGIN;
-- 固定满额账号实测：00043精确余弦重复计算，P95超过500ms。
-- 保留float8精确扫描、版本/正文/归属过滤；写入时只计算一次分块范数。
CREATE FUNCTION knowledge_vector_norm(p_vector float8[]) RETURNS float8
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
 SELECT sqrt(sum(value*value)) FROM unnest(p_vector) value;
$$;
ALTER TABLE knowledge_chunks ADD COLUMN embedding_norm float8
 GENERATED ALWAYS AS (knowledge_vector_norm(embedding)) STORED;
CREATE OR REPLACE FUNCTION search_knowledge_vectors(p_user uuid,p_version uuid,p_vector float8[],p_limit int DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_results jsonb; v_norm float8;
BEGIN
 IF NOT COALESCE(valid_knowledge_vector(p_vector),false) OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN
   RAISE EXCEPTION '检索向量非法';
 END IF;
 v_norm:=knowledge_vector_norm(p_vector);
 WITH scores AS MATERIALIZED (
   SELECT c.entry_id,e.title,c.content_hash,c.version_id,c.content,c.ordinal,
     (SELECT sum(a*p_vector[i]) FROM unnest(c.embedding) WITH ORDINALITY v(a,i))
       /NULLIF(c.embedding_norm*v_norm,0) AS similarity
   FROM knowledge_chunks c JOIN knowledge_entries e
     ON e.id=c.entry_id AND e.user_id=c.user_id AND e.content_hash=c.content_hash
   WHERE c.user_id=p_user AND c.version_id=p_version AND cardinality(c.embedding)=cardinality(p_vector)
 ), best AS (
   SELECT DISTINCT ON (entry_id) entry_id,title,content_hash,version_id,content,similarity
   FROM scores WHERE similarity>=0.2 ORDER BY entry_id,similarity DESC,ordinal
 ), limited AS (
   SELECT * FROM best ORDER BY similarity DESC,entry_id LIMIT p_limit
 )
 SELECT COALESCE(jsonb_agg(to_jsonb(limited) ORDER BY similarity DESC,entry_id),'[]') INTO v_results FROM limited;
 RETURN v_results;
END;
$$;
REVOKE ALL ON FUNCTION knowledge_vector_norm(float8[]),search_knowledge_vectors(uuid,uuid,float8[],int)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION knowledge_vector_norm(float8[]),search_knowledge_vectors(uuid,uuid,float8[],int) TO service_role;
COMMIT;
