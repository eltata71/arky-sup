begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

select has_table('api', 'platform_reference_parameters', 'Existe el singleton de parámetros globales');
select columns_are('api', 'platform_reference_parameters',
  array['key', 'data', 'revision', 'created_at', 'updated_at'],
  'La tabla solo conserva clave, parámetros, revisión y trazabilidad');
select ok((select relrowsecurity from pg_class where oid = 'api.platform_reference_parameters'::regclass),
  'Los parámetros globales tienen RLS activa');
select ok(not has_table_privilege('anon', 'api.platform_reference_parameters', 'SELECT,INSERT,UPDATE,DELETE'),
  'Anónimo no accede directamente a parámetros globales');
select ok(not has_table_privilege('authenticated', 'api.platform_reference_parameters', 'SELECT,INSERT,UPDATE,DELETE'),
  'Cliente autenticado no accede directamente a parámetros globales');
select ok(has_function_privilege('authenticated', 'api.load_platform_reference_parameters()', 'EXECUTE'),
  'La lectura solo ocurre por RPC');
select ok(has_function_privilege('authenticated', 'api.save_platform_reference_parameters(jsonb,bigint)', 'EXECUTE'),
  'El guardado solo ocurre por RPC');

insert into auth.users (id, email) values
  ('66000000-0000-4000-8000-000000000001', 'parameters-admin@example.invalid'),
  ('66000000-0000-4000-8000-000000000002', 'parameters-viewer@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('66000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('66000000-0000-4000-8000-000000000002', 'viewer', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('76000000-0000-4000-8000-000000000001', '66000000-0000-4000-8000-000000000001', null),
  ('76000000-0000-4000-8000-000000000002', '66000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"66000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.save_platform_reference_parameters('{"globalContext":["Estándar rechazado"]}', 1)$$,
  'P0001', 'Conflicto de parámetros globales: recarga antes de guardar',
  'La primera escritura exige revisión esperada cero');
select is((select (api.save_platform_reference_parameters('{"globalContext":["Estándar aprobado"]}', 0)).revision), 1::bigint,
  'Administración crea el singleton con revisión uno');
select is((select (api.save_platform_reference_parameters('{"globalContext":["Estándar actualizado"]}', 1)).revision), 2::bigint,
  'Administración actualiza con revisión vigente');
select is((select api.load_platform_reference_parameters() -> 'globalContext'), '["Estándar actualizado"]'::jsonb,
  'Administración lee el parámetro global por RPC');
select is((select (api.save_platform_reference_parameters('{"featureEnabled":true,"maxItems":3,"optional":null}', 2)).revision), 3::bigint,
  'Los escalares JSON seguros no interrumpen el guard de secretos');
select throws_ok($$select api.save_platform_reference_parameters('{"globalContext":[]}', 1)$$,
  'P0001', 'Conflicto de parámetros globales: recarga antes de guardar',
  'Una revisión obsoleta no pisa parámetros globales');
select throws_ok($$select api.save_platform_reference_parameters('{"aiConfig":{"apiKey":"no-debe-salir"}}', 2)$$,
  '22023', 'Los parámetros globales no pueden contener claves de proveedor',
  'Una clave de proveedor no entra en parámetros globales');
select throws_ok($$select api.save_platform_reference_parameters('{"nested":{"client_secret":"no-debe-salir"}}', 2)$$,
  '22023', 'Los parámetros globales no pueden contener claves de proveedor',
  'Un secreto con nombre alternativo no entra en parámetros globales');
select throws_ok(
  $$select api.save_platform_reference_parameters(jsonb_build_object('globalContext', jsonb_build_array('AIza' || repeat('A', 35))), 2)$$,
  '22023', 'Los parámetros globales no pueden contener claves de proveedor',
  'Una forma conocida de clave dentro de contexto global no entra en parámetros globales');
select throws_ok(
  $$select api.save_platform_reference_parameters('{"globalContext":["Contact person@example.invalid"]}', 3)$$,
  '22023', 'Los parámetros globales no pueden contener datos personales',
  'Un correo embebido no entra en parámetros globales');
select throws_ok(
  $$select api.save_platform_reference_parameters('{"contact_phone":"555 123 4567"}', 3)$$,
  '22023', 'Los parámetros globales no pueden contener datos personales',
  'Un campo personal no entra en parámetros globales');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"66000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000002"}';
select throws_ok('select api.load_platform_reference_parameters()',
  '42501', 'Permiso insuficiente: users:read',
  'Un viewer no lee parámetros globales');
select throws_ok($$select api.save_platform_reference_parameters('{"globalContext":[]}', 2)$$,
  '42501', 'Permiso insuficiente: users:read',
  'Un viewer no cambia parámetros globales');
reset role;

select * from finish();
rollback;
