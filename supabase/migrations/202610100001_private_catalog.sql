begin;
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
commit;
