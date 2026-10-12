-- REVIEW ONLY: additive schema proposal. Not executed by the app or deployment.
begin;
create table public.support_tickets (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 subject text not null check(length(btrim(subject)) between 1 and 200), message text not null check(length(btrim(message)) between 10 and 2000),
 status text not null default 'open' check(status in ('open','in_progress','resolved')), reply text not null default '' check(length(reply)<=2000), created_at timestamptz not null default now()
);
alter table public.support_tickets enable row level security;
create policy ticket_read on public.support_tickets for select to authenticated using(user_id=(select auth.uid()) or private.is_admin());
create policy ticket_insert on public.support_tickets for insert to authenticated with check(user_id=(select auth.uid()) and status='open' and reply='');
create policy ticket_admin_update on public.support_tickets for update to authenticated using(private.is_admin()) with check(private.is_admin());
revoke all on public.support_tickets from public,anon,authenticated;
grant select on public.support_tickets to authenticated;
grant insert(user_id,subject,message),update(status,reply) on public.support_tickets to authenticated;
create table public.website_settings(key text primary key check(key='general'),value jsonb not null check(jsonb_typeof(value)='object'));
alter table public.website_settings enable row level security;
create policy settings_admin on public.website_settings for all to authenticated using(private.is_admin()) with check(private.is_admin());
revoke all on public.website_settings from public,anon,authenticated;
grant select,insert,update on public.website_settings to authenticated;
create table public.supplier_categories(provider text not null check(provider='shopviaclone22'),external_id text not null check(external_id ~ '^[0-9]{1,20}$'),name text not null check(length(name) between 1 and 120),primary key(provider,external_id));
create table public.supplier_catalog(
 provider text not null check(provider='shopviaclone22'),external_id text not null check(external_id ~ '^[0-9]{1,20}$'), external_category_id text not null,
 name text not null check(length(name) between 1 and 200),description text not null check(length(description) between 1 and 10000),
 supplier_cost_minor bigint not null check(supplier_cost_minor between 0 and 99999999900),currency text not null check(currency in ('NGN','USD')),
 stock_quantity integer not null check(stock_quantity between 0 and 1000000),authorization_ref text not null check(length(btrim(authorization_ref)) between 5 and 1000),
 approval text not null default 'pending' check(approval in ('pending','approved','rejected')),product_id uuid unique references public.products(id),updated_at timestamptz not null default now(),primary key(provider,external_id)
);
create table public.supplier_sync_state(provider text primary key check(provider='shopviaclone22'),last_attempt_at timestamptz,last_success_at timestamptz,message text not null default 'Not synchronized');
insert into public.supplier_sync_state(provider) values('shopviaclone22');
alter table public.supplier_categories enable row level security;
alter table public.supplier_catalog enable row level security;
alter table public.supplier_sync_state enable row level security;
create policy supplier_categories_admin on public.supplier_categories for select to authenticated using(private.is_admin());
create policy supplier_catalog_admin on public.supplier_catalog for select to authenticated using(private.is_admin());
create policy supplier_sync_admin on public.supplier_sync_state for select to authenticated using(private.is_admin());
revoke all on public.supplier_categories,public.supplier_catalog,public.supplier_sync_state from public,anon,authenticated;
grant select on public.supplier_categories,public.supplier_catalog,public.supplier_sync_state to authenticated;
create function public.claim_supplier_sync() returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 update public.supplier_sync_state set last_attempt_at=now(),message='Synchronization running' where provider='shopviaclone22' and (last_attempt_at is null or last_attempt_at<now()-interval '60 seconds');
 return found;
