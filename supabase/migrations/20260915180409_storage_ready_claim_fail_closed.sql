-- F6.3 final fail-closed hardening.
-- A missing role claim must never authorize promotion to ready.
begin;

create or replace function api.mark_file_object_ready(p_file_id uuid)
returns api.file_objects
language plpgsql security definer set search_path = '' as $$
declare
  saved api.file_objects;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
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
  if not found then
    raise exception 'El objeto o metadata no puede pasar a ready' using errcode = 'P0002';
  end if;
  return saved;
end;
$$;

revoke all on function api.mark_file_object_ready(uuid) from public, anon, authenticated, service_role;
grant execute on function api.mark_file_object_ready(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
