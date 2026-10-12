-- GENERATED from retained migrations. REVIEW before manual execution in Supabase SQL Editor.
-- EMPTY LOGSPOLL SCHEMA ONLY. Existing/partially migrated installations must be reconciled separately.
-- One transaction prevents the original public catalog permissions being committed before private RLS.
-- No drop/truncate of tables or customer records. Does not assign admin accounts or import products.
begin;
set local lock_timeout = '5s';
do $guard$
declare object_name text;
begin
  foreach object_name in array array[
    'public.categories',
    'public.products',
    'public.inventory',
    'public.storefront_products',
    'public.storefront_categories',
    'public.user_roles',
    'public.audit_logs',
    'public.orders',
    'public.order_items',
    'public.product_entitlements',
    'public.notifications',
    'public.profiles',
    'public.reviews',
    'public.api_integrations',
    'public.support_tickets',
    'public.website_settings',
    'public.supplier_categories',
    'public.supplier_catalog',
    'public.supplier_sync_state'
  ] loop
    if to_regclass(object_name) is not null then
      raise exception 'STOP: existing application object %. Inspect migration history; do not replay bootstrap.', object_name;
    end if;
  end loop;
end;
$guard$;
-- SOURCE: 202610090001_catalog.sql
-- Storefront metadata only. Entitlement secrets must live in separate private tables.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 100),
  constraint categories_reserved_slug check (slug not in ('vpn-privacy','software-licenses','digital-subscriptions','business-tools','creative-resources','developer-tools','licensed-streaming','communication-services')),
  name text not null check (length(name) between 1 and 120),
  short_name text not null check (length(short_name) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  icon text not null default 'grid' check (icon in ('shield','grid','layers','briefcase','palette','code','play','message','users','camera','phone','mail','message-plus','headphones','video')),
  color text not null default 'orange' check (color in ('purple','blue','pink','green','orange','slate')),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 100),
  name text not null check (length(name) between 1 and 200),
  brand text not null default '' check (length(brand) <= 120),
  description text not null check (length(description) between 1 and 10000),
  price_minor bigint not null check (price_minor between 0 and 99999999900),
  currency text not null default 'NGN' check (currency = 'NGN'),
  supplier_name text not null check (length(supplier_name) between 1 and 200),
  authorized_resale boolean not null default false,
  status text not null default 'draft' check (status in ('draft','active','inactive')),
  delivery_type text not null check (delivery_type in ('Licensed digital download','Redemption code','Subscription activation','Manual fulfillment')),
  image_path text check (length(image_path) <= 2048 and image_path ~ '^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(png|jpg|jpeg|webp)$' and image_path !~ '//'),
  term text not null default '' check (length(term) <= 200),
  features text[] not null default '{}' check (cardinality(features) <= 30),
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or authorized_resale)
);
-- Aggregate available quantity only; never put keys, codes, credentials or delivery data here.
create table public.inventory (
  product_id uuid primary key references public.products(id) on delete cascade,
  available_quantity integer not null default 0 check (available_quantity between 0 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_status_idx on public.products(category_id, status);
create index products_price_idx on public.products(price_minor, id) where status = 'active';
create index products_created_idx on public.products(created_at desc, id) where status = 'active';

create function public.catalog_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger categories_updated before update on public.categories for each row execute function public.catalog_touch_updated_at();
create trigger products_updated before update on public.products for each row execute function public.catalog_touch_updated_at();
create trigger inventory_updated before update on public.inventory for each row execute function public.catalog_touch_updated_at();
revoke all on function public.catalog_touch_updated_at() from public, anon, authenticated;

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.inventory enable row level security;
create policy catalog_categories_read on public.categories for select to anon, authenticated using (active);
create policy catalog_products_read on public.products for select to anon, authenticated using (
  status = 'active' and authorized_resale and exists (
    select 1 from public.categories c where c.id = category_id and c.active
  )
);
create policy catalog_inventory_read on public.inventory for select to anon, authenticated using (
  exists (select 1 from public.products p where p.id = product_id)
);
revoke all on public.categories, public.products, public.inventory from public, anon, authenticated;
grant select on public.categories, public.products, public.inventory to anon, authenticated;
grant all on public.categories, public.products, public.inventory to service_role;

create view public.storefront_products with (security_invoker = true) as
select p.id, p.slug, p.name, p.brand, c.slug as category, c.name as category_name,
  p.description, p.price_minor, p.currency, p.supplier_name, p.delivery_type,
  p.image_path, p.term, p.features, p.created_at, p.updated_at, p.featured,
  coalesce(i.available_quantity, 0) as available_quantity
from public.products p join public.categories c on c.id = p.category_id
left join public.inventory i on i.product_id = p.id
where p.status = 'active' and p.authorized_resale and c.active;
create view public.storefront_categories with (security_invoker = true) as
select c.slug, c.name, c.short_name, c.description, c.icon, c.color, c.sort_order,
  count(p.id)::integer as product_count
from public.categories c left join public.products p on p.category_id = c.id
  and p.status = 'active' and p.authorized_resale
where c.active group by c.id;
revoke all on public.storefront_products, public.storefront_categories from public, anon, authenticated;
grant select on public.storefront_products, public.storefront_categories to anon, authenticated, service_role;

create function public.storefront_search(
  q text default '', category_slug text default '', min_minor bigint default null,
  max_minor bigint default null, availability text default '', sort_by text default 'featured',
  requested_page integer default 1
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if q is null or length(q) > 120 or category_slug is null or length(category_slug) > 100
    or requested_page is null or requested_page not between 1 and 10000
    or sort_by is null or sort_by not in ('featured','price-asc','price-desc','newest','name')
    or availability is null or availability not in ('','in-stock','out-of-stock')
    or min_minor < 0 or max_minor < 0 or min_minor > 99999999900 or max_minor > 99999999900 then
    raise exception 'Invalid catalog filters' using errcode = '22023';
  end if;
  with matches as materialized (
    select p.* from public.storefront_products p
    where (q = '' or strpos(lower(p.name || ' ' || p.description || ' ' || p.category_name), lower(q)) > 0)
      and (category_slug = '' or p.category = category_slug)
      and (min_minor is null or p.price_minor >= min_minor)
      and (max_minor is null or p.price_minor <= max_minor)
      and (availability = '' or (availability = 'in-stock' and p.available_quantity > 0)
        or (availability = 'out-of-stock' and p.available_quantity = 0))
  ), totals as (
    select count(*)::integer as total, greatest(1, ceil(count(*) / 9.0)::integer) as pages from matches
  ), bounds as (
    select total, pages, least(requested_page, pages) as page from totals
  ), ordered as (
    select p.*, row_number() over (order by
      case when sort_by = 'featured' then p.featured end desc,
      case when sort_by = 'price-asc' then p.price_minor end asc,
      case when sort_by = 'price-desc' then p.price_minor end desc,
      case when sort_by = 'newest' then p.created_at end desc,
      case when sort_by = 'name' then p.name end asc,
      p.id asc) as ordinal
    from matches p
  ), selected as (
    select o.* from ordered o cross join bounds b
    where o.ordinal > (b.page - 1) * 9 and o.ordinal <= b.page * 9
  )
  select jsonb_build_object('total', b.total, 'pages', b.pages, 'page', b.page,
    'products', coalesce((select jsonb_agg(to_jsonb(s) - 'ordinal' order by s.ordinal) from selected s), '[]'::jsonb))
    into result from bounds b;
  return result;
end;
$$;
revoke all on function public.storefront_search(text,text,bigint,bigint,text,text,integer) from public, anon, authenticated;
grant execute on function public.storefront_search(text,text,bigint,bigint,text,text,integer) to anon, authenticated, service_role;

insert into public.categories (slug, name, short_name, description, icon, color, sort_order) values
('vpn-services', 'VPN Services', 'VPN Services', 'Authorized VPN subscriptions and owner-managed setup services.', 'shield', 'purple', 0),
('facebook-services', 'Facebook Services', 'Facebook Services', 'Approved setup and business-tool assistance for customer-owned Facebook assets.', 'users', 'blue', 1),
('instagram-services', 'Instagram Services', 'Instagram Services', 'Approved setup and professional tools for customer-owned Instagram profiles.', 'camera', 'pink', 2),
('google-voice-services', 'Google Voice Services', 'Google Voice', 'Customer-owned business communication setup, subject to provider eligibility.', 'phone', 'green', 3),
('usa-email-services', 'USA Email Services', 'USA Email', 'Legitimate business email setup and licensed email tools; no pre-owned inbox transfers.', 'mail', 'blue', 4),
('textnow-services', 'TextNow Services', 'TextNow Services', 'Customer-owned setup assistance and provider-approved services only.', 'message', 'orange', 5),
('textplus-services', 'TextPlus Services', 'TextPlus Services', 'Approved communication setup assistance for eligible customer-owned services.', 'message-plus', 'green', 6),
('talkatone-services', 'Talkatone Services', 'Talkatone Services', 'Provider-approved setup guidance for customer-owned communication services.', 'headphones', 'purple', 7),
('tiktok-services', 'TikTok Services', 'TikTok Services', 'Approved creator and business-tool setup for customer-owned TikTok profiles.', 'video', 'slate', 8),
('other-digital-services', 'Other Digital Products', 'Other Digital Products', 'Licensed software, authorized subscriptions, creative resources, and legitimate business tools.', 'grid', 'orange', 9);
-- No sample products or invented inventory are seeded.

-- SOURCE: 202610100001_private_catalog.sql
-- Migration 1 was never deployed. This additive transition also locks any existing installation.
drop policy catalog_products_read on public.products;
drop policy catalog_inventory_read on public.inventory;
create policy catalog_products_read on public.products for select to authenticated using (
  status='active' and authorized_resale and exists(select 1 from public.categories c where c.id=category_id and c.active)
);
create policy catalog_inventory_read on public.inventory for select to authenticated using (exists(select 1 from public.products p where p.id=product_id));
revoke all on public.products,public.inventory,public.storefront_products,public.storefront_categories from anon;
revoke all on function public.storefront_search(text,text,bigint,bigint,text,text,integer) from anon;

create table public.user_roles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check(role in ('customer','admin')),
 created_at timestamptz not null default now()
);
alter table public.user_roles enable row level security;
create policy own_role_read on public.user_roles for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.user_roles from public,anon,authenticated;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
create schema if not exists private;
grant usage on schema private to authenticated;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_roles where user_id=(select auth.uid()) and role='admin');
$$;
revoke all on function private.is_admin() from public,anon,authenticated;
grant execute on function private.is_admin() to authenticated;
create policy admin_categories on public.categories for all to authenticated using(private.is_admin()) with check(private.is_admin());
create policy admin_products on public.products for all to authenticated using(private.is_admin()) with check(private.is_admin());
create policy admin_inventory on public.inventory for all to authenticated using(private.is_admin()) with check(private.is_admin());
grant insert,update,delete on public.categories,public.products,public.inventory to authenticated;

create table public.audit_logs (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid references auth.users(id) on delete set null,
 table_name text not null,
 record_id uuid not null,
 action text not null,
 created_at timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
create policy admin_audit_read on public.audit_logs for select to authenticated using(private.is_admin());
revoke all on public.audit_logs from public,anon,authenticated;
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
create function private.catalog_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_logs(actor_id,table_name,record_id,action) values(auth.uid(),tg_table_name,
 case when tg_op='DELETE' then coalesce(to_jsonb(old)->>'id',to_jsonb(old)->>'product_id')::uuid else coalesce(to_jsonb(new)->>'id',to_jsonb(new)->>'product_id')::uuid end,tg_op);
 return null;
end;
$$;
revoke all on function private.catalog_audit() from public,anon,authenticated;
create trigger categories_audit after insert or update or delete on public.categories for each row execute function private.catalog_audit();
create trigger products_audit after insert or update or delete on public.products for each row execute function private.catalog_audit();
create trigger inventory_audit after insert or update or delete on public.inventory for each row execute function private.catalog_audit();

-- Product and quantity changes commit together, including audit entries.
create function public.admin_save_product(p jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare saved_product_id uuid;
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 saved_product_id=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid());
 insert into public.products(id,category_id,slug,name,brand,description,price_minor,supplier_name,authorized_resale,status,delivery_type,image_path,term,featured,features)
 values(saved_product_id,(p->>'category_id')::uuid,p->>'slug',p->>'name',coalesce(p->>'brand',''),p->>'description',(p->>'price_minor')::bigint,p->>'supplier_name',(p->>'authorized_resale')::boolean,p->>'status',p->>'delivery_type',nullif(p->>'image_path',''),coalesce(p->>'term',''),false,'{}')
 on conflict(id) do update set category_id=excluded.category_id,slug=excluded.slug,name=excluded.name,brand=excluded.brand,description=excluded.description,price_minor=excluded.price_minor,supplier_name=excluded.supplier_name,authorized_resale=excluded.authorized_resale,status=excluded.status,delivery_type=excluded.delivery_type,image_path=excluded.image_path,term=excluded.term;
 insert into public.inventory(product_id,available_quantity) values(saved_product_id,(p->>'available_quantity')::integer)
 on conflict(product_id) do update set available_quantity=excluded.available_quantity;
 return saved_product_id;
end;
$$;
revoke all on function public.admin_save_product(jsonb) from public,anon,authenticated;
grant execute on function public.admin_save_product(jsonb) to authenticated;

-- SOURCE: 202610100002_customer_panels.sql
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

-- SOURCE: 202610100003_profiles_reviews.sql
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null default '' check(length(full_name)<=120),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(id=(select auth.uid()) or private.is_admin());
revoke all on public.profiles from public,anon,authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
create function private.sync_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,full_name) values(new.id,left(btrim(coalesce(new.raw_user_meta_data->>'full_name','')),120))
 on conflict(id) do update set full_name=excluded.full_name,updated_at=now();
 return new;
end;
$$;
revoke all on function private.sync_profile() from public,anon,authenticated;
create trigger auth_profile_sync after insert or update of raw_user_meta_data on auth.users for each row execute function private.sync_profile();
insert into public.profiles(id,full_name) select id,left(btrim(coalesce(raw_user_meta_data->>'full_name','')),120) from auth.users;
create table public.reviews (
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null references auth.users(id) on delete cascade,
 order_item_id uuid not null unique references public.order_items(id) on delete cascade,
 display_name text not null check(length(btrim(display_name)) between 2 and 80),
 rating smallint not null check(rating between 1 and 5),
 message text not null check(length(btrim(message)) between 20 and 2000),
 location text not null default '' check(length(location)<=100),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(), reviewed_at timestamptz
);
create index reviews_status_date on public.reviews(status,created_at desc,id);
create index reviews_author_date on public.reviews(author_id,created_at desc);
alter table public.reviews enable row level security;
create policy private_review_read on public.reviews for select to authenticated using(author_id=(select auth.uid()) or private.is_admin());
revoke all on public.reviews from public,anon,authenticated;
grant select on public.reviews to authenticated;
grant all on public.reviews to service_role;
create trigger reviews_audit after insert or update or delete on public.reviews for each row execute function private.catalog_audit();
create function public.submit_review(item_uuid uuid,stars integer,feedback text,customer_name text,customer_location text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare reviewer uuid=auth.uid(); review_uuid uuid; eligible uuid;
begin
 if reviewer is null or not exists(select 1 from auth.users where id=reviewer and email_confirmed_at is not null) then
  raise exception 'Verified authentication required' using errcode='42501';
 end if;
 -- Serialize each customer's submissions so concurrent requests cannot bypass rate limits.
 perform pg_advisory_xact_lock(hashtextextended(reviewer::text,0));
 if (select count(*) from public.reviews where author_id=reviewer and created_at>now()-interval '24 hours')>=3 then
  raise exception 'Daily review limit reached' using errcode='P0001';
 end if;
 select o.id into eligible from public.order_items i join public.orders o on o.id=i.order_id
 where i.id=item_uuid and o.customer_id=reviewer and o.payment_status='paid' and o.fulfillment_status='delivered' for share of o;
 if not found then raise exception 'Eligible completed purchase required' using errcode='42501'; end if;
 insert into public.reviews(author_id,order_item_id,display_name,rating,message,location)
 values(reviewer,item_uuid,btrim(customer_name),stars,btrim(feedback),btrim(coalesce(customer_location,''))) returning id into review_uuid;
 return review_uuid;
end;
$$;
create function public.moderate_review(review_uuid uuid,decision text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 if decision is null or decision not in ('approved','rejected') then raise exception 'Invalid decision' using errcode='22023'; end if;
 update public.reviews set status=decision,reviewed_at=now() where id=review_uuid;
 if not found then raise exception 'Review not found' using errcode='22023'; end if;
end;
$$;
-- Public output is deliberately projected: never expose author IDs, order IDs, products or private delivery data.
create function public.published_reviews(requested_page integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare total_count integer; page_number integer; page_count integer; published jsonb;
begin
 if requested_page is null or requested_page not between 1 and 10000 then raise exception 'Invalid page' using errcode='22023'; end if;
 select count(*) into total_count from public.reviews r join public.order_items i on i.id=r.order_item_id join public.orders o on o.id=i.order_id
 where r.status='approved' and o.customer_id=r.author_id and o.payment_status='paid' and o.fulfillment_status='delivered';
 page_count=greatest(1,ceil(total_count/6.0)::integer); page_number=least(requested_page,page_count);
 select coalesce(jsonb_agg(row_to_json(s) order by s.created_at desc,s.id),'[]'::jsonb) into published from (
  select r.id,r.display_name,r.rating,r.message,r.location,r.created_at,true as verified_purchase
  from public.reviews r join public.order_items i on i.id=r.order_item_id join public.orders o on o.id=i.order_id
  where r.status='approved' and o.customer_id=r.author_id and o.payment_status='paid' and o.fulfillment_status='delivered'
  order by r.created_at desc,r.id offset (page_number-1)*6 limit 6
 ) s;
 return jsonb_build_object('reviews',published,'page',page_number,'pages',page_count);
end;
$$;
revoke all on function public.submit_review(uuid,integer,text,text,text),public.moderate_review(uuid,text),public.published_reviews(integer) from public,anon,authenticated;
grant execute on function public.submit_review(uuid,integer,text,text,text),public.moderate_review(uuid,text) to authenticated;
grant execute on function public.published_reviews(integer) to anon,authenticated;

-- SOURCE: 202610100004_api_integrations.sql
-- Credentials remain in server environment secrets; this table contains references only.
create table public.api_integrations (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 2 and 120),
 provider text not null check(length(provider) between 2 and 120),
 base_url text not null check(length(base_url)<=2048 and base_url ~ '^https://'),
 endpoint text not null check(length(endpoint)<=2048 and endpoint ~ '^/[^/]'),
 auth_type text not null default 'bearer' check(auth_type in ('none','bearer','api_key')),
 credential_ref text not null default '' check(credential_ref='' or credential_ref ~ '^INTEGRATION_SECRET_[A-Z0-9_]+$'),
 enabled boolean not null default false,
 connection_status text not null default 'untested' check(connection_status in ('untested','connected','failed')),
 last_attempt_at timestamptz,
 last_successful_fetch timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(auth_type='none' or credential_ref<>'')
);
alter table public.api_integrations enable row level security;
create policy admin_integrations on public.api_integrations for all to authenticated using(private.is_admin()) with check(private.is_admin());
revoke all on public.api_integrations from public,anon,authenticated;
grant select,insert,update on public.api_integrations to authenticated;
grant all on public.api_integrations to service_role;
create trigger integrations_audit after insert or update on public.api_integrations for each row execute function private.catalog_audit();
create function public.admin_claim_integration_test(integration_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 update public.api_integrations set last_attempt_at=now()
 where id=integration_id and enabled and (last_attempt_at is null or last_attempt_at<now()-interval '30 seconds');
 return found;
end;
$$;
revoke all on function public.admin_claim_integration_test(uuid) from public,anon,authenticated;
grant execute on function public.admin_claim_integration_test(uuid) to authenticated;

-- SOURCE: 202610110001_live_marketplace.sql
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

notify pgrst, 'reload schema';
commit;
