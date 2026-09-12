begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

select has_table('api', 'user_settings', 'El piloto tiene tabla de preferencias por usuario');
select columns_are('api', 'user_settings',
  array['id', 'settings', 'revision', 'created_at', 'updated_at'],
  'La tabla conserva únicamente preferencias, revisión y trazabilidad');
select ok((select relrowsecurity from pg_class where oid = 'api.user_settings'::regclass),
  'Las preferencias tienen RLS activa');
select ok(not has_table_privilege('anon', 'api.user_settings', 'SELECT'),
  'Anónimo no lee preferencias');
select ok(not has_table_privilege('authenticated', 'api.user_settings', 'INSERT'),
  'Cliente autenticado no inserta preferencias directamente');
select ok(not has_table_privilege('authenticated', 'api.user_settings', 'UPDATE'),
  'Cliente autenticado no actualiza preferencias directamente');
select ok(has_function_privilege('authenticated', 'api.save_user_settings(jsonb,bigint)', 'EXECUTE'),
  'Cliente autenticado recibe únicamente la RPC de guardado');

insert into auth.users (id, email) values
  ('60000000-0000-4000-8000-000000000001', 'settings-owner@example.invalid'),
  ('60000000-0000-4000-8000-000000000002', 'settings-other@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('60000000-0000-4000-8000-000000000001', 'viewer', 'active'),
  ('60000000-0000-4000-8000-000000000002', 'viewer', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', null),
  ('70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"70000000-0000-4000-8000-000000000001"}';
select is((select (api.save_user_settings('{"theme":"dark","language":"es"}', 0)).revision), 1::bigint,
  'El primer guardado crea revisión uno');
select is((select (api.save_user_settings('{"theme":"light","language":"es"}', 1)).revision), 2::bigint,
  'El guardado con revisión vigente avanza la revisión');
select throws_ok($$select api.save_user_settings('{"theme":"dark"}', 1)$$,
  'P0001', 'Conflicto de configuración: recarga antes de guardar',
  'Un guardado desactualizado no pisa una edición concurrente');
select throws_ok($$select api.save_user_settings('{"aiConfig":{"apiKey":"no-debe-salir"}}', 2)$$,
  '22023', 'La configuración no puede contener claves de proveedor',
  'Una clave BYOK no entra en PostgreSQL');
select results_eq($$select id from api.user_settings$$,
  array['60000000-0000-4000-8000-000000000001'::uuid],
  'RLS devuelve al propietario solo su fila');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"70000000-0000-4000-8000-000000000002"}';
select is((select count(*)::int from api.user_settings), 0,
  'Otro usuario no lee preferencias ajenas');
reset role;

-- Una sesión eliminada no muta configuración: revocar equivale a borrar la fila.
delete from auth.sessions where id = '70000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"70000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.save_user_settings('{"theme":"dark"}', 2)$$,
  '42501', 'La sesión no está activa: vuelva a iniciar sesión',
  'Una sesión revocada no guarda preferencias');
reset role;

select * from finish();
rollback;
