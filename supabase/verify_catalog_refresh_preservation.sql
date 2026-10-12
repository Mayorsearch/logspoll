-- Run BEFORE and AFTER migration as SQL Editor owner, with sync/admin writes paused.
-- Compare all row counts and fingerprints. Every value must be identical.
-- No rows, credentials or customer details are returned. This stores nothing.
begin read only;
select 'products' as scope,count(*) as row_count,
 md5(coalesce(string_agg(jsonb_build_array(id,category_id,slug,name,description,price_minor,currency,
  status,authorized_resale,delivery_type,image_path)::text,E'\n' order by id),'')) as fingerprint
from public.products
union all
select 'inventory',count(*),md5(coalesce(string_agg(to_jsonb(i)::text,E'\n' order by product_id),'')) from public.inventory i
union all
select 'supplier approvals',count(*),md5(coalesce(string_agg(jsonb_build_array(connection_id,external_id,product_id,approval,stock_quantity)::text,
 E'\n' order by connection_id,external_id),'')) from public.supplier_feed_items
union all
select 'orders',count(*),md5(coalesce(string_agg(to_jsonb(o)::text,E'\n' order by id),'')) from public.orders o
union all
select 'order items',count(*),md5(coalesce(string_agg(to_jsonb(o)::text,E'\n' order by id),'')) from public.order_items o;
-- Optional payment ledger: check only if its independent migration is applied.
do $$ declare table_name text; rows_count bigint; fingerprint text; begin
 foreach table_name in array array['bachs_sandbox_orders','bachs_sandbox_events','bachs_sandbox_fulfillment_jobs'] loop
  if to_regclass('public.'||table_name) is not null then
   execute format('select count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E''\n'' order by to_jsonb(t)::text),'''')) from public.%I t',table_name)
    into rows_count,fingerprint;
   raise notice '%: rows=%, fingerprint=%',table_name,rows_count,fingerprint;
  end if;
 end loop;
end $$;
rollback;
