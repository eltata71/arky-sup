-- Plan de agentes 16.4: la ficha del agente se valida, se revisa y se registra
-- en el servidor. Cada regla tiene su caso negativo.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

-- ───────────────────────────────────────────────── superficie y privilegios
select has_table('api', 'agent_profile_changes', 'La bitácora de fichas tiene tabla propia');
select ok((select relrowsecurity from pg_class where oid = 'api.agent_profile_changes'::regclass),
  'La bitácora tiene RLS activa');
select ok(not has_table_privilege('authenticated', 'api.agent_profile_changes', 'SELECT'),
  'El cliente no lee la bitácora directamente');
select ok(not has_table_privilege('authenticated', 'api.agent_profile_changes', 'INSERT'),
  'El cliente no escribe la bitácora directamente');
select ok(not has_table_privilege('authenticated', 'api.agent_profile_changes', 'UPDATE'),
  'El cliente no reescribe la bitácora');
select ok(not has_table_privilege('authenticated', 'api.agent_profile_changes', 'DELETE'),
  'El cliente no borra la bitácora');
select ok(not has_table_privilege('anon', 'api.agent_profile_changes', 'SELECT'),
  'Anónimo no lee la bitácora');
select ok(has_function_privilege('authenticated', 'api.save_agent_profile(jsonb,bigint)', 'EXECUTE'),
  'El cliente autenticado guarda fichas por la RPC');
select ok(not has_function_privilege('anon', 'api.save_agent_profile(jsonb,bigint)', 'EXECUTE'),
  'Anónimo no guarda fichas');
select ok(has_function_privilege('authenticated', 'api.list_agent_profile_changes(text,integer)', 'EXECUTE'),
  'El cliente autenticado lee su bitácora por la RPC');
select ok(not has_function_privilege('authenticated', 'private.agent_profile_problem(jsonb)', 'EXECUTE'),
  'El validador privado no es alcanzable desde el cliente');

insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'agent-profile-owner@example.invalid'),
  ('a1000000-0000-4000-8000-000000000002', 'agent-profile-other@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('a1000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('a1000000-0000-4000-8000-000000000002', 'architect', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', null),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;

-- ───────────────────────────────────────────────────────────── el dueño
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001"}';

select is(api.save_agent_profile('{"agentId":"lucia","alias":"Lucía","modelTier":"deep","maxConcurrentTasks":3,"definitionVersion":1}'::jsonb, 0) ->> 'revision', '1',
  'Crear una ficha devuelve la revisión uno');
select is(api.list_agent_profiles() -> 0 ->> 'revision', '1',
  'La lectura trae la revisión junto al documento');
select is(api.list_agent_profiles() -> 0 ->> 'userId', 'a1000000-0000-4000-8000-000000000001',
  'El servidor estampa el propietario real en el documento');
select is(api.save_agent_profile('{"agentId":"lucia","alias":"Lucía B","modelTier":"deep","maxConcurrentTasks":3,"definitionVersion":1}'::jsonb, 1) ->> 'revision', '2',
  'Guardar con la revisión vigente la avanza');

-- Concurrencia optimista
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","alias":"Vieja"}'::jsonb, 1)$$,
  'P0001', 'Conflicto de ficha: recarga antes de guardar',
  'Una revisión vieja no pisa una edición posterior');
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","alias":"Otra"}'::jsonb, 0)$$,
  'P0001', 'Conflicto de ficha: recarga antes de guardar',
  'Crear sobre una ficha que ya existe es un conflicto');
select throws_ok($$select api.save_agent_profile('{"agentId":"carmen","alias":"Nueva"}'::jsonb, 5)$$,
  'P0001', 'Conflicto de ficha: recarga antes de guardar',
  'Una revisión esperada sobre una ficha inexistente es un conflicto');
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia"}'::jsonb, -1)$$,
  '22023', 'La revisión esperada debe ser cero o positiva',
  'Una revisión negativa no es válida');

-- Ruta heredada: la firma de un argumento guarda sin comprobar revisión, pero
-- pasa por la misma validación y deja el mismo rastro.
select lives_ok($$select api.save_agent_profile('{"agentId":"lucia","alias":"Lucía B","modelTier":"deep","maxConcurrentTasks":3,"definitionVersion":1}'::jsonb)$$,
  'El código aún desplegado puede guardar con un argumento');
select is(api.list_agent_profiles() -> 0 ->> 'revision', '3',
  'La ruta heredada también avanza la revisión');
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","isAdmin":true}'::jsonb)$$,
  '22023', 'La ficha contiene claves no admitidas: isAdmin',
  'La ruta heredada no esquiva la lista blanca');

-- Gobernanza (se conserva)
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","orchestrationRole":"consolidator"}'::jsonb, 2)$$,
  '22023', 'La ficha no puede alterar la gobernanza del agente',
  'La ficha no cambia el papel de orquestación');

-- Lista blanca y límites
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","isAdmin":true}'::jsonb, 2)$$,
  '22023', 'La ficha contiene claves no admitidas: isAdmin',
  'Una clave fuera de la lista blanca no entra');
select throws_ok($$select api.save_agent_profile(jsonb_build_object('agentId','lucia','alias',repeat('a',41)), 2)$$,
  '22023', 'El alias debe tener entre 1 y 40 caracteres',
  'Un alias de 41 caracteres no entra');
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","alias":"  "}'::jsonb, 2)$$,
  '22023', 'El alias debe tener entre 1 y 40 caracteres',
  'Un alias en blanco no entra');
