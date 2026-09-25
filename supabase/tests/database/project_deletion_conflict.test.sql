-- F6-05 · Borrar un proyecto con una revisión vieja es un conflicto explícito.
--
-- `api.delete_project_aggregate` comprueba la revisión esperada desde que
-- existe, y ningún contrato lo probaba: el inventario de concurrencia de F6-05
-- la encontró como la única escritura con revisión sin su caso negativo. Aquí:
-- la revisión vieja se rechaza con `P0001` —el código que el cliente clasifica
-- como conflicto— **y no borra nada**; la vigente borra; la revisión 0 es el
-- borrado incondicional que la papelera confirma con la persona; y otro usuario
-- no puede borrar lo que no es suyo, ni sabiendo su revisión.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

insert into auth.users (id, email) values
  ('67000000-0000-4000-8000-000000000001', 'delete-owner@example.invalid'),
  ('67000000-0000-4000-8000-000000000002', 'delete-other@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('67000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('67000000-0000-4000-8000-000000000002', 'architect', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('77000000-0000-4000-8000-000000000001', '67000000-0000-4000-8000-000000000001', null),
  ('77000000-0000-4000-8000-000000000002', '67000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"67000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"77000000-0000-4000-8000-000000000001"}';

select is((api.save_business_initiative($json${
  "id":"init_delete", "schemaVersion":1, "code":"NEG-2033-001",
  "title":"Necesidad", "need":"Probar el borrado concurrente", "driver":"",
  "objectives":[], "expectedOutcomes":[], "affectedCapabilities":[], "businessUnits":[],
  "status":"draft", "priority":"medium", "horizon":"next", "riskLevel":"medium",
  "risks":[], "regulatoryDrivers":[], "kpis":[], "milestones":[], "stakeholders":[],
  "documents":[], "dependsOnCodes":[], "notes":[], "provenance":"manual",
  "userId":"67000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-25T00:00:00.000Z", "updatedAt":"2026-09-25T00:00:00.000Z"
}$json$::jsonb, 0)).revision, 1::bigint, 'Existe la iniciativa padre');

select is((api.save_project(
  '{"id":"proj_delete_a","name":"Atención A","initiativeIds":["init_delete"],"userId":"67000000-0000-4000-8000-000000000001"}'::jsonb,
  0)).revision, 1::bigint, 'Existe el proyecto A');
select is((api.save_project(
  '{"id":"proj_delete_a","name":"Atención A, editada en otra pestaña","initiativeIds":["init_delete"],"userId":"67000000-0000-4000-8000-000000000001"}'::jsonb,
  1)).revision, 2::bigint, 'Otra pestaña lo edita: la revisión vigente es 2');

-- ───────────────────────────────────────────── la revisión vieja es un conflicto
select throws_ok($$select api.delete_project_aggregate('proj_delete_a', 1)$$,
  'P0001', 'Conflicto de proyecto: recarga antes de borrar',
  'Borrar con la revisión que se leyó antes de la edición es un conflicto');
select is(jsonb_array_length(jsonb_path_query_array(api.list_project_aggregates(), '$[*] ? (@.id == "proj_delete_a")')), 1,
  'Y el conflicto no borró nada: el proyecto sigue ahí');

-- ───────────────────────────────────────────── otro usuario, ni con la revisión vigente
set local request.jwt.claims = '{"sub":"67000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"77000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.delete_project_aggregate('proj_delete_a', 2)$$,
  '42501', 'El proyecto no existe o no pertenece a la sesión actual',
  'Otro usuario no borra un proyecto ajeno aunque conozca su revisión');

-- ───────────────────────────────────────────── la vigente borra; 0 es incondicional
set local request.jwt.claims = '{"sub":"67000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"77000000-0000-4000-8000-000000000001"}';
select is(api.delete_project_aggregate('proj_delete_a', 2) ->> 'id', 'proj_delete_a',
  'Con la revisión vigente, el borrado procede');
select is(jsonb_array_length(jsonb_path_query_array(api.list_project_aggregates(), '$[*] ? (@.id == "proj_delete_a")')), 0,
  'Y el proyecto ya no está');

select is((api.save_project(
  '{"id":"proj_delete_b","name":"Atención B","initiativeIds":["init_delete"],"userId":"67000000-0000-4000-8000-000000000001"}'::jsonb,
  0)).revision, 1::bigint, 'Existe el proyecto B');
select is((api.save_project(
  '{"id":"proj_delete_b","name":"Atención B, editada","initiativeIds":["init_delete"],"userId":"67000000-0000-4000-8000-000000000001"}'::jsonb,
  1)).revision, 2::bigint, 'Y se edita');
select is(api.delete_project_aggregate('proj_delete_b', 0) ->> 'id', 'proj_delete_b',
  'La revisión 0 es el borrado incondicional que la papelera confirma con la persona');

select * from finish();
rollback;
