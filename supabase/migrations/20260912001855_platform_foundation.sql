-- F2 foundation only: this synthetic probe is NOT a project/domain aggregate.
-- Imperative migration, generated with Supabase CLI 2.117.0 migration new.
-- Run as postgres. No managed auth/storage/realtime objects are redefined.
begin;

create schema api authorization postgres;
create schema private authorization postgres;

revoke all on schema public, api, private from public, anon, authenticated, service_role;
grant usage on schema api to authenticated;

-- PUBLIC function EXECUTE is a GLOBAL default: a schema-local REVOKE alone
-- cannot remove it. All future postgres functions require explicit exposure.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public, api, private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public, api, private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public, api, private
  revoke all on functions from public, anon, authenticated, service_role;

create table api.platform_probes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  label text not null check (char_length(label) between 1 and 80),
  created_at timestamptz not null default now()
);
comment on table api.platform_probes is
  'Synthetic F2 authorization canary; not a business repository. Remove when domain contracts replace it.';
create index platform_probes_owner_idx on api.platform_probes(owner_id);
alter table api.platform_probes enable row level security;
alter table api.platform_probes force row level security;

create policy probe_select_owner on api.platform_probes for select
  to authenticated using ((select auth.uid()) = owner_id);
create policy probe_insert_owner on api.platform_probes for insert
  to authenticated with check ((select auth.uid()) = owner_id);
create policy probe_update_owner on api.platform_probes for update
  to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy probe_delete_owner on api.platform_probes for delete
  to authenticated using ((select auth.uid()) = owner_id);

-- No TRUNCATE, REFERENCES, TRIGGER, timestamp or identifier updates for clients.
grant select, delete on api.platform_probes to authenticated;
grant insert (id, owner_id, label) on api.platform_probes to authenticated;
grant update (owner_id, label) on api.platform_probes to authenticated;

create table private.audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null,
  entity_id uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE'))
);
comment on table private.audit_events is
  'Minimal synthetic-probe audit: no row snapshots, labels, email, token, prompt, or arbitrary payload. No client access; postgres is the trusted operator.';
alter table private.audit_events enable row level security;
alter table private.audit_events force row level security;

-- The one privileged helper is private, fixed-search-path, and trigger-only.
-- It must append an audit event atomically without giving clients audit INSERT.
create function private.audit_platform_probe() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_id uuid;
begin
  if actor is null then
    raise exception 'An authenticated actor is required' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    target_id := old.id;
  else
    target_id := new.id;
  end if;
  insert into private.audit_events (actor_id, entity_id, operation)
    values (actor, target_id, tg_op);
  return null; -- AFTER trigger: the return value is ignored.
end;
$$;
revoke all on function private.audit_platform_probe() from public, anon, authenticated, service_role;
create trigger audit_platform_probe
  after insert or update or delete on api.platform_probes
  for each row execute function private.audit_platform_probe();

-- Explicit object ACLs also protect against changes in platform defaults.
revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all sequences in schema private from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
