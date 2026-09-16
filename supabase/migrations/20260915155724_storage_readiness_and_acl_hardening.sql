-- F6.3 final hardening after independent review.
-- Objects are readable only after catalog metadata reaches ready. The helper
-- ACL is explicit even though private is not exposed by the current Data API.
begin;

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

  return registered_state = 'ready';
end;
$$;

revoke all on function private.storage_path_is_well_formed(text) from public, anon, authenticated, service_role;
revoke all on function private.storage_path_matches_metadata(text, text, text, text, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_write_storage_object(text, text) from public, anon, authenticated, service_role;
revoke all on function private.can_read_storage_object(text, text) from public, anon, authenticated, service_role;
revoke all on function private.can_mutate_storage_object(text, text) from public, anon, authenticated, service_role;
grant execute on function private.storage_path_is_well_formed(text) to authenticated;
grant execute on function private.storage_path_matches_metadata(text, text, text, text, integer, uuid) to authenticated;
grant execute on function private.can_write_storage_object(text, text) to authenticated;
grant execute on function private.can_read_storage_object(text, text) to authenticated;
grant execute on function private.can_mutate_storage_object(text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
