-- F9.1 — Contratos de lo que faltaba para retirar Firestore.
--
-- Cada bloque comprueba las dos mitades que importan: que la operación legítima
-- funciona, y que la ilegítima se rechaza. Una tabla nueva sin prueba negativa
-- es una tabla que nadie ha comprobado que esté cerrada.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

-- ─────────────────────────────────────────────────── estructura y grants
select has_table('api', 'project_chat_history', 'El historial de chat tiene tabla propia');
select has_table('api', 'agent_actions', 'El registro del agente tiene tabla propia');
select has_table('api', 'agent_profiles', 'La ficha de agente tiene tabla propia');
select has_table('api', 'artifact_comments', 'Los hilos de revisión tienen tabla propia');
select has_table('api', 'artifact_review_decisions', 'El rastro de decisiones tiene tabla propia');

select ok((select relrowsecurity from pg_class where oid = 'api.project_chat_history'::regclass),
  'El historial de chat tiene RLS activa');
select ok((select relrowsecurity from pg_class where oid = 'api.agent_actions'::regclass),
  'El registro del agente tiene RLS activa');
select ok((select relrowsecurity from pg_class where oid = 'api.agent_profiles'::regclass),
  'La ficha de agente tiene RLS activa');
select ok((select relrowsecurity from pg_class where oid = 'api.artifact_comments'::regclass),
  'Los comentarios tienen RLS activa');
select ok((select relrowsecurity from pg_class where oid = 'api.artifact_review_decisions'::regclass),
  'Las decisiones tienen RLS activa');

select ok(not has_table_privilege('anon', 'api.project_chat_history', 'SELECT'),
  'Anónimo no lee historial de chat');
select ok(not has_table_privilege('authenticated', 'api.agent_actions', 'INSERT'),
  'El cliente no inserta acciones del agente directamente');
select ok(not has_table_privilege('authenticated', 'api.artifact_review_decisions', 'UPDATE'),
  'El rastro de decisiones no se actualiza desde el cliente');
select ok(has_function_privilege('authenticated', 'api.list_project_aggregates()', 'EXECUTE'),
  'El portafolio se lee por RPC');
select ok(not has_function_privilege('anon', 'api.list_user_profiles()', 'EXECUTE'),
  'El directorio de usuarios no es anónimo');

