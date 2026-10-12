-- READ ONLY. Run in the EXISTING project's SQL Editor and inspect every result.
-- No account identities, customer rows or credentials are selected.
begin transaction read only;
select current_database() as database_name, current_user as operator;
with expected(name) as (values
 ('categories'),('products'),('inventory'),('storefront_products'),('storefront_categories'),
 ('user_roles'),('audit_logs'),('profiles'),('orders'),('order_items'),('product_entitlements'),
 ('notifications'),('reviews'),('api_integrations'),('support_tickets'),('website_settings'),
 ('supplier_categories'),('supplier_catalog'),('supplier_sync_state')
)
select e.name as expected_public_object, c.oid is not null as exists_in_public,
 c.relkind, c.relrowsecurity as rls_enabled, c.reloptions as view_options
from expected e left join pg_namespace n on n.nspname='public'
left join pg_class c on c.relnamespace=n.oid and c.relname=e.name
order by e.name;

-- Locate a same-named relation in a different schema; do not guess or rename it.
select n.nspname as schema_name,c.relname,c.relkind
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relname in ('products','categories','orders','profiles','reviews','user_roles')
and n.nspname not in ('pg_catalog','information_schema') order by c.relname,n.nspname;

select table_name,column_name,data_type,is_nullable
from information_schema.columns where table_schema='public'
and table_name in ('products','categories','inventory','orders','reviews','user_roles','profiles')
order by table_name,ordinal_position;
select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' order by tablename,policyname;
select table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated')
order by table_name,grantee,privilege_type;
select n.nspname as schema_name,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosecdef as security_definer,p.proconfig as configuration,p.proacl as grants
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in
 ('storefront_search','admin_save_product','submit_review','moderate_review','published_reviews',
 'is_admin','sync_profile','admin_fulfill_order','claim_supplier_sync','sync_supplier_catalog')
order by n.nspname,p.proname;
select to_regclass('supabase_migrations.schema_migrations') as migration_history_table;
-- If the preceding result is non-null, run separately:
-- select version from supabase_migrations.schema_migrations order by version;
commit;
