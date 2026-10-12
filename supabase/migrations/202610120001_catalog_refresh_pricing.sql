-- REVIEW/APPLY MANUALLY after 202610110002 and 003. No credentials or existing prices are replaced.
-- Existing retail prices become explicit overrides. New approvals default to automatic pricing.
begin;
do $$ begin
 if to_regprocedure('public.approve_supplier_feed_item(uuid,text,uuid,bigint,text,text)') is null then
  raise exception 'Apply 202610110002 and 202610110003 before this migration';
 end if;
end $$;
alter table public.supplier_feed_categories add column if not exists slug text;
alter table public.supplier_feed_categories add column if not exists markup_basis_points integer not null default 0 check(markup_basis_points between 0 and 100000);
alter table public.supplier_feed_items add column if not exists selling_price_override_minor bigint check(selling_price_override_minor between 0 and 99999999900);
alter table public.supplier_feed_items add column if not exists publication_enabled boolean not null default true;
alter table public.supplier_feed_items add column if not exists catalog_metadata jsonb not null default '{}' check(jsonb_typeof(catalog_metadata)='object');
alter table public.products add column if not exists supplier_image_urls jsonb not null default '[]' check(jsonb_typeof(supplier_image_urls)='array');
create or replace view public.storefront_product_images with (security_invoker=true) as
select p.id,p.supplier_image_urls from public.products p join public.categories c on c.id=p.category_id
where p.status='active' and p.authorized_resale and c.active;
revoke all on public.storefront_product_images from public,anon,authenticated;
grant select on public.storefront_product_images to authenticated,service_role;
-- Only initialize existing records once, including intentional zero prices.
do $$ begin
 if to_regprocedure('public.finish_supplier_connection_v1(uuid,uuid,jsonb,text)') is null then
  update public.supplier_feed_items f set selling_price_override_minor=p.price_minor,publication_enabled=(p.status='active') from public.products p where p.id=f.product_id;
  alter function public.finish_supplier_connection(uuid,uuid,jsonb,text) rename to finish_supplier_connection_v1;
 end if;
end $$;
create table if not exists public.supplier_feed_subcategories (
 connection_id uuid not null, parent_external_id text not null, external_id text not null,
 slug text not null, name text not null check(length(name) between 1 and 120),
 primary key(connection_id,parent_external_id,external_id),
 foreign key(connection_id,parent_external_id) references public.supplier_feed_categories(connection_id,external_id)
);
alter table public.supplier_feed_subcategories enable row level security;
revoke all on public.supplier_feed_subcategories from public,anon,authenticated;
grant select on public.supplier_feed_subcategories to authenticated;
grant all on public.supplier_feed_subcategories to service_role;
drop policy if exists supplier_subcategory_admin on public.supplier_feed_subcategories;
create policy supplier_subcategory_admin on public.supplier_feed_subcategories for select to authenticated using(private.is_admin());

-- Intentionally owner-evaluated projection: feed RLS stays admin-only. Only taxonomy
-- attached to approved, published, authorized products is exposed; never feed IDs,
-- supplier costs, authorization evidence, connection settings or raw metadata.
create or replace view public.storefront_subcategories with (security_barrier=true) as
select c.id as category_id,c.slug as category_slug,s.slug,s.name,count(distinct p.id) as product_count
from public.supplier_feed_subcategories s
join public.supplier_feed_items f on f.connection_id=s.connection_id
 and f.external_category_id=s.parent_external_id and f.catalog_metadata->>'subcategory_id'=s.external_id
join public.products p on p.id=f.product_id
join public.categories c on c.id=p.category_id
where auth.uid() is not null and f.approval='approved' and f.publication_enabled
 and p.status='active' and p.authorized_resale and c.active
group by c.id,c.slug,s.slug,s.name;
revoke all on public.storefront_subcategories from public,anon,authenticated;
grant select on public.storefront_subcategories to authenticated;

create or replace function public.supplier_effective_price(cost bigint, price_override bigint, markup integer)
returns bigint language plpgsql immutable set search_path='' as $$
declare result numeric;
begin
 if cost is null or cost<0 or cost>99999999900 or markup is null or markup<0 or markup>100000 or price_override<0 or price_override>99999999900 then raise exception 'Invalid price'; end if;
 result=coalesce(price_override,ceil(cost::numeric*(10000+markup)/10000));
 if result>99999999900 then raise exception 'Effective price exceeds supported range'; end if;
 return result::bigint;
end $$;
revoke all on function public.supplier_effective_price(bigint,bigint,integer) from public,anon,authenticated;
grant execute on function public.supplier_effective_price(bigint,bigint,integer) to service_role;

-- Existing product editor remains authoritative: an authenticated admin price edit sets an override.
create or replace function public.capture_supplier_price_override()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.is_admin() then
  update public.supplier_feed_items set selling_price_override_minor=new.price_minor where product_id=new.id;
 end if;
 return new;
