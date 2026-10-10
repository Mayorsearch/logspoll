begin;

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
commit;
