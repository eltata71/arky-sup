-- F6.3 additive RLS guard: managed Storage table grants remain owned by
-- supabase_storage_admin, so anonymous denial is enforced explicitly by RLS.
begin;

drop policy if exists storage_poc_anon_guard on storage.objects;
create policy storage_poc_anon_guard on storage.objects
  as restrictive for all to anon
  using (false)
  with check (false);

notify pgrst, 'reload schema';
commit;