-- ───────────────────────────────────────────────────────── datos de apoyo
insert into auth.users (id, email) values
  ('90000000-0000-4000-8000-000000000001', 'f9-owner@example.invalid'),
  ('90000000-0000-4000-8000-000000000002', 'f9-other@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('90000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('90000000-0000-4000-8000-000000000002', 'architect', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', null),
  ('91000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;
-- Las cinco columnas de clasificación son NOT NULL y no tienen valor por
-- defecto: una iniciativa sin estado ni prioridad no es una iniciativa a medio
-- escribir, es una que el portafolio no sabe dónde poner. La sonda remota ya
-- las traía; este fichero no, y abortaba aquí dejando sin correr todo lo que
-- viene debajo.
insert into api.business_initiatives
  (id, owner_id, code, title, need, status, priority, horizon, risk_level, data)
values ('init-f9', '90000000-0000-4000-8000-000000000001', 'NEG-2026-901',
  'Iniciativa F9', 'Retirar Firebase', 'draft', 'medium', 'next', 'medium',
  jsonb_build_object('id', 'init-f9', 'userId', '90000000-0000-4000-8000-000000000001',
    'code', 'NEG-2026-901'))
on conflict (id) do nothing;
insert into api.architecture_projects (id, owner_id, name, initiative_ids, data)
values ('proj-f9', '90000000-0000-4000-8000-000000000001', 'Proyecto F9', array['init-f9'],
  jsonb_build_object('id', 'proj-f9', 'userId', '90000000-0000-4000-8000-000000000001', 'name', 'Proyecto F9'))
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────── el propietario
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"91000000-0000-4000-8000-000000000001"}';

select is(jsonb_array_length(api.list_project_aggregates()), 1,
  'El portafolio devuelve el proyecto propio');
select is(api.list_project_aggregates() -> 0 -> 'artifacts', '[]'::jsonb,
  'El portafolio no arrastra los cuerpos de los artefactos');

select lives_ok($$select api.save_chat_history('proj-f9', '[{"role":"user","text":"hola"}]'::jsonb)$$,
  'El propietario guarda su historial');
select is(jsonb_array_length(api.load_chat_history('proj-f9')), 1,
  'El historial guardado se lee de vuelta');
select throws_ok($$select api.save_chat_history('proj-f9', '[{"aiConfig":{"apiKey":"secreto"}}]'::jsonb)$$,
  '22023', 'El historial no puede contener apiKey',
  'Una clave pegada en el chat no se almacena');

select lives_ok($$select api.append_agent_action('proj-f9', '{"traceId":"trace-1","kind":"generate"}'::jsonb)$$,
  'El propietario registra una acción del agente');
select is(jsonb_array_length(api.list_agent_actions('proj-f9', 50)), 1,
  'La acción registrada se lee de vuelta');
select throws_ok($$select api.append_agent_action('proj-f9', '{"kind":"generate"}'::jsonb)$$,
  '22023', 'La acción del agente requiere traceId',
  'Una acción sin traceId no entra');

select lives_ok($$select api.save_agent_profile('{"agentId":"lucia","alias":"Lucía"}'::jsonb)$$,
  'El propietario configura la ficha de un agente');
select is(jsonb_array_length(api.list_agent_profiles()), 1,
  'La ficha configurada se lee de vuelta');
select throws_ok($$select api.save_agent_profile('{"agentId":"lucia","producesArtifactTypes":["markdown"]}'::jsonb)$$,
  '22023', 'La ficha no puede alterar la gobernanza del agente',
  'La ficha no reasigna qué produce un agente');

select lives_ok($$select api.save_artifact_comment(jsonb_build_object(
    'id','c1','projectId','proj-f9','artifactId','art-1','body','Revisar esto',
    'author', jsonb_build_object('id','90000000-0000-4000-8000-000000000001','name','Owner')))$$,
  'El propietario comenta un artefacto');
select is(jsonb_array_length(api.list_artifact_comments('proj-f9', 'art-1')), 1,
  'El comentario se lee de vuelta');

select lives_ok($$select api.record_artifact_review_decision(jsonb_build_object(
    'id','d1','projectId','proj-f9','artifactId','art-1','status','approved'))$$,
  'El propietario registra una decisión de revisión');
select lives_ok($$select api.record_artifact_review_decision(jsonb_build_object(
    'id','d1','projectId','proj-f9','artifactId','art-1','status','rejected'))$$,
  'Repetir el id no falla: la operación es idempotente');
select is(api.list_artifact_review_decisions('proj-f9','art-1') -> 0 ->> 'status', 'approved',
  'La decisión registrada es inmutable: el segundo intento no la reescribe');

select is(api.load_own_profile() ->> 'role', 'architect', 'El perfil propio trae su rol');
select is(api.load_own_profile() ->> 'email', 'f9-owner@example.invalid',
  'El perfil propio trae el correo de auth.users, no una copia');
select lives_ok($$select api.update_own_display_name('Nombre Nuevo')$$,
  'El dueño cambia su propio nombre');
select throws_ok($$select api.update_own_display_name('   ')$$,
  '22023', 'El nombre debe tener entre 1 y 120 caracteres',
  'Un nombre vacío no pasa');
select throws_ok($$select api.list_user_profiles()$$,
  '42501', 'Permiso insuficiente: users:read',
  'Un arquitecto no lee el directorio de usuarios');
reset role;

-- ───────────────────────────────────────────────────────────── el ajeno
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"91000000-0000-4000-8000-000000000002"}';
select is(jsonb_array_length(api.list_project_aggregates()), 0,
  'Otro usuario no ve el proyecto ajeno en su portafolio');
select is(api.load_chat_history('proj-f9'), '[]'::jsonb,
  'Otro usuario no lee el historial ajeno');
select throws_ok($$select api.save_chat_history('proj-f9', '[]'::jsonb)$$,
  '42501', 'El proyecto no existe o no pertenece a la sesión actual',
  'Otro usuario no escribe historial ajeno');
select throws_ok($$select api.append_agent_action('proj-f9', '{"traceId":"trace-2"}'::jsonb)$$,
  '42501', 'El proyecto no existe o no pertenece a la sesión actual',
  'Otro usuario no registra acciones en un proyecto ajeno');
select throws_ok($$select api.list_artifact_comments('proj-f9', 'art-1')$$,
  '42501', 'El proyecto no existe o no pertenece a la sesión actual',
  'Otro usuario no lee comentarios de un proyecto ajeno');
select is(jsonb_array_length(api.list_agent_profiles()), 0,
  'Las fichas de agente son de cada persona');
reset role;

-- ───────────────────────────────────────────────── sesión revocada
delete from auth.sessions where id = '91000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"91000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.save_chat_history('proj-f9', '[]'::jsonb)$$,
  '42501', 'La sesión no está activa: vuelva a iniciar sesión',
  'Una sesión revocada no escribe historial');
select throws_ok($$select api.list_project_aggregates()$$,
  '42501', 'La sesión no está activa: vuelva a iniciar sesión',
  'Una sesión revocada no lista el portafolio');
reset role;

select * from finish();
rollback;
