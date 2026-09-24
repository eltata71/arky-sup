-- F5-04 · H11: el trabajo de proyección pendiente es un hecho de la base.
--
-- Lo que la aceptación exige, cada cosa con su prueba: cerrar el navegador no
-- pierde el pendiente (se encola en la transacción del artefacto y sigue ahí
-- después), reprocesar no duplica (una generación procesada no se escribe dos
-- veces), y un evento viejo no pisa una proyección más nueva. Más los rechazos:
-- otro dueño, sin permiso, sin sesión, generación inexistente.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

-- ───────────────────────────────────────────── superficie
select has_table('api', 'projection_outbox', 'La bitácora de pendientes existe');
select ok((select relrowsecurity from pg_class where oid = 'api.projection_outbox'::regclass),
  'La bitácora tiene RLS');
select ok(not has_table_privilege('authenticated', 'api.projection_outbox', 'SELECT'),
  'El cliente no lee la bitácora directo');
select ok(not has_table_privilege('authenticated', 'api.projection_outbox', 'INSERT'),
  'El cliente no escribe la bitácora directo');
select ok(has_function_privilege('authenticated', 'api.list_pending_projections()', 'EXECUTE'),
  'El cliente lista sus pendientes');
select ok(has_function_privilege('authenticated', 'api.save_graph_projection(text,jsonb,bigint)', 'EXECUTE'),
  'El cliente guarda una proyección con su generación');
select ok(has_function_privilege('authenticated', 'api.fail_projection(text,bigint,text)', 'EXECUTE'),
  'El cliente anota un fallo');
select ok(not has_function_privilege('anon', 'api.list_pending_projections()', 'EXECUTE'),
  'Sin sesión no hay pendientes');
select ok(not has_function_privilege('anon', 'api.save_graph_projection(text,jsonb,bigint)', 'EXECUTE'),
  'Sin sesión no se guarda una proyección');
select ok(not has_function_privilege('authenticated', 'private.enqueue_graph_projection()', 'EXECUTE'),
  'El disparador no es invocable');
select has_trigger('api', 'project_artifacts', 'project_artifacts_enqueue_graph_projection',
  'Escribir un artefacto encola en su misma transacción');
select has_trigger('api', 'architecture_knowledge_graphs', 'architecture_knowledge_graphs_forget_projection',
  'Borrar el grafo borra su pendiente');

