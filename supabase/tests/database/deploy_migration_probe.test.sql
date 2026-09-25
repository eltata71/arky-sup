-- F6-10 · La sonda del despliegue: responde sí o no, y no abre nada más.
--
-- Lo que se afirma es sobre todo lo que **no** cambia: `deploy_status` contiene
-- una sola función; anónimo sigue sin alcanzar `api` ni `public`; ninguna
-- función de `api` se vuelve ejecutable por anónimo; ninguna tabla de `api` es
-- legible por él. Y la sonda misma: sí para una versión aplicada, no para una
-- que no existe, y rechazo para lo que no es una versión.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

-- ───────────────────────────────────────────── lo que no se abre
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'deploy_status'), 1,
  'deploy_status contiene una sola función');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'deploy_status'), 0,
  'deploy_status no contiene tablas, vistas ni secuencias');
select ok(not has_schema_privilege('anon', 'api', 'USAGE'), 'Anónimo sigue sin alcanzar el esquema api');
select ok(not has_schema_privilege('anon', 'public', 'USAGE'), 'Anónimo sigue sin alcanzar el esquema public');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and has_function_privilege('anon', p.oid, 'EXECUTE')), 0,
  'Ninguna función de api es ejecutable por anónimo');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'api' and c.relkind in ('r', 'v', 'm', 'p')
             and has_table_privilege('anon', c.oid, 'SELECT')), 0,
  'Ninguna tabla de api es legible por anónimo');
select ok(not has_schema_privilege('anon', 'deploy_status', 'CREATE'),
  'Anónimo no puede crear nada en deploy_status');

-- ───────────────────────────────────────────── lo que se abre, y a quién
select ok(has_function_privilege('anon', 'deploy_status.migration_applied(text)', 'EXECUTE'),
  'El despliegue pregunta sin credenciales');
select ok(has_function_privilege('authenticated', 'deploy_status.migration_applied(text)', 'EXECUTE'),
  'Y con sesión también');

-- ───────────────────────────────────────────── la respuesta
set local role anon;
select is(deploy_status.migration_applied('20260926140000'), true,
  'Sí para una migración aplicada: la propia');
select is(deploy_status.migration_applied('20260912001855'), true,
  'Sí para la primera del repositorio');
select is(deploy_status.migration_applied('20991231235959'), false,
  'No para una versión que no está aplicada');
select throws_ok($$select deploy_status.migration_applied('../etc')$$,
  '22023', 'La versión de migración son 14 dígitos',
  'Lo que no es una versión se rechaza, no se busca');
select throws_ok($$select deploy_status.migration_applied(null)$$,
  '22023', 'La versión de migración son 14 dígitos',
  'Tampoco un nulo');

select * from finish();
rollback;
