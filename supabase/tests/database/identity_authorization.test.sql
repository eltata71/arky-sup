begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

/* ------------------------------------------------------------------ forma */
select has_table('api', 'user_profiles', 'Perfiles de usuario existen');
select has_table('private', 'role_permissions', 'Matriz de permisos existe como datos');
select has_table('private', 'authorization_audit', 'Auditoría de autorización existe');
select ok((select relrowsecurity from pg_class where oid = 'api.user_profiles'::regclass),
  'Los perfiles tienen RLS activa');
-- Deliberadamente sin FORCE: el helper SECURITY DEFINER lee esta tabla y, con
-- FORCE, el propietario quedaría sujeto a la política que llama al helper.
select ok(not (select relforcerowsecurity from pg_class where oid = 'api.user_profiles'::regclass),
  'Los perfiles NO fuerzan RLS (evita la recursión de la política con el helper)');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.authorization_audit'::regclass),
  'La auditoría fuerza RLS');
select columns_are('private', 'role_permissions', array['role', 'permission'],
  'La matriz no guarda nada más que rol y permiso');
select columns_are('private', 'authorization_audit',
  array['id', 'occurred_at', 'actor_id', 'target_id', 'action', 'from_role', 'to_role'],
  'La auditoría no guarda datos personales');

select is((select count(*)::int from private.role_permissions), 63,
  'La matriz tiene las 63 celdas de la política');

/* ------------------------------------------------------------ aislamiento */
select ok(not has_schema_privilege('anon', 'api', 'USAGE'), 'Anónimo no alcanza el esquema api');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'El cliente no alcanza el esquema privado');
select ok(not has_table_privilege('anon', 'api.user_profiles', 'SELECT'),
  'Anónimo no lee perfiles');
select ok(not has_table_privilege('authenticated', 'api.user_profiles', 'INSERT'),
  'El cliente no inserta perfiles directamente');
select ok(not has_table_privilege('authenticated', 'api.user_profiles', 'DELETE'),
  'El cliente no borra perfiles directamente');
select ok(has_table_privilege('authenticated', 'api.user_profiles', 'SELECT'),
  'El cliente autenticado sí lee perfiles (RLS decide filas)');
select ok(has_column_privilege('authenticated', 'api.user_profiles', 'display_name', 'UPDATE'),
  'El cliente puede editar su nombre');
select ok(not has_column_privilege('authenticated', 'api.user_profiles', 'role', 'UPDATE'),
  'El cliente NO puede editar su rol');
select ok(not has_column_privilege('authenticated', 'api.user_profiles', 'status', 'UPDATE'),
  'El cliente NO puede editar su estado');
select ok(not has_function_privilege('anon', 'private.has_permission(text)', 'EXECUTE'),
  'Anónimo no ejecuta el helper de permisos');
select ok(not has_function_privilege('authenticated', 'private.assert_role_is_not_self(uuid)', 'EXECUTE'),
  'El cliente no ejecuta la guarda interna');
select ok(not has_function_privilege('authenticated', 'private.touch_user_profiles()', 'EXECUTE'),
  'El disparador no es un RPC');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc
  where oid = 'private.has_permission(text)'::regprocedure),
  'El helper fija search_path vacío y es SECURITY DEFINER');

/* ------------------------------------------------------------ escenario */
truncate api.user_profiles, private.authorization_audit;
delete from auth.users;
insert into auth.users (id, email) values
  ('30000000-0000-4000-8000-000000000001', 'super@example.invalid'),
  ('30000000-0000-4000-8000-000000000002', 'admin@example.invalid'),
  ('30000000-0000-4000-8000-000000000003', 'arch@example.invalid'),
  ('30000000-0000-4000-8000-000000000004', 'viewer@example.invalid'),
  ('30000000-0000-4000-8000-000000000005', 'disabled@example.invalid');

