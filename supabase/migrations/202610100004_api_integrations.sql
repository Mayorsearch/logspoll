begin;
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
commit;
