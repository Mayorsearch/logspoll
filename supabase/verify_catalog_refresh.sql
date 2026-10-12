-- Run as SQL Editor owner after applying 202610120001_catalog_refresh_pricing.sql.
-- Read-only: no catalog changes, writes, or supplier/network calls.
begin read only;
do $$ begin
 if public.supplier_effective_price(10000,12345,2500)<>12345 or public.supplier_effective_price(20000,12345,2500)<>12345 then raise exception 'Manual override changed with supplier cost'; end if;
 if public.supplier_effective_price(10000,0,2500)<>0 then raise exception 'Zero override lost'; end if;
 if public.supplier_effective_price(10001,null,1250)<>11252 then raise exception 'Automatic price must round up to integer kobo'; end if;
 if public.supplier_effective_price(20000,null,2500)<>25000 then raise exception 'Automatic price failed to follow new supplier cost'; end if;
 if has_function_privilege('anon','public.admin_supplier_catalog(uuid,text,text,jsonb)','EXECUTE') then raise exception 'Anonymous catalog write permitted'; end if;
 if has_function_privilege('authenticated','public.finish_supplier_connection(uuid,uuid,jsonb,text)','EXECUTE') then raise exception 'Browser sync commit permitted'; end if;
 if has_function_privilege('authenticated','public.finish_supplier_connection_v1(uuid,uuid,jsonb,text)','EXECUTE') then raise exception 'Browser legacy sync commit permitted'; end if;
 if has_function_privilege('authenticated','public.approve_supplier_feed_item_v1(uuid,text,uuid,bigint,text,text)','EXECUTE') then raise exception 'Browser approval bypass permitted'; end if;
 if has_function_privilege('authenticated','public.approve_supplier_feed_item(uuid,text,uuid,bigint,text)','EXECUTE') then raise exception 'Browser five-argument approval bypass permitted'; end if;
 if not has_function_privilege('authenticated','public.approve_supplier_feed_item(uuid,text,uuid,bigint,text,text)','EXECUTE') then raise exception 'Reviewed approval unavailable'; end if;
 if has_table_privilege('anon','public.storefront_product_images','SELECT') then raise exception 'Anonymous supplier image access permitted'; end if;
 if has_table_privilege('authenticated','public.supplier_connections','SELECT') then raise exception 'Browser credential storage access permitted'; end if;
 if not (select relrowsecurity from pg_class where oid='public.supplier_feed_subcategories'::regclass) then raise exception 'Subcategory RLS missing'; end if;
 if has_table_privilege('anon','public.storefront_categories','SELECT') or has_table_privilege('anon','public.storefront_subcategories','SELECT') then raise exception 'Anonymous taxonomy access permitted'; end if;
 if not has_table_privilege('authenticated','public.storefront_subcategories','SELECT') then raise exception 'Customer taxonomy projection unavailable'; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='storefront_subcategories'
  and column_name not in ('category_id','category_slug','slug','name','product_count')) then raise exception 'Unexpected taxonomy fields exposed'; end if;
 if not exists(select 1 from pg_class where oid='public.storefront_subcategories'::regclass and reloptions @> array['security_barrier=true']) then raise exception 'Taxonomy security barrier missing'; end if;
 if exists(select 1 from public.supplier_feed_subcategories where slug is null or name is null) then raise exception 'Invalid subcategory metadata'; end if;
end $$;
-- Report current pricing modes; automatic rows must match the calculation after a
-- successful sync. Pending rows may retain their previous published price by design.
select count(*) filter(where f.selling_price_override_minor is null) as automatic_products,
 count(*) filter(where f.selling_price_override_minor is not null) as override_products,
 count(*) filter(where p.price_minor<>public.supplier_effective_price(f.supplier_cost_minor,f.selling_price_override_minor,c.markup_basis_points)) as pricing_mismatches
from public.supplier_feed_items f join public.products p on p.id=f.product_id
join public.supplier_feed_categories c on c.connection_id=f.connection_id and c.external_id=f.external_category_id
where f.approval='approved';

-- Impersonate an existing non-admin customer only inside this read-only transaction.
-- No auth records are changed. If no customer exists, report rather than fake coverage.
select set_config('request.jwt.claims',jsonb_build_object('sub',u.id,'role','authenticated')::text,true)
from auth.users u where not exists(select 1 from public.user_roles r where r.user_id=u.id and r.role='admin')
order by u.created_at limit 1;
set local role authenticated;
do $$ begin
 if auth.uid() is null or private.is_admin() then
  raise notice 'Customer-role data verification skipped: no non-admin customer selected';
 else
  if exists(select 1 from public.supplier_feed_items) or exists(select 1 from public.supplier_feed_categories)
   or exists(select 1 from public.supplier_feed_subcategories) then raise exception 'Restricted source rows exposed to customer'; end if;
  if exists(select 1 from public.storefront_subcategories s where s.product_count<1
   or not exists(select 1 from public.storefront_categories c where c.slug=s.category_slug and c.product_count>0)) then raise exception 'Unpublished taxonomy exposed'; end if;
 end if;
end $$;
select category_slug,slug,name,product_count from public.storefront_subcategories order by category_slug,name;
rollback;
