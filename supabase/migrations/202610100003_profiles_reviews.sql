begin;
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
commit;
