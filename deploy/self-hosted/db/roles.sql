-- Supabase 官方自托管角色初始化；平台schema来自正式postgres/Auth/Storage镜像。
\set pgpass `echo "$POSTGRES_PASSWORD"`
\set jwtsecret `echo "$JWT_SECRET"`
-- 官方镜像的postgres调试角色默认记录所有SQL，设置密码前关闭语句正文。
SET log_statement = 'none';
SET pgaudit.log = 'none';
ALTER ROLE postgres SET log_statement = 'none';
ALTER ROLE supabase_admin SET log_statement = 'none';
ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_admin WITH PASSWORD :'pgpass';
ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwtsecret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO '3600';
CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin;
