-- F6.3 owner-only and active-session visibility hardening.
-- Metadata and physical objects share the same owner-only, active-session boundary.
begin;

create or replace function private.is_session_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.sessions s
    join api.user_profiles p on p.id = s.user_id
    where s.id = private.current_session_id()
      and s.user_id = auth.uid()
      and p.status = 'active'
      and (s.not_after is null or s.not_after > now())
  )
$$;

create or replace function private.can_write_storage_object(p_bucket_id text, p_path text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  required_permission text := private.storage_bucket_permission(p_bucket_id);
begin
  if not private.is_session_active() then
    return false;
  end if;
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
  if not private.is_session_active()
    or p_bucket_id not in ('artifact-files', 'initiative-documents')
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

drop policy if exists file_objects_select_owner_or_reviewer on api.file_objects;
create policy file_objects_select_owner_active on api.file_objects
  for select to authenticated
  using (
    (select private.is_session_active())
    and owner_id = (select auth.uid())
  );

notify pgrst, 'reload schema';
commit;
