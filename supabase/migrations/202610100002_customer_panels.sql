begin;
-- Payment state is writable only by a trusted backend, never customers or administrators.
create table public.orders (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references auth.users(id) on delete restrict,
 reference text not null unique check(length(reference) between 1 and 100),
 payment_status text not null default 'pending' check(payment_status in ('pending','paid','failed','refunded')),
 fulfillment_status text not null default 'pending' check(fulfillment_status in ('pending','processing','delivered')),
 total_minor bigint not null check(total_minor between 0 and 99999999900),
 currency text not null default 'NGN' check(currency='NGN'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(fulfillment_status <> 'delivered' or payment_status in ('paid','refunded'))
);
create index orders_customer_created on public.orders(customer_id,created_at desc);
create table public.order_items (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete restrict,
 product_name text not null check(length(product_name) between 1 and 200),
 category_name text not null check(length(category_name) between 1 and 120),
 quantity integer not null check(quantity between 1 and 1000),
 unit_price_minor bigint not null check(unit_price_minor between 0 and 99999999900),
 created_at timestamptz not null default now(),
 unique(order_id,product_id)
);
create index order_items_order on public.order_items(order_id);
create table public.product_entitlements (
 id uuid primary key default gen_random_uuid(),
 order_item_id uuid not null unique references public.order_items(id) on delete cascade,
 instructions text not null check(length(instructions) between 1 and 20000),
 created_at timestamptz not null default now()
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(title) between 1 and 200),
 message text not null check(length(message) between 1 and 2000),
 order_id uuid references public.orders(id) on delete cascade,
 read_at timestamptz,
 created_at timestamptz not null default now(),
 unique(user_id,order_id,title)
);
create index notifications_user_created on public.notifications(user_id,created_at desc);
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.product_entitlements enable row level security;
alter table public.notifications enable row level security;
create policy own_orders on public.orders for select to authenticated using(customer_id=(select auth.uid()) or private.is_admin());
create policy own_order_items on public.order_items for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id));
-- Even administrators cannot browse a customer's entitlement secrets.
create policy own_entitlements on public.product_entitlements for select to authenticated using(exists(
 select 1 from public.order_items i join public.orders o on o.id=i.order_id
 where i.id=order_item_id and o.customer_id=(select auth.uid()) and o.payment_status='paid' and o.fulfillment_status='delivered'
));
create policy own_notifications on public.notifications for select to authenticated using(user_id=(select auth.uid()));
create policy own_notification_updates on public.notifications for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.orders,public.order_items,public.product_entitlements,public.notifications from public,anon,authenticated;
grant select on public.orders,public.order_items,public.product_entitlements,public.notifications to authenticated;
grant update(read_at) on public.notifications to authenticated;
grant all on public.orders,public.order_items,public.product_entitlements,public.notifications to service_role;
create trigger orders_updated before update on public.orders for each row execute function public.catalog_touch_updated_at();
create trigger orders_audit after insert or update or delete on public.orders for each row execute function private.catalog_audit();
-- Manual fulfillment of already verified, paid orders. Row lock + unique entitlements make retries idempotent.
create function public.admin_fulfill_order(order_uuid uuid, delivery jsonb) returns void language plpgsql security definer set search_path='' as $$
declare purchased public.orders; item record; content text; item_count integer=0;
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into purchased from public.orders where id=order_uuid for update;
 if not found or purchased.payment_status <> 'paid' then raise exception 'A verified paid order is required'; end if;
 if purchased.fulfillment_status='delivered' then return; end if;
 if jsonb_typeof(delivery) <> 'object' then raise exception 'Invalid delivery'; end if;
 for item in select id from public.order_items where order_id=order_uuid loop
  content=trim(delivery->>item.id::text);
  if content is null or length(content) not between 1 and 20000 then raise exception 'Instructions are required for every item'; end if;
  insert into public.product_entitlements(order_item_id,instructions) values(item.id,content);
  item_count=item_count+1;
 end loop;
 if item_count=0 then raise exception 'Order has no items'; end if;
 update public.orders set fulfillment_status='delivered' where id=order_uuid;
 insert into public.notifications(user_id,title,message,order_id) values(purchased.customer_id,'Your order is ready','Open purchase history to view your private delivery instructions.',order_uuid);
end;
$$;
revoke all on function public.admin_fulfill_order(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_fulfill_order(uuid,jsonb) to authenticated;
create function public.panel_admin_overview() returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 return jsonb_build_object(
 'products',(select count(*) from public.products),
 'active_products',(select count(*) from public.products where status='active'),
 'categories',(select count(*) from public.categories),
 'orders',(select count(*) from public.orders),
 'awaiting_delivery',(select count(*) from public.orders where payment_status='paid' and fulfillment_status<>'delivered'),
 'revenue_minor',(select coalesce(sum(total_minor),0) from public.orders where payment_status='paid'));
end;
$$;
revoke all on function public.panel_admin_overview() from public,anon,authenticated;
grant execute on function public.panel_admin_overview() to authenticated;
commit;
