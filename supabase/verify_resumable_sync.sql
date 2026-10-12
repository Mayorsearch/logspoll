-- READ ONLY. Run as the SQL Editor/database owner in STAGING, then production
-- only after migration approval. Never returns credentials or staged payloads.
select to_regclass('public.supplier_catalog_jobs') as jobs,
 to_regclass('public.supplier_catalog_rows') as staged_rows,
 to_regprocedure('public.claim_supplier_sync_batch(uuid,uuid)') as claim_rpc,
 to_regprocedure('public.commit_supplier_sync_batch(uuid,uuid,uuid,jsonb)') as commit_rpc,
 to_regprocedure('public.finish_supplier_connection_before_batches(uuid,uuid,jsonb,text)') as retained_finalizer;
select c.relname,c.relrowsecurity,
 has_table_privilege('anon',c.oid,'select') as anon_read,
 has_table_privilege('authenticated',c.oid,'select') as browser_read,
 has_table_privilege('service_role',c.oid,'select') as backend_read
from pg_class c where c.oid in(to_regclass('public.supplier_catalog_jobs'),to_regclass('public.supplier_catalog_rows'));
select p.proname,p.prosecdef,
 has_function_privilege('anon',p.oid,'execute') as anon_execute,
 has_function_privilege('authenticated',p.oid,'execute') as browser_execute,
 has_function_privilege('service_role',p.oid,'execute') as backend_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('claim_supplier_sync_batch','commit_supplier_sync_batch','finish_supplier_connection');
select provider,enabled,running_operation,lease_until<now() as expired,last_sync_at,imported_count from public.supplier_connections;
select phase,count(*) as jobs,sum(scanned) as scanned from public.supplier_catalog_jobs group by phase;
select approval,count(*) as feed_records,count(product_id) as linked_products from public.supplier_feed_items group by approval;
select count(*) as stale_positive_inventory from public.inventory i
where i.available_quantity>0 and not private.supplier_stock_current(i.product_id);
select policyname,roles,qual from pg_policies where schemaname='public' and tablename in('supplier_catalog_jobs','supplier_catalog_rows','inventory');