end; $$;
create function public.record_supplier_sync_failure() returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 update public.supplier_sync_state set message='Synchronization failed; inspect configuration and verified response schema.' where provider='shopviaclone22';
end; $$;
create function public.sync_supplier_catalog(catalog jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare entry jsonb; existing public.supplier_catalog; total integer=0;
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 if jsonb_typeof(catalog->'products') is distinct from 'array' or jsonb_array_length(catalog->'products')>500 then raise exception 'Invalid catalog'; end if;
 perform pg_advisory_xact_lock(hashtextextended('logspoll-supplier-sync',0));
 -- Disable unavailable listings before refreshing. No stale stock remains sellable after a successful snapshot sync.
 update public.inventory set available_quantity=0 where product_id in(select product_id from public.supplier_catalog where provider='shopviaclone22');
 update public.products set status='inactive' where id in(select s.product_id from public.supplier_catalog s where s.provider='shopviaclone22' and not exists(select 1 from jsonb_array_elements(catalog->'products') p where p->>'id'=s.external_id));
 update public.supplier_catalog s set approval='pending',stock_quantity=0 where s.provider='shopviaclone22' and not exists(select 1 from jsonb_array_elements(catalog->'products') p where p->>'id'=s.external_id);
 for entry in select * from jsonb_array_elements(catalog->'categories') loop
  insert into public.supplier_categories(provider,external_id,name) values('shopviaclone22',entry->>'id',entry->>'name') on conflict(provider,external_id) do update set name=excluded.name;
 end loop;
 for entry in select * from jsonb_array_elements(catalog->'products') loop
  insert into public.supplier_catalog(provider,external_id,external_category_id,name,description,supplier_cost_minor,currency,stock_quantity,authorization_ref)
  values('shopviaclone22',entry->>'id',entry->>'category_id',entry->>'name',entry->>'description',(entry->>'cost_minor')::bigint,entry->>'currency',(entry->>'stock')::integer,entry->>'authorization_ref')
  on conflict(provider,external_id) do update set external_category_id=excluded.external_category_id,name=excluded.name,description=excluded.description,supplier_cost_minor=excluded.supplier_cost_minor,currency=excluded.currency,stock_quantity=excluded.stock_quantity,authorization_ref=excluded.authorization_ref,updated_at=now() returning * into existing;
  -- Cost refresh never overwrites the independently set customer selling price.
  if existing.approval='approved' and existing.product_id is not null then
   update public.inventory set available_quantity=existing.stock_quantity where product_id=existing.product_id;
  end if;
  total=total+1;
 end loop;
 update public.supplier_sync_state set last_success_at=now(),message=total::text||' eligible listings refreshed' where provider='shopviaclone22';
 return total;
end; $$;
create function public.approve_supplier_listing(external_product_id text,category_uuid uuid,selling_price_minor bigint,delivery_method text,authorization_evidence text) returns uuid language plpgsql security definer set search_path='' as $$
declare listing public.supplier_catalog; saved uuid;
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into listing from public.supplier_catalog where provider='shopviaclone22' and external_id=external_product_id for update;
 if not found or length(btrim(coalesce(authorization_evidence,'')))<5 then raise exception 'Verified resale evidence is required'; end if;
 if not exists(select 1 from public.supplier_sync_state where provider='shopviaclone22' and last_success_at>now()-interval '1 hour' and listing.updated_at>=last_success_at) then raise exception 'Refresh the supplier catalog before approval'; end if;
 saved=coalesce(listing.product_id,gen_random_uuid());
 insert into public.products(id,category_id,slug,name,description,price_minor,currency,supplier_name,authorized_resale,status,delivery_type)
 values(saved,category_uuid,'supplier-'||listing.external_id,listing.name,listing.description,selling_price_minor,'NGN','ShopViaClone22',true,'active',delivery_method)
 on conflict(id) do update set category_id=excluded.category_id,price_minor=excluded.price_minor,authorized_resale=true,status='active',delivery_type=excluded.delivery_type;
 insert into public.inventory(product_id,available_quantity) values(saved,listing.stock_quantity) on conflict(product_id) do update set available_quantity=excluded.available_quantity;
 update public.supplier_catalog set product_id=saved,approval='approved',authorization_ref=btrim(authorization_evidence) where provider='shopviaclone22' and external_id=external_product_id;
 return saved;
end; $$;
create function public.reject_supplier_listing(external_product_id text) returns void language plpgsql security definer set search_path='' as $$
declare linked uuid;
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 update public.supplier_catalog set approval='rejected' where provider='shopviaclone22' and external_id=external_product_id returning product_id into linked;
 update public.products set status='inactive' where id=linked;
 update public.inventory set available_quantity=0 where product_id=linked;
end; $$;
revoke all on function public.claim_supplier_sync(),public.record_supplier_sync_failure(),public.sync_supplier_catalog(jsonb),public.approve_supplier_listing(text,uuid,bigint,text,text),public.reject_supplier_listing(text) from public,anon,authenticated;
grant execute on function public.claim_supplier_sync(),public.record_supplier_sync_failure(),public.sync_supplier_catalog(jsonb),public.approve_supplier_listing(text,uuid,bigint,text,text),public.reject_supplier_listing(text) to authenticated;
commit;
