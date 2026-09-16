-- F6.3 — Storage privado para la prueba de concepto.
--
-- No importa objetos de Firebase ni crea referencias a un proveedor legado.
-- Los buckets son el destino vacío; la carga y el registro son explícitos,
-- versionados y autorizados por la identidad actual.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'artifact-files',
    'artifact-files',
    false,
    52428800,
    array[
      'application/json', 'application/octet-stream', 'application/pdf',
      'image/gif', 'image/jpeg', 'image/png', 'image/svg+xml',
      'text/csv', 'text/markdown', 'text/plain', 'text/yaml'
    ]::text[]
  ),
  (
    'initiative-documents',
    'initiative-documents',
    false,
    52428800,
    array[
      'application/json', 'application/msword',
      'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/gif', 'image/jpeg', 'image/png', 'image/svg+xml',
      'text/csv', 'text/markdown', 'text/plain'
    ]::text[]
  )
on conflict (id) do update
  set name = excluded.name,
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table api.file_objects (
  id uuid primary key default gen_random_uuid(),
  object_id uuid not null unique,
  owner_id uuid not null references auth.users(id) on delete restrict,
  bucket_id text not null references storage.buckets(id) on delete restrict,
  object_path text not null,
  context text not null check (context in ('artifact', 'initiative')),
  aggregate_id text not null check (btrim(aggregate_id) <> ''),
  entity_id text not null check (btrim(entity_id) <> ''),
  version integer not null check (version > 0),
  mime_type text not null check (char_length(btrim(mime_type)) between 1 and 160),
  size_bytes bigint not null check (size_bytes between 0 and 52428800),
  sha256 text not null check (sha256 ~ '^[0-9a-fA-F]{64}$'),
  source_provider text not null default 'supabase'
    check (source_provider in ('supabase', 'external')),
  state text not null default 'pending'
    check (state in ('pending', 'ready', 'quarantined', 'failed', 'deleted')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bucket_id, object_path),
  constraint file_objects_context_bucket check (
    (context = 'artifact' and bucket_id = 'artifact-files')
    or (context = 'initiative' and bucket_id = 'initiative-documents')
  ),
  constraint file_objects_owner_created_by check (owner_id = created_by),
  constraint file_objects_deleted_timestamp check (
    (state = 'deleted' and deleted_at is not null)
    or (state <> 'deleted' and deleted_at is null)
  )
);
comment on table api.file_objects is
  'Metadata autorizable de objetos de Storage. No contiene bytes, URLs firmadas ni secretos.';
comment on column api.file_objects.object_path is
  'Ruta determinista: owner_uuid/context/aggregate_uuid/entity_uuid/vN/object_uuid.ext.';
create index file_objects_owner_idx on api.file_objects (owner_id, updated_at desc);
create index file_objects_lookup_idx on api.file_objects (bucket_id, object_path, state);
create index file_objects_aggregate_idx on api.file_objects (context, aggregate_id, entity_id, version desc);
alter table api.file_objects enable row level security;
alter table api.file_objects force row level security;

