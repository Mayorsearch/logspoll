-- READ ONLY: operator checks after the additive supplier migration.
-- Does not select credentials, customer rows or real inventory.
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('supplier_connections','supplier_feed_categories','supplier_feed_items');
select role_name,
 has_table_privilege(role_name,'public.supplier_connections','SELECT') as can_read_credentials,
 has_table_privilege(role_name,'public.supplier_connections','INSERT') as can_insert_credentials,
 has_table_privilege(role_name,'public.supplier_connections','UPDATE') as can_replace_credentials,
 has_function_privilege(role_name,'public.save_supplier_connection(uuid,integer,jsonb,text,text)','EXECUTE') as can_call_secret_writer,
 has_function_privilege(role_name,'public.finish_supplier_connection(uuid,uuid,jsonb,text)','EXECUTE') as can_bypass_sync_validation
from (values ('anon'),('authenticated'),('service_role')) roles(role_name);
-- Expected anon/authenticated: all false; service_role: true.
select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('supplier_connections','supplier_feed_categories','supplier_feed_items');
-- Expected: NO supplier_connections policies; feed SELECT restricted to private.is_admin().
