-- The RLS policies call this fail-closed helper directly.
begin;
revoke all on function private.is_session_active() from public, anon, authenticated, service_role;
grant execute on function private.is_session_active() to authenticated;
notify pgrst, 'reload schema';
commit;