end $$;
revoke all on function public.capture_supplier_price_override() from public,anon,authenticated;
drop trigger if exists capture_supplier_price_override on public.products;
create trigger capture_supplier_price_override after update of price_minor on public.products for each row execute function public.capture_supplier_price_override();
-- Approval copies image URLs only; pricing mode is selected by the approval RPC.
create or replace function public.initialize_supplier_price_override()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.product_id is not null and new.approval='approved' then
  update public.products set supplier_image_urls=coalesce(new.catalog_metadata->'image_urls','[]'::jsonb) where id=new.product_id;
 end if;
 return new;
end $$;
revoke all on function public.initialize_supplier_price_override() from public,anon,authenticated;
drop trigger if exists initialize_supplier_price_override on public.supplier_feed_items;
create trigger initialize_supplier_price_override before update of product_id,approval on public.supplier_feed_items for each row execute function public.initialize_supplier_price_override();

-- Keep the previous approval checks intact. A supplied price is an explicit override
-- (including zero); NULL means automatic for new products, preserve mode for existing.
do $$ begin
 if to_regprocedure('public.approve_supplier_feed_item_v1(uuid,text,uuid,bigint,text,text)') is null then
  alter function public.approve_supplier_feed_item(uuid,text,uuid,bigint,text,text) rename to approve_supplier_feed_item_v1;
 end if;
end $$;
revoke all on function public.approve_supplier_feed_item_v1(uuid,text,uuid,bigint,text,text) from public,anon,authenticated;
create or replace function public.approve_supplier_feed_item(
 connection_uuid uuid,external_product_id text,category_uuid uuid,
 selling_price_minor bigint,delivery_method text,reviewed_description text
) returns uuid language plpgsql security definer set search_path='' as $$
declare listing public.supplier_feed_items; connection public.supplier_connections; markup integer; price_override bigint; saved uuid;
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into connection from public.supplier_connections where id=connection_uuid for update;
 if not found or connection.lease_until>now() then raise exception 'Supplier unavailable or sync running'; end if;
 select * into listing from public.supplier_feed_items where connection_id=connection_uuid and external_id=external_product_id for update;
 if not found or listing.catalog_metadata->>'status' in ('inactive','unavailable','discontinued','sold_out') then raise exception 'Fresh available listing required'; end if;
 select markup_basis_points into markup from public.supplier_feed_categories where connection_id=connection_uuid and external_id=listing.external_category_id;
 price_override=coalesce(selling_price_minor,listing.selling_price_override_minor);
 saved=public.approve_supplier_feed_item_v1(connection_uuid,external_product_id,category_uuid,
  public.supplier_effective_price(listing.supplier_cost_minor,price_override,markup),delivery_method,reviewed_description);
 -- Undo the admin editor trigger's capture when the approval used automatic pricing.
 update public.supplier_feed_items set selling_price_override_minor=price_override
  where connection_id=connection_uuid and external_id=external_product_id;
 -- Reapproval must not undo a previous explicit publication disable.
 if not listing.publication_enabled then
  update public.products set status='inactive' where id=saved;
  update public.inventory set available_quantity=0 where product_id=saved;
 end if;
 return saved;
