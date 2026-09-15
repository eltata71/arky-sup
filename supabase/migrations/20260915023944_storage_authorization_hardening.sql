-- F6.3 additive hardening: narrow Storage authorization and make the
-- contract fail closed if an unrelated storage.objects policy is introduced.
begin;

create or replace function private.storage_path_is_well_formed(p_path text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_path is not null
    and p_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/(artifact|initiative)/[^/]+/[^/]+/v[1-9][0-9]*/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}(\.[A-Za-z0-9][A-Za-z0-9._-]{0,31})?$'
    and p_path !~ '(^|/)\.\.?(/|$)'
    and p_path !~ '[[:cntrl:]]'
$$;

create or replace function private.storage_path_matches_metadata(
  p_path text,
  p_context text,
  p_aggregate_id text,
  p_entity_id text,
  p_version integer,
  p_object_id uuid
)
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.storage_path_is_well_formed(p_path)
    and p_context in ('artifact', 'initiative')
    and btrim(coalesce(p_aggregate_id, '')) <> ''
    and btrim(coalesce(p_entity_id, '')) <> ''
    and p_version is not null
    and p_version > 0
    and p_object_id is not null
    and split_part(p_path, '/', 2) = p_context
    and split_part(p_path, '/', 3) = btrim(p_aggregate_id)
    and split_part(p_path, '/', 4) = btrim(p_entity_id)
    and split_part(p_path, '/', 5) = 'v' || p_version::text
    and lower(split_part(split_part(p_path, '/', 6), '.', 1)) = lower(p_object_id::text)
$$;

create or replace function private.can_write_storage_object(p_bucket_id text, p_path text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  required_permission text := private.storage_bucket_permission(p_bucket_id);
begin
  return p_bucket_id in ('artifact-files', 'initiative-documents')
    and private.storage_path_is_owned(p_path)
    and private.storage_path_is_well_formed(p_path)
    and required_permission is not null
    and private.has_permission(required_permission);
end;
$$;

create or replace function private.can_read_storage_object(p_bucket_id text, p_path text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  registered_state text;
begin
  if p_bucket_id not in ('artifact-files', 'initiative-documents')
    or not private.storage_path_is_owned(p_path) then
    return false;
  end if;

  select f.state into registered_state
  from api.file_objects f
  where f.bucket_id = p_bucket_id and f.object_path = p_path;

  return registered_state is null or registered_state = 'ready';
end;
$$;

create or replace function private.can_mutate_storage_object(p_bucket_id text, p_path text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_write_storage_object(p_bucket_id, p_path)
    and not exists (
      select 1
      from api.file_objects f
      where f.bucket_id = p_bucket_id
        and f.object_path = p_path
        and f.state <> 'pending'
    )
$$;

create or replace function api.register_file_object(
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
  if not private.storage_path_matches_metadata(
    clean_path, clean_context, p_aggregate_id, p_entity_id, p_version, p_object_id
  ) then
    raise exception 'La ruta no coincide con la metadata del objeto' using errcode = '22023';
  end if;
  if not private.storage_path_is_owned(clean_path) then
    raise exception 'La ruta del objeto no pertenece a la sesión' using errcode = '42501';
  end if;
  if clean_bucket not in ('artifact-files', 'initiative-documents')
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

-- Keep direct clients from using the anonymous Storage table privileges.
revoke all on table storage.objects from anon;

-- Unknown permissive policies would be OR-ed with the policies below. Fail
-- closed instead of silently widening access if one appears in the target.
do $$
declare
  unexpected text;
begin
  select string_agg(policyname, ', ' order by policyname)
    into unexpected
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname not in (
      'storage_poc_select', 'storage_poc_insert', 'storage_poc_update', 'storage_poc_delete',
      'storage_poc_select_guard', 'storage_poc_insert_guard',
      'storage_poc_update_guard', 'storage_poc_delete_guard'
    );
  if unexpected is not null then
    raise exception 'Políticas Storage no reconocidas: %', unexpected using errcode = '55000';
  end if;
end;
$$;

drop policy if exists storage_poc_select on storage.objects;
drop policy if exists storage_poc_insert on storage.objects;
drop policy if exists storage_poc_update on storage.objects;
drop policy if exists storage_poc_delete on storage.objects;
drop policy if exists storage_poc_select_guard on storage.objects;
drop policy if exists storage_poc_insert_guard on storage.objects;
drop policy if exists storage_poc_update_guard on storage.objects;
drop policy if exists storage_poc_delete_guard on storage.objects;

create policy storage_poc_select on storage.objects
  as permissive for select to authenticated
  using (
    private.can_read_storage_object(bucket_id, name)
    and owner = (select auth.uid())
  );
create policy storage_poc_insert on storage.objects
  as permissive for insert to authenticated
  with check (
    private.can_write_storage_object(bucket_id, name)
    and owner = (select auth.uid())
  );
create policy storage_poc_update on storage.objects
  as permissive for update to authenticated
  using (private.can_mutate_storage_object(bucket_id, name) and owner = (select auth.uid()))
  with check (private.can_mutate_storage_object(bucket_id, name) and owner = (select auth.uid()));
create policy storage_poc_delete on storage.objects
  as permissive for delete to authenticated
  using (private.can_mutate_storage_object(bucket_id, name) and owner = (select auth.uid()));

-- Restrictive guards make the contract fail closed even if a future permissive
-- policy is added without updating this migration.
create policy storage_poc_select_guard on storage.objects
  as restrictive for select to authenticated
  using (private.can_read_storage_object(bucket_id, name) and owner = (select auth.uid()));
create policy storage_poc_insert_guard on storage.objects
  as restrictive for insert to authenticated
  with check (private.can_write_storage_object(bucket_id, name) and owner = (select auth.uid()));
create policy storage_poc_update_guard on storage.objects
  as restrictive for update to authenticated
  using (private.can_mutate_storage_object(bucket_id, name) and owner = (select auth.uid()))
  with check (private.can_mutate_storage_object(bucket_id, name) and owner = (select auth.uid()));
create policy storage_poc_delete_guard on storage.objects
  as restrictive for delete to authenticated
  using (private.can_mutate_storage_object(bucket_id, name) and owner = (select auth.uid()));

notify pgrst, 'reload schema';
commit;
