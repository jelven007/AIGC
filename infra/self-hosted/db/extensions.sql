-- 原业务的SECURITY DEFINER固定search_path=public；托管平台的pgcrypto位于extensions。
-- 保留扩展原schema，只为实际存在的标准函数建立明确、无搜索路径的兼容入口。
DO $compatibility$
DECLARE
  signature text;
  target regprocedure;
  namespace text;
  function_name text;
  arguments text;
  expression text;
  result_type text;
  volatility text;
  item text[];
BEGIN
  SELECT n.nspname INTO namespace FROM pg_extension e
    JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto';
  IF namespace IS NULL THEN RAISE EXCEPTION 'pgcrypto extension missing'; END IF;
  IF namespace='public' THEN RETURN; END IF;
  FOREACH item SLICE 1 IN ARRAY ARRAY[
    ['digest','text,text','bytea','$1,$2','IMMUTABLE'],
    ['digest','bytea,text','bytea','$1,$2','IMMUTABLE'],
    ['hmac','text,text,text','bytea','$1,$2,$3','IMMUTABLE'],
    ['hmac','bytea,bytea,text','bytea','$1,$2,$3','IMMUTABLE'],
    ['gen_random_bytes','integer','bytea','$1','VOLATILE'],
    ['crypt','text,text','text','$1,$2','IMMUTABLE'],
    ['gen_salt','text','text','$1','VOLATILE'],
    ['gen_salt','text,integer','text','$1,$2','VOLATILE']
  ] LOOP
    function_name:=item[1]; arguments:=item[2]; result_type:=item[3];
    expression:=format('SELECT %I.%I(%s)',namespace,function_name,item[4]); volatility:=item[5];
    signature:=format('%I.%I(%s)',namespace,function_name,arguments);
    target:=to_regprocedure(signature);
    IF target IS NULL THEN RAISE EXCEPTION 'extension function missing: %',signature; END IF;
    IF to_regprocedure(format('public.%I(%s)',function_name,arguments)) IS NULL THEN
      EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql %s STRICT '
        'SET search_path='''' AS %L',function_name,arguments,result_type,volatility,expression);
    END IF;
  END LOOP;
END
$compatibility$;
