-- REVIEW / APPLY MANUALLY after existing catalog, role and inventory migrations.
-- Additive: preserves ShopViaClone22 tables/functions and all manually added products.
begin;
create table public.supplier_connections (
 id uuid primary key, provider text not null, name text not null check(length(name) between 1 and 120),
 base_url text not null, auth_method text not null default 'X-API-Key', enabled boolean not null default false,
 encrypted_key text not null, key_nonce text not null, revision integer not null default 1,
 authorized_products jsonb not null default '{}' check(jsonb_typeof(authorized_products)='object'),
 last_attempt_at timestamptz, last_sync_at timestamptz, last_sync_revision integer not null default 0, last_status text not null default 'Not tested',
 imported_count integer not null default 0, lease_token uuid, lease_until timestamptz,
 running_operation text, next_attempt_at timestamptz, updated_at timestamptz not null default now()
);
alter table public.supplier_connections enable row level security;
-- NO browser access, including administrators. Only Functions after JWT/role verification.
revoke all on public.supplier_connections from public,anon,authenticated;
grant select,insert,update on public.supplier_connections to service_role;
create table public.supplier_feed_categories (
 connection_id uuid not null references public.supplier_connections(id), external_id text not null,
 name text not null check(length(name) between 1 and 120), primary key(connection_id,external_id)
);
create table public.supplier_feed_items (
 connection_id uuid not null references public.supplier_connections(id), external_id text not null,
 external_category_id text not null, name text not null check(length(name) between 1 and 200),
 description text not null check(length(description) between 1 and 10000),
 supplier_cost_minor bigint not null check(supplier_cost_minor between 0 and 99999999900),
 currency text not null check(currency='NGN'), stock_quantity integer not null check(stock_quantity between 0 and 1000000),
 authorization_ref text not null check(length(btrim(authorization_ref)) between 5 and 1000),
 approval text not null default 'pending' check(approval in ('pending','approved','rejected')),
 product_id uuid unique references public.products(id), updated_at timestamptz not null default now(),
 primary key(connection_id,external_id),
 foreign key(connection_id,external_category_id) references public.supplier_feed_categories(connection_id,external_id)
);
alter table public.supplier_feed_categories enable row level security;
alter table public.supplier_feed_items enable row level security;
revoke all on public.supplier_feed_categories,public.supplier_feed_items from public,anon,authenticated;
grant select on public.supplier_feed_categories,public.supplier_feed_items to authenticated;
grant select,insert,update on public.supplier_feed_categories,public.supplier_feed_items to service_role;
create policy feed_categories_admin on public.supplier_feed_categories for select to authenticated using(private.is_admin());
create policy feed_items_admin on public.supplier_feed_items for select to authenticated using(private.is_admin());

create function public.save_supplier_connection(connection_uuid uuid, expected_revision integer, settings jsonb, cipher text default null, nonce text default null)
returns void language plpgsql security definer set search_path='' as $$
declare existing public.supplier_connections;
begin
 -- Serializes create/replace/metadata saves for one connection, preventing lost key replacements.
 perform pg_advisory_xact_lock(hashtextextended(connection_uuid::text,0));
 select * into existing from public.supplier_connections where id=connection_uuid for update;
 if found then
  if existing.revision<>expected_revision then raise exception 'Configuration changed; reload before saving' using errcode='40001'; end if;
  if existing.lease_until>now() then raise exception 'Supplier operation is running' using errcode='55P03'; end if;
 else
  if expected_revision<>0 or cipher is null or nonce is null then raise exception 'New connection requires a key' using errcode='22023'; end if;
 end if;
 insert into public.supplier_connections(id,provider,name,base_url,auth_method,enabled,encrypted_key,key_nonce,authorized_products,last_status)
 values(connection_uuid,settings->>'provider',settings->>'name',settings->>'base_url','X-API-Key',(settings->>'enabled')::boolean,
 coalesce(cipher,existing.encrypted_key),coalesce(nonce,existing.key_nonce),settings->'authorized_products','Configuration saved; test connection')
 on conflict(id) do update set name=excluded.name,base_url=excluded.base_url,provider=excluded.provider,
 enabled=excluded.enabled,encrypted_key=excluded.encrypted_key,key_nonce=excluded.key_nonce,
 authorized_products=excluded.authorized_products,revision=public.supplier_connections.revision+1,
 last_status=excluded.last_status,last_sync_revision=0,updated_at=now();
 -- Invalidates stale stock immediately on replacement/disable/configuration change.
 update public.inventory set available_quantity=0 where product_id in(select product_id from public.supplier_feed_items where connection_id=connection_uuid);
 update public.supplier_feed_items set stock_quantity=0 where connection_id=connection_uuid;
 update public.products set status='inactive' where id in(select product_id from public.supplier_feed_items where connection_id=connection_uuid)
 and (not (settings->>'enabled')::boolean or not (settings->'authorized_products' ?
   (select external_id from public.supplier_feed_items where product_id=public.products.id)));
 update public.supplier_feed_items set approval='pending',stock_quantity=0 where connection_id=connection_uuid
 and not (settings->'authorized_products' ? external_id);