select throws_ok($$select api.save_agent_profile(jsonb_build_object('agentId','lucia','role',repeat('r',121)), 2)$$,
  '22023', 'El rol no puede exceder 120 caracteres',
  'Un rol de 121 caracteres no entra');
select throws_ok($$select api.save_agent_profile(jsonb_build_object('agentId','lucia','instruction',repeat('i',1201)), 2)$$,
  '22023', 'La instrucción no puede exceder 1200 caracteres',
  'Una instrucción de 1201 caracteres no entra');
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","avatar":"123456789"}'::jsonb, 2)$$,
  '22023', 'El avatar no puede exceder 8 caracteres',
  'Un avatar de 9 caracteres no entra');
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","modelTier":"ultra"}'::jsonb, 2)$$,
  '22023', 'modelTier debe ser quick, default o deep',
  'Un nivel de modelo desconocido no entra');
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","maxConcurrentTasks":6}'::jsonb, 2)$$,
  '22023', 'maxConcurrentTasks debe ser un entero de 1 a 5',
  'Seis tareas simultáneas no entran');
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","maxConcurrentTasks":0}'::jsonb, 2)$$,
  '22023', 'maxConcurrentTasks debe ser un entero de 1 a 5',
  'Cero tareas simultáneas no entran');
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","enabled":"si"}'::jsonb, 2)$$,
  '22023', 'enabled debe ser booleano',
  'enabled no admite texto');
select throws_ok($$select api.save_agent_profile(jsonb_build_object('agentId','lucia','skills',(select jsonb_agg('s' || n) from generate_series(1,13) n)), 2)$$,
  '22023', 'skills admite como máximo 12 entradas',
  'Trece habilidades no entran');
select throws_ok($$select api.save_agent_profile(jsonb_build_object('agentId','lucia','memory',jsonb_build_array(repeat('m',281))), 2)$$,
  '22023', 'memory: cada entrada es texto de hasta 280 caracteres',
  'Una entrada de memoria de 281 caracteres no entra');
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","knowledge":"texto"}'::jsonb, 2)$$,
  '22023', 'knowledge debe ser una lista',
  'La lista de conocimiento no admite un texto suelto');
select lives_ok($$select api.save_agent_profile(jsonb_build_object('agentId','lucia','alias',repeat('a',40),'skills',(select jsonb_agg('s' || n) from generate_series(1,12) n),'maxConcurrentTasks',5), 3)$$,
  'Los valores en el límite sí entran');

-- Bitácora
select is(jsonb_array_length(api.list_agent_profile_changes('lucia', 50)), 4,
  'Sólo los guardados válidos dejan rastro: ni conflictos ni rechazos');
select is(api.list_agent_profile_changes('lucia', 50) -> 3 ->> 'action', 'save',
  'La entrada más antigua es el primer guardado');
select is(api.list_agent_profile_changes('lucia', 50) -> 3 ->> 'contractVersion', '1',
  'La bitácora guarda la versión del contrato contra la que se escribió');
select is(api.list_agent_profile_changes('lucia', 50) -> 2 ->> 'revision', '2',
  'La bitácora guarda la revisión resultante');
select ok((api.list_agent_profile_changes('lucia', 50) -> 2 -> 'changedFields') ? 'alias',
  'La bitácora lista los campos que cambiaron');
select ok(not ((api.list_agent_profile_changes('lucia', 50) -> 2 -> 'changedFields') ? 'modelTier'),
  'Un campo sin cambio no figura');
select is(jsonb_array_length(api.list_agent_profile_changes(null, 1)), 1,
  'El límite de la lectura se respeta');

-- Reinicio
select lives_ok($$select api.delete_agent_profile('lucia')$$,
  'Volver a los valores de fábrica funciona');
select is(api.list_agent_profile_changes('lucia', 1) -> 0 ->> 'action', 'reset',
  'El reinicio también queda en la bitácora');
select is(jsonb_array_length(api.list_agent_profiles()), 0,
  'Tras el reinicio no queda ficha');
select is(api.save_agent_profile('{"agentId":"lucia","alias":"Otra vez"}'::jsonb, 0) ->> 'revision', '1',
  'Tras reiniciar se puede crear de nuevo con revisión cero');
reset role;

-- La bitácora es de sólo añadir, incluso para quien es dueño de la tabla.
select throws_ok($$update api.agent_profile_changes set action = 'reset'$$,
  '42501', 'La bitácora de fichas de agente es de sólo añadir',
  'Ninguna entrada de la bitácora se reescribe');

-- ───────────────────────────────────────────────────────────── el ajeno
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000002"}';
select is(jsonb_array_length(api.list_agent_profiles()), 0,
  'Otro usuario no ve las fichas ajenas');
select is(jsonb_array_length(api.list_agent_profile_changes(null, 50)), 0,
  'Otro usuario no ve la bitácora ajena');
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","alias":"Intruso"}'::jsonb, 1)$$,
  'P0001', 'Conflicto de ficha: recarga antes de guardar',
  'Otro usuario no escribe sobre la ficha ajena: la suya no existe');
reset role;

-- ───────────────────────────────────────────── anónimo y sesión revocada
set local role anon;
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia"}'::jsonb, 0)$$,
  '42501', 'permission denied for schema api',
  'Anónimo no ejecuta el guardado');
reset role;

delete from auth.sessions where id = 'a2000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","alias":"Fantasma"}'::jsonb, 1)$$,
  '42501', null,
  'Una sesión revocada no escribe fichas');
select throws_ok($$select api.list_agent_profile_changes(null, 50)$$,
  '42501', null,
  'Una sesión revocada no lee la bitácora');
reset role;

select * from finish();
rollback;