end $$;
revoke all on function public.approve_supplier_feed_item(uuid,text,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.approve_supplier_feed_item(uuid,text,uuid,bigint,text,text) to authenticated;

create or replace function public.finish_supplier_connection(connection_uuid uuid, token uuid, snapshot jsonb default null, failure text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare total integer; entry jsonb; was_sync boolean;
begin
 select running_operation='sync' into was_sync from public.supplier_connections where id=connection_uuid for update;
 total=public.finish_supplier_connection_v1(connection_uuid,token,snapshot,failure);
 if failure is not null then
  if snapshot ? 'retry_after_ms' then
   update public.supplier_connections set next_attempt_at=greatest(next_attempt_at,now()+make_interval(secs=>least(greatest((snapshot->>'retry_after_ms')::double precision/1000,60),86400))) where id=connection_uuid;
  end if;
  return total;
 end if;
 for entry in select * from jsonb_array_elements(snapshot->'categories') loop
  update public.supplier_feed_categories set slug=entry->>'slug' where connection_id=connection_uuid and external_id=entry->>'id';
 end loop;
 -- Atomic replacement only after the complete validated category traversal.
 if jsonb_typeof(snapshot->'subcategories')='array' and snapshot->>'subcategories_complete'='true' then
  delete from public.supplier_feed_subcategories where connection_id=connection_uuid;
  for entry in select * from jsonb_array_elements(snapshot->'subcategories') loop
   insert into public.supplier_feed_subcategories(connection_id,parent_external_id,external_id,slug,name)
   values(connection_uuid,entry->>'parent_id',entry->>'id',entry->>'slug',entry->>'name');
  end loop;
 end if;
 if was_sync then
  for entry in select * from jsonb_array_elements(snapshot->'products') loop
   update public.supplier_feed_items set catalog_metadata=jsonb_strip_nulls(jsonb_build_object('slug',entry->>'slug','image_url',entry->>'image_url','status',entry->>'supplier_status','subcategory_id',entry->>'subcategory_id','sold_count',entry->'sold_count','image_urls',entry->'image_urls'))
   where connection_id=connection_uuid and external_id=entry->>'id';
  end loop;
  update public.products p set price_minor=public.supplier_effective_price(f.supplier_cost_minor,f.selling_price_override_minor,c.markup_basis_points)
  from public.supplier_feed_items f join public.supplier_feed_categories c on c.connection_id=f.connection_id and c.external_id=f.external_category_id
  where f.connection_id=connection_uuid and f.product_id=p.id and f.approval='approved';
  update public.products p set supplier_image_urls=coalesce(f.catalog_metadata->'image_urls','[]'::jsonb)
  from public.supplier_feed_items f where f.connection_id=connection_uuid and f.product_id=p.id and f.approval='approved';
  update public.products p set status='inactive' from public.supplier_feed_items f where f.connection_id=connection_uuid and f.product_id=p.id and not f.publication_enabled;
  update public.inventory i set available_quantity=0 from public.supplier_feed_items f where f.connection_id=connection_uuid and f.product_id=i.product_id and (not f.publication_enabled or f.catalog_metadata->>'status' in ('inactive','unavailable','discontinued','sold_out'));
 end if;
 return total;
end $$;
revoke all on function public.finish_supplier_connection(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_supplier_connection(uuid,uuid,jsonb,text) to service_role;

create or replace function public.admin_supplier_catalog(connection_uuid uuid, external_product_id text, operation text, settings jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare connection public.supplier_connections; listing public.supplier_feed_items; markup integer; amount bigint; publish boolean; public_description text;
begin
 if not private.is_admin() then raise exception 'Administrator required'; end if;
 select * into connection from public.supplier_connections where id=connection_uuid for update;
 if not found then raise exception 'Unknown supplier'; end if;
 if connection.lease_until>now() then raise exception 'Sync running; retry after completion'; end if;
 if operation='markup' then
  markup=(settings->>'basis_points')::integer;
  if markup is null or markup<0 or markup>100000 then raise exception 'Invalid markup'; end if;
  update public.supplier_feed_categories set markup_basis_points=markup where connection_id=connection_uuid and external_id=settings->>'category_id';
  if not found then raise exception 'Unknown supplier category'; end if;
  -- Do not let the existing editor trigger convert recalculated prices into overrides.
  for listing in select * from public.supplier_feed_items where connection_id=connection_uuid and external_category_id=settings->>'category_id' and selling_price_override_minor is null and approval='approved' for update loop
   update public.products set price_minor=public.supplier_effective_price(listing.supplier_cost_minor,null,markup) where id=listing.product_id;
   update public.supplier_feed_items set selling_price_override_minor=null where connection_id=connection_uuid and external_id=listing.external_id;
  end loop;
  return;
 end if;
 select * into listing from public.supplier_feed_items where connection_id=connection_uuid and external_id=external_product_id for update;
 if not found or listing.product_id is null then raise exception 'Approve the listing first'; end if;
 if operation in ('price','auto') then
  amount=case when operation='price' then (settings->>'price_minor')::bigint else null end;
  if operation='price' and (amount is null or amount<0 or amount>99999999900) then raise exception 'Invalid selling price'; end if;
  select markup_basis_points into markup from public.supplier_feed_categories where connection_id=connection_uuid and external_id=listing.external_category_id;
  update public.products set price_minor=public.supplier_effective_price(listing.supplier_cost_minor,amount,markup) where id=listing.product_id;
  update public.supplier_feed_items set selling_price_override_minor=amount where connection_id=connection_uuid and external_id=external_product_id;
 elsif operation='publication' then
  publish=(settings->>'enabled')::boolean;
  if publish is null then raise exception 'Publication status required'; end if;
  if publish and (not connection.enabled or connection.last_sync_at is null or connection.last_sync_at<now()-interval '1 hour' or connection.last_sync_revision<>connection.revision or listing.updated_at<connection.last_sync_at or listing.approval<>'approved' or connection.authorized_products->>listing.external_id is distinct from listing.authorization_ref or listing.stock_quantity<1 or listing.catalog_metadata->>'status' in ('inactive','unavailable','discontinued','sold_out')) then raise exception 'Fresh approved authorized stock required'; end if;
  update public.products set status=case when publish then 'active' else 'inactive' end where id=listing.product_id and authorized_resale;
  update public.inventory set available_quantity=case when publish then listing.stock_quantity else 0 end where product_id=listing.product_id;
  update public.supplier_feed_items set publication_enabled=publish where connection_id=connection_uuid and external_id=external_product_id;
 elsif operation='description' then
  public_description=btrim(settings->>'description');
  if public_description is null or length(public_description)<20 or length(public_description)>10000 or regexp_replace(public_description,E'[\n\r\t]','','g') ~ '[[:cntrl:]]' or public_description ~ 'ypg_[a-fA-F0-9]{48}' then raise exception 'Verified non-sensitive description required'; end if;
  update public.products set description=public_description where id=listing.product_id;
 else raise exception 'Unsupported catalog operation'; end if;
end $$;
revoke all on function public.admin_supplier_catalog(uuid,text,text,jsonb) from public,anon;
grant execute on function public.admin_supplier_catalog(uuid,text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