-- ───────────────────────────────────────────── identidades
insert into auth.users (id, email) values
  ('65000000-0000-4000-8000-000000000001', 'outbox-owner@example.invalid'),
  ('65000000-0000-4000-8000-000000000002', 'outbox-other@example.invalid'),
  ('65000000-0000-4000-8000-000000000003', 'outbox-viewer@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('65000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('65000000-0000-4000-8000-000000000002', 'architect', 'active'),
  ('65000000-0000-4000-8000-000000000003', 'viewer', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('75000000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', null),
  ('75000000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000002', null),
  ('75000000-0000-4000-8000-000000000003', '65000000-0000-4000-8000-000000000003', null)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000001"}';

select is((api.save_business_initiative($json${
  "id":"init_outbox", "schemaVersion":1, "code":"NEG-2026-650",
  "title":"Necesidad", "need":"Probar la bitácora de proyecciones", "driver":"",
  "objectives":[], "expectedOutcomes":[], "affectedCapabilities":[], "businessUnits":[],
  "status":"draft", "priority":"medium", "horizon":"next", "riskLevel":"medium",
  "risks":[], "regulatoryDrivers":[], "kpis":[], "milestones":[], "stakeholders":[],
  "documents":[], "dependsOnCodes":[], "notes":[], "provenance":"manual",
  "userId":"65000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-24T00:00:00.000Z", "updatedAt":"2026-09-24T00:00:00.000Z"
}$json$::jsonb, 0)).revision, 1::bigint, 'Existe la iniciativa padre');
select is((api.save_project(
  '{"id":"proj_outbox","name":"Atención con grafo","initiativeIds":["init_outbox"],"userId":"65000000-0000-4000-8000-000000000001"}'::jsonb,
  0)).revision, 1::bigint, 'Existe el proyecto');

-- ───────────────────────────────────────────── sin grafo, no se encola
select is((api.create_artifact('proj_outbox', $json${
  "id":"art_o1", "name":"Contexto", "type":"mermaid-graph", "versionGroupId":"vg_o1", "version":1,
  "createdAt":"2026-09-24T00:00:00.000Z", "phase":"design", "architecturalView":"Vista Lógica y de Diseño",
  "content":"graph TD; A-->B", "objective":"Explicar", "keyConcepts":[], "representation":"diagram"
}$json$::jsonb) -> 'revision')::bigint, 1::bigint, 'Un artefacto antes de que exista el grafo');
select is(jsonb_array_length(api.list_pending_projections()), 0,
  'Un proyecto sin grafo no acumula pendientes: iniciar un grafo es una decisión');

-- ───────────────────────────────────────────── con grafo, se encola y se agrupa
select is((api.save_knowledge_graph('proj_outbox',
  '{"projectId":"proj_outbox","buildId":"build_0","lastBuiltAt":"2026-09-24T00:00:00.000Z","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb,
  0)).revision, 1::bigint, 'El proyecto opta por el grafo');
select is((api.update_artifact('art_o1', 1, '{"name":"Contexto editado"}'::jsonb) -> 'revision')::bigint, 2::bigint,
  'Una edición con grafo');
select is((api.update_artifact('art_o1', 2, '{"objective":"Explicar mejor"}'::jsonb) -> 'revision')::bigint, 3::bigint,
  'Otra edición seguida');
select is(jsonb_array_length(api.list_pending_projections()), 1,
  'Dos ediciones seguidas son un pendiente, no dos');
select is((api.list_pending_projections() -> 0 ->> 'generation')::bigint, 2::bigint,
  'La generación cuenta cada cambio de la fuente');
select is((api.list_pending_projections() -> 0 ->> 'projectId'), 'proj_outbox',
  'El pendiente nombra su proyecto');

select throws_ok($$select api.create_artifact('proj_outbox', '{"id":"art_bad","name":"X","type":"mermaid-graph","versionGroupId":"vg_bad","version":1}'::jsonb)$$,
  '22023', 'Un artefacto del proyecto no tiene una forma válida',
  'Una escritura rechazada');
select is((api.list_pending_projections() -> 0 ->> 'generation')::bigint, 2::bigint,
  'Una escritura revertida no encola nada: el pendiente comparte su transacción');

-- ───────────────────────────────────────────── otros actores
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000002"}';
select is(jsonb_array_length(api.list_pending_projections()), 0,
  'Otro usuario no ve pendientes ajenos');
select throws_ok($$select api.save_graph_projection('proj_outbox',
  '{"projectId":"proj_outbox","buildId":"intruso","lastBuiltAt":"x","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb, 2)$$,
  'P0002', 'No hay proyección pendiente para ese proyecto',
  'Otro usuario no procesa una proyección ajena');
select is((api.fail_projection('proj_outbox', 2, 'intento ajeno') ->> 'recorded')::boolean, false,
  'Otro usuario no anota fallos en una proyección ajena');

set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000003"}';
select throws_ok($$select api.save_graph_projection('proj_outbox',
  '{"projectId":"proj_outbox","buildId":"b","lastBuiltAt":"x","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb, 2)$$,
  '42501', 'Permiso insuficiente: project:write',
  'Quien sólo lee no escribe proyecciones');

-- ───────────────────────────────────────────── fallos observables
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000001"}';
select is((api.fail_projection('proj_outbox', 2, 'red caída') ->> 'attempts')::integer, 1,
  'Un fallo se anota con su intento');
select is((api.list_pending_projections() -> 0 ->> 'lastError'), 'red caída',
  'El último error es visible en el pendiente');
select is((api.list_pending_projections() -> 0 ->> 'attempts')::integer, 1,
  'Los intentos son visibles en el pendiente');

-- ───────────────────────────────────────────── guardar y marcar
select throws_ok($$select api.save_graph_projection('proj_outbox',
  '{"projectId":"proj_outbox","buildId":"b","lastBuiltAt":"x","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb, 3)$$,
  '22023', 'La generación no existe todavía',
  'No se procesa una generación que no ha ocurrido');
select throws_ok($$select api.save_graph_projection('proj_outbox',
  '{"projectId":"otro","buildId":"b","lastBuiltAt":"x","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb, 2)$$,
  '22023', 'El grafo no tiene una forma válida',
  'La proyección pasa la misma validación que el guardado manual');
select is((api.list_pending_projections() -> 0 ->> 'generation')::bigint, 2::bigint,
  'Un guardado rechazado deja el pendiente donde estaba');

select is((api.save_graph_projection('proj_outbox',
  '{"projectId":"proj_outbox","buildId":"build_2","lastBuiltAt":"2026-09-24T01:00:00.000Z","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb,
  2) ->> 'applied')::boolean, true, 'La generación pendiente se guarda');
select is(jsonb_array_length(api.list_pending_projections()), 0,
  'Guardar la última generación vacía la bitácora');
select is((api.load_knowledge_graph('proj_outbox') ->> 'buildId'), 'build_2',
  'El grafo guardado es el de la proyección');
select is((api.load_knowledge_graph('proj_outbox') ->> 'revision')::bigint, 2::bigint,
  'El guardado usó la revisión vigente del grafo');

-- Reprocesar no duplica.
select is((api.save_graph_projection('proj_outbox',
  '{"projectId":"proj_outbox","buildId":"build_2_bis","lastBuiltAt":"x","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb,
  2) ->> 'reason'), 'already-processed', 'Reprocesar la misma generación no escribe');
select is((api.load_knowledge_graph('proj_outbox') ->> 'revision')::bigint, 2::bigint,
  'Reprocesar no mueve la revisión del grafo');

-- Un evento viejo no pisa una proyección más nueva.
select is((api.update_artifact('art_o1', 3, '{"name":"Contexto final"}'::jsonb) -> 'revision')::bigint, 4::bigint,
  'Un cambio más tarde');
select is((api.save_graph_projection('proj_outbox',
  '{"projectId":"proj_outbox","buildId":"build_3","lastBuiltAt":"x","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb,
  3) ->> 'applied')::boolean, true, 'La generación 3 se procesa');
select is((api.save_graph_projection('proj_outbox',
  '{"projectId":"proj_outbox","buildId":"build_viejo","lastBuiltAt":"x","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb,
  2) ->> 'reason'), 'stale', 'Un evento anterior a lo procesado se rechaza');
select is((api.load_knowledge_graph('proj_outbox') ->> 'buildId'), 'build_3',
  'El grafo sigue siendo el más nuevo');

-- Procesar una generación que ya no es la última deja el resto pendiente.
select is((api.update_artifact('art_o1', 4, '{"name":"Otra vez"}'::jsonb) -> 'revision')::bigint, 5::bigint,
  'Cambio 4');
select is((api.update_artifact('art_o1', 5, '{"name":"Y otra"}'::jsonb) -> 'revision')::bigint, 6::bigint,
  'Cambio 5');
select is((api.save_graph_projection('proj_outbox',
  '{"projectId":"proj_outbox","buildId":"build_4","lastBuiltAt":"x","entities":[],"relations":[],"quality":{},"statistics":{}}'::jsonb,
  4) ->> 'pending')::boolean, true, 'Procesar la generación 4 con la 5 ya encolada deja pendiente');
select is(jsonb_array_length(api.list_pending_projections()), 1,
  'La generación posterior sigue en la bitácora');

-- ───────────────────────────────────────────── borrar el grafo borra el pendiente
select is((api.delete_project_aggregate('proj_outbox', 0) ->> 'knowledgeGraphs')::integer, 1,
  'Borrar el proyecto borra su grafo');
select is(jsonb_array_length(api.list_pending_projections()), 0,
  'Y con él su pendiente: no queda trabajo huérfano');
reset role;
select is((select count(*)::integer from api.projection_outbox where project_id = 'proj_outbox'), 0,
  'La fila de la bitácora ya no existe');

select * from finish();
rollback;
