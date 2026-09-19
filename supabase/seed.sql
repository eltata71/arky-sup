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

-- ---------------------------------------------------------------- E2E only
--
-- LOCAL ONLY. Esta función existe para que `scripts/seedE2E.mjs` pueda crear el
-- perfil de la cuenta de pruebas sin conceder privilegios sobre
-- `api.user_profiles` a `service_role` —que es la postura deny-by-default de
-- ADR-003 y no se toca—. Vive en el seed y no en una migración **a propósito**:
-- un seed no se despliega nunca, así que esta puerta no puede existir en un
-- proyecto remoto ni por descuido.
--
-- Y vive en `public`, no en `api`, por una razón concreta: los tipos generados
-- se sacan con `--schema api`, así que `supabase/database.types.ts` es el
-- contrato de lo que el producto puede llamar **en un despliegue**. Un ayudante
-- de pruebas declarado ahí sería una función que el código cree tener y que el
-- proyecto remoto no tiene; el gate de tipos lo detectó, que es su trabajo.
create or replace function public.seed_e2e_profile(p_uid uuid, p_display_name text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into api.user_profiles (id, role, status, display_name)
  values (p_uid, 'superadmin', 'active', p_display_name)
  on conflict (id) do update
    set role = 'superadmin', status = 'active', display_name = excluded.display_name;
end;
$$;
revoke all on function public.seed_e2e_profile(uuid, text) from public, anon, authenticated;
grant execute on function public.seed_e2e_profile(uuid, text) to service_role;
notify pgrst, 'reload schema';