end; $$;

create function public.claim_supplier_connection(connection_uuid uuid, operation text) returns uuid
language plpgsql security definer set search_path='' as $$
declare token uuid=gen_random_uuid();
begin
 if operation not in ('test','categories','sync') then raise exception 'Invalid operation'; end if;
 update public.supplier_connections set lease_token=token,lease_until=now()+interval '5 minutes',
 running_operation=operation,last_attempt_at=now(),last_status='Running '||operation,
 next_attempt_at=now()+case when operation='sync' then interval '60 seconds' else interval '10 seconds' end
 where id=connection_uuid and enabled and (lease_until is null or lease_until<now())
 and (next_attempt_at is null or next_attempt_at<=now());
 if not found then return null; end if;
 return token;
end; $$;

create function public.finish_supplier_connection(connection_uuid uuid, token uuid, snapshot jsonb default null, failure text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare connection public.supplier_connections; entry jsonb; saved public.supplier_feed_items; total integer=0;
begin
 select * into connection from public.supplier_connections where id=connection_uuid for update;
 if not found or connection.lease_token is distinct from token or connection.lease_until<now() then raise exception 'Supplier lease expired'; end if;
 if failure is not null then
  update public.inventory set available_quantity=0 where product_id in(select product_id from public.supplier_feed_items where connection_id=connection_uuid);
  update public.supplier_feed_items set stock_quantity=0 where connection_id=connection_uuid;
  update public.supplier_connections set last_status=left(failure,300),lease_token=null,lease_until=null,
  running_operation=null,next_attempt_at=greatest(next_attempt_at,now()+interval '60 seconds') where id=connection_uuid;
  return 0;
 end if;
 if jsonb_typeof(snapshot->'categories') is distinct from 'array' then raise exception 'Invalid categories'; end if;
 for entry in select * from jsonb_array_elements(snapshot->'categories') loop
  insert into public.supplier_feed_categories(connection_id,external_id,name) values(connection_uuid,entry->>'id',entry->>'name')
  on conflict(connection_id,external_id) do update set name=excluded.name;
 end loop;
 if connection.running_operation='sync' then
  if jsonb_typeof(snapshot->'products') is distinct from 'array' or jsonb_array_length(snapshot->'products')>500 then raise exception 'Invalid catalog'; end if;
  update public.inventory set available_quantity=0 where product_id in(select product_id from public.supplier_feed_items where connection_id=connection_uuid);
  update public.products set status='inactive' where id in(select s.product_id from public.supplier_feed_items s where s.connection_id=connection_uuid
   and not exists(select 1 from jsonb_array_elements(snapshot->'products') p where p->>'id'=s.external_id));
  update public.supplier_feed_items s set approval='pending',stock_quantity=0 where s.connection_id=connection_uuid
   and not exists(select 1 from jsonb_array_elements(snapshot->'products') p where p->>'id'=s.external_id);
  for entry in select * from jsonb_array_elements(snapshot->'products') loop
   if connection.authorized_products->>(entry->>'id') is distinct from entry->>'authorization_ref' then raise exception 'Resale authorization required'; end if;
   insert into public.supplier_feed_items(connection_id,external_id,external_category_id,name,description,supplier_cost_minor,currency,stock_quantity,authorization_ref)
   values(connection_uuid,entry->>'id',entry->>'category_id',entry->>'name',entry->>'description',(entry->>'cost_minor')::bigint,
   entry->>'currency',(entry->>'stock')::integer,entry->>'authorization_ref')
   on conflict(connection_id,external_id) do update set external_category_id=excluded.external_category_id,name=excluded.name,
   description=excluded.description,supplier_cost_minor=excluded.supplier_cost_minor,currency=excluded.currency,
   stock_quantity=excluded.stock_quantity,authorization_ref=excluded.authorization_ref,updated_at=now(),
   approval=case when public.supplier_feed_items.name<>excluded.name or public.supplier_feed_items.description<>excluded.description
    or public.supplier_feed_items.external_category_id<>excluded.external_category_id then 'pending' else public.supplier_feed_items.approval end
   returning * into saved;
   if saved.product_id is not null then
    if saved.approval='approved' then
     update public.inventory set available_quantity=saved.stock_quantity where product_id=saved.product_id;
    else update public.products set status='inactive' where id=saved.product_id; end if;
   end if;
   -- Independently configured retail prices are NEVER overwritten by supplier cost refresh.
   total=total+1;
  end loop;
  update public.supplier_connections set last_sync_at=now(),last_sync_revision=revision,imported_count=total where id=connection_uuid;
 end if;
 update public.supplier_connections set last_status=case when running_operation='sync' then total::text||' eligible listings synchronized; approval required for pending listings'
 else 'Connected; categories validated' end,lease_token=null,lease_until=null,running_operation=null where id=connection_uuid;
 return total;
end; $$;

create function public.approve_supplier_feed_item(connection_uuid uuid, external_product_id text, category_uuid uuid, selling_price_minor bigint, delivery_method text)
returns uuid language plpgsql security definer set search_path='' as $$
declare listing public.supplier_feed_items; connection public.supplier_connections; saved uuid;
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into connection from public.supplier_connections where id=connection_uuid for share;
 if not found or not connection.enabled or connection.last_sync_at is null or connection.last_sync_at<now()-interval '1 hour' or connection.last_sync_revision<>connection.revision then raise exception 'Refresh enabled supplier before approval'; end if;
 select * into listing from public.supplier_feed_items where connection_id=connection_uuid and external_id=external_product_id for update;
 if not found or listing.updated_at<connection.last_sync_at or connection.authorized_products->>listing.external_id is distinct from listing.authorization_ref then raise exception 'Fresh authorized listing required'; end if;
 saved=coalesce(listing.product_id,gen_random_uuid());
 insert into public.products(id,category_id,slug,name,description,price_minor,currency,supplier_name,authorized_resale,status,delivery_type)
 values(saved,category_uuid,'supplier-'||saved::text,listing.name,listing.description,selling_price_minor,'NGN',connection.name,true,'active',delivery_method)
 on conflict(id) do update set category_id=excluded.category_id,name=excluded.name,description=excluded.description,
 price_minor=excluded.price_minor,supplier_name=excluded.supplier_name,authorized_resale=true,status='active',delivery_type=excluded.delivery_type;
 insert into public.inventory(product_id,available_quantity) values(saved,listing.stock_quantity)
 on conflict(product_id) do update set available_quantity=excluded.available_quantity;
 update public.supplier_feed_items set product_id=saved,approval='approved' where connection_id=connection_uuid and external_id=external_product_id;
 return saved;
end; $$;
create function public.reject_supplier_feed_item(connection_uuid uuid, external_product_id text) returns void
language plpgsql security definer set search_path='' as $$
declare linked uuid;
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 -- Same connection-first lock order as sync/approval prevents stale publish races.
 perform 1 from public.supplier_connections where id=connection_uuid for share;
 update public.supplier_feed_items set approval='rejected' where connection_id=connection_uuid and external_id=external_product_id returning product_id into linked;
 update public.products set status='inactive' where id=linked;
 update public.inventory set available_quantity=0 where product_id=linked;
end; $$;
revoke all on function public.save_supplier_connection(uuid,integer,jsonb,text,text),public.claim_supplier_connection(uuid,text),public.finish_supplier_connection(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_supplier_connection(uuid,integer,jsonb,text,text),public.claim_supplier_connection(uuid,text),public.finish_supplier_connection(uuid,uuid,jsonb,text) to service_role;
revoke all on function public.approve_supplier_feed_item(uuid,text,uuid,bigint,text),public.reject_supplier_feed_item(uuid,text) from public,anon,authenticated;
grant execute on function public.approve_supplier_feed_item(uuid,text,uuid,bigint,text),public.reject_supplier_feed_item(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
