-- MANUAL REVIEW REQUIRED. Additive follow-up for the already-applied 202610110002 migration.
-- Use a database backup and apply in Supabase SQL Editor. Does not alter existing products.
-- Public product descriptions must be verified by an admin, not invented from missing supplier metadata.
begin;

-- The old five-argument approval function must no longer be callable by browser sessions.
revoke execute on function public.approve_supplier_feed_item(uuid,text,uuid,bigint,text)
  from public,anon,authenticated;

create function public.approve_supplier_feed_item(
  connection_uuid uuid, external_product_id text, category_uuid uuid,
  selling_price_minor bigint, delivery_method text, reviewed_description text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  listing public.supplier_feed_items;
  connection public.supplier_connections;
  saved uuid;
  clean_description text := btrim(reviewed_description);
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if clean_description is null or length(clean_description) < 20
    or length(clean_description) > 10000
    or clean_description ~ '[[:cntrl:]]'
    or clean_description ~* 'ypg_[0-9a-f]{48}' then
    raise exception 'Verified non-sensitive product description required' using errcode='22023';
  end if;
  if selling_price_minor is null or selling_price_minor < 0 or selling_price_minor > 99999999900 then
    raise exception 'Invalid selling price' using errcode='22023';
  end if;
  select * into connection from public.supplier_connections
    where id = connection_uuid for share;
  if not found or not connection.enabled or connection.last_sync_at is null
    or connection.last_sync_at < now() - interval '1 hour'
    or connection.last_sync_revision <> connection.revision then
    raise exception 'Refresh enabled supplier before approval';
  end if;
  select * into listing from public.supplier_feed_items
    where connection_id = connection_uuid and external_id = external_product_id
    for update;
  if not found or listing.updated_at < connection.last_sync_at
    or connection.authorized_products ->> listing.external_id is distinct from listing.authorization_ref
    or listing.stock_quantity < 1
    or listing.approval = 'rejected' then
    raise exception 'Fresh in-stock authorized listing required';
  end if;
  saved := coalesce(listing.product_id,gen_random_uuid());
  insert into public.products(
    id,category_id,slug,name,description,price_minor,currency,
    supplier_name,authorized_resale,status,delivery_type
  ) values (
    saved,category_uuid,'supplier-'||saved::text,listing.name,clean_description,
    selling_price_minor,'NGN',connection.name,true,'active',delivery_method
  ) on conflict(id) do update set
    category_id=excluded.category_id,name=excluded.name,
    description=excluded.description,price_minor=excluded.price_minor,
    supplier_name=excluded.supplier_name,authorized_resale=true,
    status='active',delivery_type=excluded.delivery_type;
  insert into public.inventory(product_id,available_quantity)
    values(saved,listing.stock_quantity)
    on conflict(product_id) do update set available_quantity=excluded.available_quantity;
  update public.supplier_feed_items set product_id=saved,approval='approved'
    where connection_id=connection_uuid and external_id=external_product_id;
  return saved;
end; $$;

revoke all on function public.approve_supplier_feed_item(uuid,text,uuid,bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.approve_supplier_feed_item(uuid,text,uuid,bigint,text,text)
  to authenticated;
notify pgrst,'reload schema';
commit;
