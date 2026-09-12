-- LOCAL ONLY: no passwords, sessions, identities, real people or remote imports.
-- These rows are SQL fixtures, not usable Auth accounts. Never deploy seeds.
begin;
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'probe-a@example.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'probe-b@example.invalid')
on conflict (id) do nothing;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into api.platform_probes (id, owner_id, label) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'synthetic-a')
on conflict (id) do nothing;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into api.platform_probes (id, owner_id, label) values
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'synthetic-b')
on conflict (id) do nothing;
commit;
