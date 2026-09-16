-- F6.3 additive privilege correction: remove inherited PUBLIC Storage
-- table access and expose only the operations needed by authenticated uploads.
begin;

revoke all on table storage.objects from public, anon;
grant select, insert on table storage.objects to authenticated;
revoke update, delete, truncate, references, trigger on table storage.objects from authenticated;

grant execute on function private.storage_path_is_well_formed(text) to authenticated;
grant execute on function private.storage_path_matches_metadata(text, text, text, text, integer, uuid) to authenticated;
grant execute on function private.can_mutate_storage_object(text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
