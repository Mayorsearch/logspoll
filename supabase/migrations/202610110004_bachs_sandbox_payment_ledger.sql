-- REVIEW FIRST. Separate test-only Bachs ledger. Does NOT change public.orders,
-- payment totals, existing live inventory, entitlements or supplier permissions.
-- Requires public.products, inventory, supplier_feed_items/connections, auth.users.
-- Apply ONCE to the existing project only after backup and SQL review.
begin;

create table public.bachs_sandbox_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id),
  request_id uuid not null,
  product_id uuid not null references public.products(id),
  product_name text not null,
  quantity integer not null check(quantity = 1),
  unit_price_minor bigint not null check(unit_price_minor between 1 and 99999999900),
  total_minor bigint not null check(total_minor between 1 and 99999999900),
  currency text not null default 'NGN' check(currency = 'NGN'),
  checkout_id text unique,
  state text not null default 'creating' check(state in ('creating','open','paid_awaiting_supplier','held','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id,request_id)
);
create index bachs_sandbox_orders_customer on public.bachs_sandbox_orders(customer_id,created_at desc);
create table public.bachs_sandbox_events (
  event_id text primary key check(length(event_id) between 8 and 150),
  order_id uuid not null references public.bachs_sandbox_orders(id),
  event_type text not null check(event_type in ('checkout.completed','collection.succeeded')),
  created_at timestamptz not null default now()
);
create table public.bachs_sandbox_fulfillment_jobs (
  order_id uuid primary key references public.bachs_sandbox_orders(id),
  state text not null default 'blocked' check(state='blocked'),
  -- Deliberately no supplier credentials, code, password, sessions, or entitlement fields.
  created_at timestamptz not null default now()
);

alter table public.bachs_sandbox_orders enable row level security;
alter table public.bachs_sandbox_events enable row level security;
alter table public.bachs_sandbox_fulfillment_jobs enable row level security;
revoke all on public.bachs_sandbox_orders,public.bachs_sandbox_events,public.bachs_sandbox_fulfillment_jobs from public,anon,authenticated;
grant select,insert,update on public.bachs_sandbox_orders to service_role;
grant select,insert on public.bachs_sandbox_events,public.bachs_sandbox_fulfillment_jobs to service_role;

create function public.prepare_bachs_sandbox_checkout(buyer_uuid uuid, product_uuid uuid, attempt_uuid uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.bachs_sandbox_orders; item record;
begin
  if buyer_uuid is null or product_uuid is null or attempt_uuid is null then raise exception 'Invalid checkout request'; end if;
  -- Server-side identity check is also performed by Pages Function; this function
  -- is executable by service_role ONLY, never through browser auth.
  if not exists(select 1 from auth.users u where u.id=buyer_uuid and u.email_confirmed_at is not null) then
    raise exception 'Verified customer required';
  end if;
  select * into existing from public.bachs_sandbox_orders
   where customer_id=buyer_uuid and request_id=attempt_uuid;
  if found then
    if existing.product_id<>product_uuid then raise exception 'Attempt ID belongs to another product'; end if;
    return jsonb_build_object('id',existing.id,'total_minor',existing.total_minor,'checkout_id',existing.checkout_id,'state',existing.state);
  end if;
  select p.id,p.name,p.price_minor,p.currency,p.status,p.delivery_type,p.authorized_resale,
         i.available_quantity
    into item from public.products p join public.inventory i on i.product_id=p.id
   where p.id=product_uuid for share of p,i;
  if not found or item.status <> 'active' or not item.authorized_resale or item.currency <> 'NGN'
    or item.price_minor < 1 or item.available_quantity < 1
    or item.delivery_type not in ('Licensed digital download','Redemption code','Subscription activation') then
    raise exception 'Product not eligible for sandbox testing';
  end if;
  -- Never treat a supplier API key as automatic resale/transfer permission.
  if item.name ~* '(accounts?|passwords?|credentials?|cookies?|sessions?|tokens?|facebook|instagram|tiktok|snapchat|twitter)' then
    raise exception 'Account access inventory is excluded';
  end if;
  if not exists (
    select 1 from public.supplier_feed_items s join public.supplier_connections c on c.id=s.connection_id
    where s.product_id=product_uuid and s.approval='approved' and c.enabled
      and c.authorized_products ->> s.external_id = s.authorization_ref
  ) then raise exception 'Approved eligible supplier listing required'; end if;
  insert into public.bachs_sandbox_orders(customer_id,request_id,product_id,product_name,quantity,unit_price_minor,total_minor)
  values (buyer_uuid,attempt_uuid,product_uuid,item.name,1,item.price_minor,item.price_minor)
  on conflict(customer_id,request_id) do nothing;
  select * into existing from public.bachs_sandbox_orders where customer_id=buyer_uuid and request_id=attempt_uuid;
  if existing.product_id<>product_uuid then raise exception 'Attempt mismatch'; end if;
  return jsonb_build_object('id',existing.id,'total_minor',existing.total_minor,'checkout_id',existing.checkout_id,'state',existing.state);
end; $$;

create function public.attach_bachs_sandbox_checkout(order_uuid uuid, checkout_ref text)
returns void language plpgsql security definer set search_path='' as $$
declare existing public.bachs_sandbox_orders;
begin
  if checkout_ref !~ '^chk_[A-Za-z0-9_-]{6,100}$' then raise exception 'Invalid checkout ID'; end if;
  select * into existing from public.bachs_sandbox_orders where id=order_uuid for update;
  if not found then raise exception 'Order missing'; end if;
  if existing.checkout_id is not null and existing.checkout_id<>checkout_ref then raise exception 'Checkout already assigned'; end if;
  if existing.state not in ('creating','open','paid_awaiting_supplier') then raise exception 'Checkout not attachable'; end if;
  update public.bachs_sandbox_orders set checkout_id=checkout_ref,
    state=case when state='creating' then 'open' else state end, updated_at=now() where id=order_uuid;
end; $$;

create function public.confirm_bachs_sandbox_checkout(order_uuid uuid, checkout_ref text, event_ref text, event_kind text, confirmed_minor bigint, confirmed_currency text)
returns text language plpgsql security definer set search_path='' as $$
declare existing public.bachs_sandbox_orders; existing_event record;
begin
  if event_kind not in ('checkout.completed','collection.succeeded')
    or event_ref !~ '^evt_[A-Za-z0-9_-]{5,140}$'
    or checkout_ref !~ '^chk_[A-Za-z0-9_-]{6,100}$' then raise exception 'Invalid verified webhook fields'; end if;
  select * into existing from public.bachs_sandbox_orders where id=order_uuid for update;
  if not found then raise exception 'Unknown order'; end if;
  if existing.checkout_id is not null and existing.checkout_id<>checkout_ref then raise exception 'Checkout reference mismatch'; end if;
  select order_id into existing_event from public.bachs_sandbox_events where event_id=event_ref;
  if found then
    if existing_event.order_id <> order_uuid then raise exception 'Webhook event assigned elsewhere'; end if;
    return existing.state;
  end if;
  insert into public.bachs_sandbox_events(event_id,order_id,event_type) values(event_ref,order_uuid,event_kind);
  if confirmed_minor is distinct from existing.total_minor or confirmed_currency is distinct from 'NGN' then
    update public.bachs_sandbox_orders set checkout_id=coalesce(checkout_id,checkout_ref),state='held',updated_at=now() where id=order_uuid;
    return 'held';
  end if;
  if existing.state='held' then return 'held'; end if;
  update public.bachs_sandbox_orders set checkout_id=coalesce(checkout_id,checkout_ref),state='paid_awaiting_supplier',updated_at=now()
   where id=order_uuid and state in ('creating','open','paid_awaiting_supplier');
  -- Explicitly BLOCKED pending a separate, audited supplier purchase/reconciliation adapter.
  insert into public.bachs_sandbox_fulfillment_jobs(order_id) values(order_uuid)
    on conflict(order_id) do nothing;
  return 'paid_awaiting_supplier';
end; $$;

revoke all on function public.prepare_bachs_sandbox_checkout(uuid,uuid,uuid),
  public.attach_bachs_sandbox_checkout(uuid,text),
  public.confirm_bachs_sandbox_checkout(uuid,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.prepare_bachs_sandbox_checkout(uuid,uuid,uuid),
  public.attach_bachs_sandbox_checkout(uuid,text),
  public.confirm_bachs_sandbox_checkout(uuid,text,text,text,bigint,text) to service_role;
notify pgrst,'reload schema';
commit;
