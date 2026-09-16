-- F6.3 final hardening after independent review.
-- Enforce bucket-specific MIME/size metadata and deny direct client mutation
-- of Storage rows. Physical deletion remains a F7 functional boundary.
begin;

create or replace function private.storage_object_metadata_allowed(
  p_bucket_id text,
  p_metadata jsonb
)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from storage.buckets b
    where b.id = p_bucket_id
      and exists (
        select 1
        from unnest(coalesce(b.allowed_mime_types, '{}'::text[])) as allowed(mime)
        where lower(allowed.mime) = lower(coalesce(p_metadata->>'mimetype', ''))
      )
      and (p_metadata->>'size') ~ '^[0-9]+$'
      and (p_metadata->>'size')::bigint between 0 and b.file_size_limit
  )
$$;

create or replace function private.can_mutate_storage_object(p_bucket_id text, p_path text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select false
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
  physical_metadata jsonb;
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
  select o.metadata into physical_metadata
  from storage.objects o
  where o.id = p_object_id
    and o.bucket_id = clean_bucket
    and o.name = clean_path
    and coalesce(o.owner_id, o.owner::text) = actor::text;
  if physical_metadata is null
    or not private.storage_object_metadata_allowed(clean_bucket, physical_metadata)
    or lower(coalesce(physical_metadata->>'mimetype', '')) <> clean_mime
    or (physical_metadata->>'size')::bigint <> p_size_bytes
    or lower(coalesce(physical_metadata->>'sha256', '')) <> clean_sha then
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
      select 1
      from storage.objects o
      where o.id = f.object_id
        and o.bucket_id = f.bucket_id
        and o.name = f.object_path
        and coalesce(o.owner_id, o.owner::text) = f.owner_id::text
        and private.storage_object_metadata_allowed(f.bucket_id, o.metadata)
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

create or replace function private.storage_path_matches_bucket(p_bucket_id text, p_path text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_bucket_id = 'artifact-files' and split_part(p_path, '/', 2) = 'artifact')
      or (p_bucket_id = 'initiative-documents' and split_part(p_path, '/', 2) = 'initiative')
$$;

revoke all on function private.storage_object_metadata_allowed(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.storage_object_metadata_allowed(text, jsonb) to authenticated;
revoke all on function private.can_mutate_storage_object(text, text) from public, anon, authenticated, service_role;
grant execute on function private.can_mutate_storage_object(text, text) to authenticated;

drop policy if exists storage_poc_insert on storage.objects;
drop policy if exists storage_poc_insert_guard on storage.objects;
create policy storage_poc_insert on storage.objects
  as permissive for insert to authenticated
  with check (
    private.can_write_storage_object(bucket_id, name)
    and owner = (select auth.uid())
    and private.storage_object_metadata_allowed(bucket_id, metadata)
  );
create policy storage_poc_insert_guard on storage.objects
  as restrictive for insert to authenticated
  with check (
    private.can_write_storage_object(bucket_id, name)
    and owner = (select auth.uid())
    and private.storage_object_metadata_allowed(bucket_id, metadata)
  );

notify pgrst, 'reload schema';
commit;
