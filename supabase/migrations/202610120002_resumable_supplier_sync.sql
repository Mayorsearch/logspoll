-- REVIEW IN LOGSPOLL-STAGING FIRST. No production execution is authorized.
-- Compatible with 202610110002/003, with or without 202610120001 pricing.
begin;
create table public.supplier_catalog_jobs (
 connection_id uuid primary key references public.supplier_connections(id),
 id uuid not null unique default gen_random_uuid(), revision integer not null,
 phase text not null default 'categories' check(phase in ('categories','listings','details','finalize','complete')),
 started_at timestamptz not null default now(), next_page integer not null default 1 check(next_page between 1 and 1001),
 last_page integer, expected_total integer, categories jsonb not null default '[]',
 scanned integer not null default 0, skipped_details integer not null default 0,
 imported integer, check(jsonb_typeof(categories)='array')
);
create table public.supplier_catalog_rows (
 job_id uuid not null references public.supplier_catalog_jobs(id) on delete cascade,
 external_id text not null check(external_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$'),
 product jsonb, detail_done boolean not null default false,
 primary key(job_id,external_id), check(product is null or jsonb_typeof(product)='object')
);
alter table public.supplier_catalog_jobs enable row level security;
alter table public.supplier_catalog_rows enable row level security;
revoke all on public.supplier_catalog_jobs,public.supplier_catalog_rows from public,anon,authenticated;
-- Private checkpoints have no browser policies or grants, including for admins.
grant all on public.supplier_catalog_jobs,public.supplier_catalog_rows to service_role;

-- Preserve the currently installed finalizer (including pricing if installed).
alter function public.finish_supplier_connection(uuid,uuid,jsonb,text) rename to finish_supplier_connection_before_batches;
revoke all on function public.finish_supplier_connection_before_batches(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_supplier_connection_before_batches(uuid,uuid,jsonb,text) to service_role;
create function public.finish_supplier_connection(connection_uuid uuid, token uuid, snapshot jsonb default null, failure text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.supplier_connections; total integer;
begin
 select * into c from public.supplier_connections where id=connection_uuid for update;
 -- Expiry permits cleanup ONLY for the same token. A reclaimed lease is protected.
 if not found or token is null or c.lease_token is distinct from token then raise exception 'Supplier lease expired'; end if;
 if failure is not null then
  update public.inventory set available_quantity=0 where product_id in(select product_id from public.supplier_feed_items where connection_id=connection_uuid);
  update public.supplier_feed_items set stock_quantity=0 where connection_id=connection_uuid;
  update public.supplier_connections set last_status=left(failure,300),lease_token=null,lease_until=null,running_operation=null,
   next_attempt_at=greatest(next_attempt_at,now()+make_interval(secs=>least(greatest(coalesce((snapshot->>'retry_after_ms')::double precision/1000,60),60),86400))) where id=connection_uuid;
  return 0;
 end if;
 -- Successful publication still requires an unexpired lease and old validations.
 if c.lease_until is null or c.lease_until<=now() then raise exception 'Supplier lease expired'; end if;
 total=public.finish_supplier_connection_before_batches(connection_uuid,token,snapshot,null);
 if c.running_operation='sync' then
  update public.supplier_catalog_jobs set phase='complete',imported=total where connection_id=connection_uuid;
 end if;
 return total;
end $$;

create function public.claim_supplier_sync_batch(connection_uuid uuid, expected_job uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.supplier_connections; j public.supplier_catalog_jobs; token uuid; detail jsonb;
begin
 select * into c from public.supplier_connections where id=connection_uuid for update;
 if not found or not c.enabled or c.provider<>'youngpg' then raise exception 'Enabled YoungPG connection required'; end if;
 select * into j from public.supplier_catalog_jobs where connection_id=connection_uuid for update;
 if expected_job is not null and (j.id is distinct from expected_job or j.revision<>c.revision) then raise exception 'Sync checkpoint changed; restart synchronization'; end if;
 if expected_job is not null and j.phase='complete' then
  return jsonb_build_object('done',true,'job_id',j.id,'imported',j.imported,'scanned',j.scanned,'detail_enrichment_skipped',j.skipped_details);
 end if;
 if c.lease_until>now() or c.next_attempt_at>now() then return null; end if;
 if j.id is null or j.revision<>c.revision or j.phase='complete' or j.started_at<now()-interval '15 minutes' then
  -- Only private, abandoned staging is replaced; no product/feed records deleted.
  delete from public.supplier_catalog_jobs where connection_id=connection_uuid;
  insert into public.supplier_catalog_jobs(connection_id,revision) values(connection_uuid,c.revision) returning * into j;
 end if;
 -- Invalidate old stock and approval freshness until the WHOLE job commits.
 update public.inventory set available_quantity=0 where product_id in(select product_id from public.supplier_feed_items where connection_id=connection_uuid);
 token=gen_random_uuid();
 update public.supplier_connections set lease_token=token,lease_until=now()+interval '5 minutes',running_operation='sync',
  last_sync_revision=0,last_attempt_at=now(),last_status='Resumable sync: '||j.phase||', page '||j.next_page||', '||j.scanned||' scanned' where id=connection_uuid;
 if j.phase='details' then
  select product into detail from public.supplier_catalog_rows where job_id=j.id and product is not null and not detail_done order by external_id limit 1;
 end if;
 return jsonb_build_object('job_id',j.id,'token',token,'revision',j.revision,'phase',j.phase,'page',j.next_page,'categories',j.categories,'detail',detail,'scanned',j.scanned);
end $$;

create function public.commit_supplier_sync_batch(connection_uuid uuid, token uuid, job_uuid uuid, batch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.supplier_connections; j public.supplier_catalog_jobs; entry jsonb; eligible integer; total integer; snap jsonb;
begin
 select * into c from public.supplier_connections where id=connection_uuid for update;
 if not found or token is null or c.lease_token is distinct from token or c.lease_until is null or c.lease_until<=now() then raise exception 'Supplier lease expired'; end if;
 select * into j from public.supplier_catalog_jobs where connection_id=connection_uuid for update;
 if not found or j.id<>job_uuid or j.revision<>c.revision or not c.enabled or j.started_at<now()-interval '15 minutes' then raise exception 'Sync checkpoint changed or expired'; end if;
 if batch->>'phase' is distinct from j.phase then raise exception 'Sync phase mismatch'; end if;
 if j.phase='categories' then
  if jsonb_typeof(batch->'categories') is distinct from 'array' then raise exception 'Invalid categories'; end if;
  update public.supplier_catalog_jobs set categories=batch->'categories',phase='listings' where id=j.id;
 elsif j.phase='listings' then
  if (batch->>'page')::integer is distinct from j.next_page or jsonb_typeof(batch->'rows') is distinct from 'array'
   or jsonb_array_length(batch->'rows')>100 or (batch->>'last_page')::integer not between j.next_page and 1000 then raise exception 'Invalid listing checkpoint'; end if;
  if j.last_page is not null and j.last_page is distinct from (batch->>'last_page')::integer then raise exception 'Supplier pagination changed; snapshot rejected'; end if;
  if j.last_page is not null and j.expected_total is distinct from (batch->>'total')::integer then raise exception 'Supplier total changed; snapshot rejected'; end if;
  if jsonb_typeof(batch->'categories') is distinct from 'array' then raise exception 'Invalid categories'; end if;
  for entry in select * from jsonb_array_elements(batch->'rows') loop
   if entry->'product' is not null and entry->'product'<>'null'::jsonb and (
    entry->'product'->>'id' is distinct from entry->>'id' or
    c.authorized_products->>(entry->>'id') is distinct from entry->'product'->>'authorization_ref') then raise exception 'Resale authorization required'; end if;
   insert into public.supplier_catalog_rows(job_id,external_id,product,detail_done)
    values(j.id,entry->>'id',nullif(entry->'product','null'::jsonb),entry->'product'->>'slug' is null);
   -- The primary key rejects duplicate IDs within OR across pages atomically.
  end loop;
  select count(*) into eligible from public.supplier_catalog_rows where job_id=j.id and product is not null;
  if eligible>500 then raise exception 'Eligible catalog exceeds 500 products'; end if;
  if (batch->>'total')::integer<0 or (batch->>'total')::integer>100000 then raise exception 'Invalid supplier total'; end if;
  if (batch->>'last_page')::integer=j.next_page and (batch->>'total') is not null and (batch->>'total')::integer<>j.scanned+jsonb_array_length(batch->'rows') then raise exception 'Incomplete supplier snapshot'; end if;
  update public.supplier_catalog_jobs set next_page=next_page+1,scanned=scanned+jsonb_array_length(batch->'rows'),
   categories=batch->'categories',last_page=(batch->>'last_page')::integer,expected_total=(batch->>'total')::integer,
   phase=case when (batch->>'last_page')::integer=j.next_page then 'details' else 'listings' end where id=j.id;
 elsif j.phase='details' then
  if batch->>'skip_network'='true' then
   select count(*) into total from public.supplier_catalog_rows where job_id=j.id and product is not null and not detail_done;
   update public.supplier_catalog_rows set detail_done=true where job_id=j.id;
   update public.supplier_catalog_jobs set skipped_details=skipped_details+total where id=j.id;
  elsif batch->>'id' is not null then
   if batch->'product' is not null and batch->'product'<>'null'::jsonb and (
    batch->'product'->>'id' is distinct from batch->>'id' or
    c.authorized_products->>(batch->>'id') is distinct from batch->'product'->>'authorization_ref') then raise exception 'Resale authorization required'; end if;
   update public.supplier_catalog_rows set product=nullif(batch->'product','null'::jsonb),detail_done=true
    where job_id=j.id and external_id=batch->>'id' and product is not null and not detail_done;
   if not found then raise exception 'Detail checkpoint mismatch'; end if;
  elsif exists(select 1 from public.supplier_catalog_rows where job_id=j.id and product is not null and not detail_done) then raise exception 'Details incomplete';
  end if;
  if not exists(select 1 from public.supplier_catalog_rows where job_id=j.id and product is not null and not detail_done) then
   update public.supplier_catalog_jobs set phase='finalize' where id=j.id;
  end if;
 elsif j.phase='finalize' then
  if j.last_page is null or j.next_page<>j.last_page+1 or
   (select count(*) from public.supplier_catalog_rows where job_id=j.id)<>j.scanned or
   exists(select 1 from public.supplier_catalog_rows where job_id=j.id and product is not null and not detail_done) then raise exception 'Incomplete supplier snapshot'; end if;
  select jsonb_build_object('categories',j.categories,'products',coalesce(jsonb_agg(product order by external_id) filter(where product is not null),'[]'::jsonb),
   'subcategories','[]'::jsonb,'subcategories_complete',false) into snap from public.supplier_catalog_rows where job_id=j.id;
  -- Existing finalizer validates all constraints and publishes in this transaction.
  total=public.finish_supplier_connection(connection_uuid,token,snap,null);
  return jsonb_build_object('done',true,'job_id',j.id,'imported',total,'scanned',j.scanned,'detail_enrichment_skipped',j.skipped_details);
 else raise exception 'Invalid sync phase';
 end if;
 update public.supplier_connections set lease_token=null,lease_until=null,running_operation=null,next_attempt_at=now()+interval '1200 milliseconds',
  last_status='Sync checkpoint saved; continue Sync Catalog' where id=connection_uuid;
 return jsonb_build_object('done',false,'job_id',j.id,'scanned',(select scanned from public.supplier_catalog_jobs where id=j.id));
end $$;

-- Inventory becomes unavailable even if a killed invocation cannot run cleanup.
-- The owner-evaluated helper exposes only a boolean, never private supplier data.
create function private.supplier_stock_current(product_uuid uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.supplier_feed_items where product_id=product_uuid) or exists(
  select 1 from public.supplier_feed_items f join public.supplier_connections c on c.id=f.connection_id
  where f.product_id=product_uuid and f.approval='approved' and f.stock_quantity>0 and c.enabled
   and c.last_sync_revision=c.revision and c.last_sync_at>now()-interval '1 hour'
   and f.updated_at>=c.last_sync_at and coalesce((to_jsonb(f)->>'publication_enabled')::boolean,true)
   and c.authorized_products->>f.external_id=f.authorization_ref);
$$;
revoke all on function private.supplier_stock_current(uuid) from public,anon,authenticated;
grant execute on function private.supplier_stock_current(uuid) to authenticated,service_role;
alter policy catalog_inventory_read on public.inventory using(
 exists(select 1 from public.products p where p.id=product_id) and private.supplier_stock_current(product_id));
revoke all on function public.finish_supplier_connection(uuid,uuid,jsonb,text),public.claim_supplier_sync_batch(uuid,uuid),public.commit_supplier_sync_batch(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_supplier_connection(uuid,uuid,jsonb,text),public.claim_supplier_sync_batch(uuid,uuid),public.commit_supplier_sync_batch(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
