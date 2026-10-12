-- READ ONLY. Run in the existing project's SQL editor before enabling production access.
-- Review all policies, including any permissive policies added outside these migrations.
select n.nspname as schema_name,c.relname,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('profiles','orders','order_items','product_entitlements','user_roles');
select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('profiles','orders','order_items','product_entitlements','user_roles');
select table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in ('profiles','orders','order_items','product_entitlements','user_roles')
and grantee in ('anon','authenticated') order by table_name,grantee,privilege_type;
-- Expected: RLS enabled for every table; anon has no access; authenticated has SELECT only.
-- Ownership policies use auth.uid(); entitlement reads require the customer's paid, delivered order.
-- Profiles update through auth.updateUser metadata and private.sync_profile(), not direct writes.
-- Admin roles must only be assigned by a trusted backend/operator, never by user metadata.
