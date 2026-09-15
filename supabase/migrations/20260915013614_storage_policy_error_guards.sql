-- F6.3 correction: keep ownership/path failures distinguishable from
-- permission failures, without editing the applied Storage migration.
begin;

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
  if not private.storage_path_is_owned(clean_path) then
    raise exception 'La ruta del objeto no pertenece a la sesión' using errcode = '42501';
  end if;
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

notify pgrst, 'reload schema';
commit;