insert into api.user_profiles (id, role, status) values
  ('30000000-0000-4000-8000-000000000001', 'superadmin', 'active'),
  ('30000000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('30000000-0000-4000-8000-000000000003', 'architect', 'active'),
  ('30000000-0000-4000-8000-000000000004', 'viewer', 'active'),
  ('30000000-0000-4000-8000-000000000005', 'admin', 'disabled');

/* --------------------------------------------------- un observador (viewer) */
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-4000-8000-000000000004","role":"authenticated"}';
select results_eq($$select id from api.user_profiles$$,
  array['30000000-0000-4000-8000-000000000004'::uuid],
  'Un observador solo ve su propio perfil');
select is((select exists (select 1 from api.current_permissions())), false,
  'Un observador sin perfil de directorio no obtiene permisos de más');
select is((select 'portfolio:read' in (select * from api.current_permissions())), true,
  'Un observador sí lee el portafolio');
select throws_ok($$select api.set_user_role('30000000-0000-4000-8000-000000000003', 'admin')$$,
  '42501', 'Permiso insuficiente: users:update',
  'Un observador no cambia roles');
select throws_ok($$insert into api.user_profiles (id, role)
  values ('30000000-0000-4000-8000-000000000099', 'superadmin')$$,
  '42501', NULL,
  'Un observador no se auto-provisiona un perfil');
reset role;

/* ------------------------------------------------------- cuenta deshabilitada */
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from api.user_profiles), 0,
  'Una cuenta deshabilitada no ve su propio perfil');
select is((select 'users:read' in (select * from api.current_permissions())), false,
  'Un observador no tiene permiso de directorio');
select is((select count(*)::int from api.current_permissions()), 0,
  'Una cuenta deshabilitada no obtiene ningún permiso (falla cerrado)');
reset role;

/* ---------------------------------------------------------------- el admin */
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from api.user_profiles), 5,
  'Un administrador ve el directorio completo');
select lives_ok($$select api.set_user_role('30000000-0000-4000-8000-000000000003', 'reviewer')$$,
  'Un administrador cambia un rol no privilegiado');
select throws_ok($$select api.set_user_role('30000000-0000-4000-8000-000000000003', 'admin')$$,
  '42501', 'Solo superadmin concede roles administrativos',
  'Un administrador NO concede roles administrativos');
select throws_ok($$select api.set_user_role('30000000-0000-4000-8000-000000000002', 'viewer')$$,
  '42501', 'Nadie cambia su propio rol',
  'Nadie cambia su propio rol');
select throws_ok($$select api.set_user_status('30000000-0000-4000-8000-000000000002', 'disabled')$$,
  '42501', 'Nadie cambia su propio rol',
  'Nadie se deshabilita a sí mismo');
select throws_ok($$select api.set_user_role('30000000-0000-4000-8000-000000000003', 'orquestador')$$,
  '22023', 'Rol desconocido: orquestador',
  'Un rol inventado se rechaza');
reset role;

/* ------------------------------------------------------------ el superadmin */
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select api.set_user_role('30000000-0000-4000-8000-000000000003', 'admin')$$,
  'Un superadministrador sí concede roles administrativos');
select lives_ok($$select api.set_user_status('30000000-0000-4000-8000-000000000004', 'disabled')$$,
  'Un superadministrador deshabilita una cuenta');
select throws_ok($$select api.provision_user_profile('30000000-0000-4000-8000-000000000003', 'viewer')$$,
  '23505', 'El perfil ya existe',
  'No se re-provisiona un perfil existente');
reset role;

/* ---------------------------------------------------------------- auditoría */
select is((select count(*)::int from private.authorization_audit), 3,
  'Cada cambio autorizado deja exactamente una entrada de auditoría');
select results_eq($$select action, from_role, to_role from private.authorization_audit order by occurred_at$$,
  $$values ('set-role'::text, 'architect'::text, 'reviewer'::text),
           ('set-role'::text, 'reviewer'::text, 'admin'::text),
           ('set-status'::text, NULL::text, NULL::text)$$,
  'La auditoría registra la transición real de rol');
select is((select count(*)::int from private.authorization_audit
  where actor_id = '30000000-0000-4000-8000-000000000002'
    and action = 'set-role' and from_role = 'architect' and to_role = 'reviewer'), 1,
  'La auditoría atribuye la acción al actor correcto');

/* ------------------------------------------------------- mutación rechazada */
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$update api.user_profiles set role = 'viewer'
  where id = '30000000-0000-4000-8000-000000000003'$$,
  '42501', NULL,
  'Ni un superadministrador cambia un rol por UPDATE directo');
select lives_ok($$update api.user_profiles set display_name = 'Arquitecto Uno'
  where id = '30000000-0000-4000-8000-000000000001'$$,
  'Cada quien sí puede cambiar su propio nombre');
select throws_ok($$delete from api.user_profiles
  where id = '30000000-0000-4000-8000-000000000003'$$,
  '42501', NULL,
  'El borrado directo está cerrado: solo por RPC auditada');
reset role;

select * from finish();
rollback;
