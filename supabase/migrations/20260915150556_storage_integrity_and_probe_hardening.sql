-- F6.3 additive hardening after independent review.
-- Storage's managed ACL remains platform-owned; the application relies on the
-- API schema boundary plus restrictive RLS, not on revoking that ACL as postgres.
begin;

create or replace function private.storage_path_matches_bucket(p_bucket_id text, p_path text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_bucket_id = 'artifact-files' and split_part(p_path, '/', 2) = 'artifact')
      or (p_bucket_id = 'initiative-documents' and split_part(p_path, '/', 2) = 'initiative')
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
    and private.storage_path_matches_bucket(p_bucket_id, p_path)
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
    or not private.storage_path_is_owned(p_path)
    or not private.storage_path_is_well_formed(p_path)
    or not private.storage_path_matches_bucket(p_bucket_id, p_path) then
    return false;
  end if;

  select f.state into registered_state
  from api.file_objects f
  where f.bucket_id = p_bucket_id and f.object_path = p_path;

  return registered_state is null or registered_state = 'ready';
end;
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
    or not private.storage_path_matches_bucket(clean_bucket, clean_path)
    or (clean_context = 'artifact' and clean_bucket <> 'artifact-files')
    or (clean_context = 'initiative' and clean_bucket <> 'initiative-documents')
    or not private.can_write_storage_object(clean_bucket, clean_path) then
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
    select 1
    from storage.objects o
    where o.id = p_object_id
      and o.bucket_id = clean_bucket
      and o.name = clean_path
      and coalesce(o.owner_id, o.owner::text) = actor::text
      and lower(coalesce(o.metadata->>'mimetype', '')) = clean_mime
      and (o.metadata->>'size') ~ '^[0-9]+$'
      and (o.metadata->>'size')::bigint = p_size_bytes
      and lower(coalesce(o.metadata->>'sha256', '')) = clean_sha
  ) then
    raise exception 'El objeto, propietario o metadata física no coincide' using errcode = 'P0002';
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

-- A client can upload/register pending metadata. Only a trusted backend role
-- may promote it after verifying the bytes and declared SHA-256 out of band.
create or replace function api.mark_file_object_ready(p_file_id uuid)
returns api.file_objects
language plpgsql security definer set search_path = '' as $$
declare
  saved api.file_objects;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'Solo el backend confiable puede marcar ready' using errcode = '42501';
  end if;
  update api.file_objects f
  set state = 'ready', updated_at = now()
  where f.id = p_file_id
    and f.state = 'pending'
    and exists (
      select 1 from storage.objects o
      where o.id = f.object_id
        and o.bucket_id = f.bucket_id
        and o.name = f.object_path
        and coalesce(o.owner_id, o.owner::text) = f.owner_id::text
        and lower(coalesce(o.metadata->>'mimetype', '')) = f.mime_type
        and (o.metadata->>'size') ~ '^[0-9]+$'
        and (o.metadata->>'size')::bigint = f.size_bytes
        and lower(coalesce(o.metadata->>'sha256', '')) = f.sha256
    )
  returning f.* into saved;
  if not found then raise exception 'El objeto o metadata no puede pasar a ready' using errcode = 'P0002'; end if;
  return saved;
end;
$$;

revoke all on function private.storage_path_matches_bucket(text, text) from public, anon, authenticated, service_role;
revoke all on function api.mark_file_object_ready(uuid) from public, anon, authenticated, service_role;
grant execute on function private.storage_path_matches_bucket(text, text) to authenticated;
grant execute on function api.mark_file_object_ready(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