create function private.storage_path_is_owned(p_path text, p_actor uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_actor is not null
    and p_path is not null
    and char_length(p_path) between 3 and 1024
    and position('/' in p_path) > 1
    and split_part(p_path, '/', 1) = p_actor::text
    and p_path !~ '(^|/)\.\.?(/|$)'
    and p_path !~ '[[:cntrl:]]'
$$;

create function private.storage_bucket_permission(p_bucket_id text)
returns text
language sql stable security definer set search_path = '' as $$
  select case p_bucket_id
    when 'artifact-files' then 'artifact:write'
    when 'initiative-documents' then 'initiative:write'
    else null
  end
$$;

create function private.can_write_storage_object(p_bucket_id text, p_path text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  required_permission text := private.storage_bucket_permission(p_bucket_id);
begin
  return p_bucket_id in ('artifact-files', 'initiative-documents')
    and private.storage_path_is_owned(p_path)
    and required_permission is not null
    and private.has_permission(required_permission);
end;
$$;

create function private.can_read_storage_object(p_bucket_id text, p_path text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  registered_state text;
  owner_path boolean := private.storage_path_is_owned(p_path);
begin
  if p_bucket_id not in ('artifact-files', 'initiative-documents') then
    return false;
  end if;
  select f.state into registered_state
  from api.file_objects f
  where f.bucket_id = p_bucket_id and f.object_path = p_path;

  -- An unregistered upload is readable only by its path owner so the client can
  -- complete registration. Once metadata exists, pending/quarantined/failed/
  -- deleted objects are not downloadable, including by their owner.
  if registered_state is not null then
    if registered_state <> 'ready' then return false; end if;
    if owner_path then return true; end if;
    return private.has_permission('arb:decide')
      or private.has_permission('users:read');
  end if;
  return owner_path;
end;
$$;

create policy file_objects_select_owner_or_reviewer on api.file_objects
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or private.has_permission('arb:decide')
    or private.has_permission('users:read')
  );

-- The client never writes metadata directly; the RPC below validates the
-- object, owner, context, MIME, size, checksum and state transition.
revoke all on table api.file_objects from public, anon, authenticated, service_role;
revoke all on function private.storage_path_is_owned(text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.storage_bucket_permission(text) from public, anon, authenticated, service_role;
revoke all on function private.can_write_storage_object(text, text) from public, anon, authenticated, service_role;
revoke all on function private.can_read_storage_object(text, text) from public, anon, authenticated, service_role;

grant execute on function private.storage_path_is_owned(text, uuid) to authenticated;
grant execute on function private.storage_bucket_permission(text) to authenticated;
grant execute on function private.can_write_storage_object(text, text) to authenticated;
grant execute on function private.can_read_storage_object(text, text) to authenticated;
grant select on api.file_objects to authenticated;

create function api.register_file_object(
  p_bucket_id text,
  p_object_path text,
  p_object_id uuid,
  p_context text,
  p_aggregate_id text,
  p_entity_id text,
  p_version integer,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_source_provider text default 'supabase'
)
returns api.file_objects
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved api.file_objects;
  clean_bucket text := btrim(coalesce(p_bucket_id, ''));
  clean_path text := btrim(coalesce(p_object_path, ''));
  clean_mime text := lower(btrim(coalesce(p_mime_type, '')));
  clean_sha text := lower(btrim(coalesce(p_sha256, '')));
  clean_context text := btrim(coalesce(p_context, ''));
  clean_source text := btrim(coalesce(p_source_provider, 'supabase'));
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if clean_bucket not in ('artifact-files', 'initiative-documents')
    or clean_context not in ('artifact', 'initiative')
    or (clean_context = 'artifact' and clean_bucket <> 'artifact-files')
    or (clean_context = 'initiative' and clean_bucket <> 'initiative-documents')
    or not private.can_write_storage_object(clean_bucket, clean_path)
    or p_object_id is null
    or btrim(coalesce(p_aggregate_id, '')) = ''
    or btrim(coalesce(p_entity_id, '')) = ''
    or p_version is null or p_version <= 0 then
    raise exception 'Metadata de objeto no autorizada o incompleta' using errcode = '42501';
  end if;
  if clean_mime not in (
    'application/json', 'application/octet-stream', 'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/gif', 'image/jpeg', 'image/png', 'image/svg+xml',
    'text/csv', 'text/markdown', 'text/plain', 'text/yaml'
  ) then
    raise exception 'Tipo MIME no permitido' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes < 0 or p_size_bytes > 52428800 then
    raise exception 'El tamaño del objeto no es válido' using errcode = '22023';
  end if;
  if clean_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'El checksum no tiene formato SHA-256' using errcode = '22023';
  end if;
  if clean_source not in ('supabase', 'external') then
    raise exception 'Proveedor de origen no permitido' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.id = p_object_id and o.bucket_id = clean_bucket and o.name = clean_path
  ) then
    raise exception 'El objeto de Storage no existe' using errcode = 'P0002';
  end if;

  insert into api.file_objects (
    object_id, owner_id, bucket_id, object_path, context, aggregate_id,
    entity_id, version, mime_type, size_bytes, sha256, source_provider,
    state, created_by
  ) values (
    p_object_id, actor, clean_bucket, clean_path, clean_context,
    btrim(p_aggregate_id), btrim(p_entity_id), p_version, clean_mime,
    p_size_bytes, clean_sha, clean_source, 'pending', actor
  ) returning * into saved;
  return saved;
exception
  when unique_violation then
    raise exception 'El objeto o la ruta ya tienen metadata registrada' using errcode = '23505';
end;
$$;
comment on function api.register_file_object(text,text,uuid,text,text,text,integer,text,bigint,text,text) is
  'Registra metadata de un objeto ya cargado. No acepta blobs ni URLs firmadas.';

create function api.mark_file_object_ready(p_file_id uuid)
returns api.file_objects
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved api.file_objects;
begin
  if actor is null then raise exception 'Se requiere sesión' using errcode = '42501'; end if;
  perform private.assert_session_active();
  update api.file_objects f
  set state = 'ready', updated_at = now()
  where f.id = p_file_id
    and f.owner_id = actor
    and f.state = 'pending'
    and exists (select 1 from storage.objects o where o.id = f.object_id and o.bucket_id = f.bucket_id and o.name = f.object_path)
  returning f.* into saved;
  if not found then raise exception 'El objeto no puede pasar a ready' using errcode = 'P0002'; end if;
  return saved;
end;
$$;

create function api.mark_file_object_deleted(p_file_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Se requiere sesión' using errcode = '42501'; end if;
  perform private.assert_session_active();
  update api.file_objects f
  set state = 'deleted', deleted_at = now(), updated_at = now()
  where f.id = p_file_id and f.owner_id = actor and f.state <> 'deleted';
  if not found then raise exception 'El objeto no puede marcarse como deleted' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function api.register_file_object(text,text,uuid,text,text,text,integer,text,bigint,text,text) from public, anon, authenticated, service_role;
revoke all on function api.mark_file_object_ready(uuid) from public, anon, authenticated, service_role;
revoke all on function api.mark_file_object_deleted(uuid) from public, anon, authenticated, service_role;
grant execute on function api.register_file_object(text,text,uuid,text,text,text,integer,text,bigint,text,text) to authenticated;
grant execute on function api.mark_file_object_ready(uuid) to authenticated;
grant execute on function api.mark_file_object_deleted(uuid) to authenticated;

create policy storage_poc_select on storage.objects
  for select to authenticated using (private.can_read_storage_object(bucket_id, name));
create policy storage_poc_insert on storage.objects
  for insert to authenticated with check (private.can_write_storage_object(bucket_id, name));
create policy storage_poc_update on storage.objects
  for update to authenticated
  using (private.can_write_storage_object(bucket_id, name))
  with check (private.can_write_storage_object(bucket_id, name));
create policy storage_poc_delete on storage.objects
  for delete to authenticated using (private.can_write_storage_object(bucket_id, name));

notify pgrst, 'reload schema';
commit;
