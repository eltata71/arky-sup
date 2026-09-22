begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

select has_table('api', 'architecture_projects', 'El corte compuesto tiene raíz de proyectos');
select has_table('api', 'project_artifacts', 'El corte compuesto persiste artefactos separados');
select ok((select relrowsecurity from pg_class where oid = 'api.architecture_projects'::regclass),
  'La raíz de proyecto tiene RLS');
select ok((select relrowsecurity from pg_class where oid = 'api.project_artifacts'::regclass),
  'Los artefactos tienen RLS');
select ok(not has_table_privilege('authenticated', 'api.architecture_projects', 'INSERT'),
  'El cliente no escribe proyecto directo');
select ok(not has_table_privilege('authenticated', 'api.project_artifacts', 'INSERT'),
  'El cliente no escribe artefacto directo');
select ok(has_function_privilege('authenticated', 'api.save_project(jsonb,bigint)', 'EXECUTE'),
  'El cliente escribe la raíz del proyecto por RPC');
select ok(has_function_privilege('authenticated', 'api.create_artifact(text,jsonb)', 'EXECUTE'),
  'El cliente crea artefactos con su propio comando');
-- F4-06: la RPC compuesta se retiró. Ni concedida ni existente: una puerta que
-- nadie usa pero que sigue abierta es superficie.
select hasnt_function('api', 'save_project_aggregate', array['jsonb', 'jsonb', 'bigint'],
  'La RPC compuesta proyecto+artefactos ya no existe (F4-06)');
select ok(has_function_privilege('authenticated', 'api.load_project_aggregate(text)', 'EXECUTE'),
  'El cliente recibe una RPC de hidratación de agregado');

insert into auth.users (id, email) values
  ('62000000-0000-4000-8000-000000000001', 'project-owner@example.invalid'),
  ('62000000-0000-4000-8000-000000000002', 'project-other@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('62000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('62000000-0000-4000-8000-000000000002', 'viewer', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('72000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', null),
  ('72000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000001"}';
select is((select (api.save_business_initiative($json${
  "id":"init_project_probe", "schemaVersion":1, "code":"NEG-2026-620",
  "title":"Necesidad que atiende el proyecto", "need":"Prueba del corte compuesto", "driver":"",
  "objectives":[], "expectedOutcomes":[], "affectedCapabilities":[], "businessUnits":[],
  "status":"draft", "priority":"medium", "horizon":"next", "riskLevel":"medium",
  "risks":[], "regulatoryDrivers":[], "kpis":[], "milestones":[], "stakeholders":[],
  "documents":[], "dependsOnCodes":[], "notes":[], "provenance":"manual",
  "userId":"62000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-12T00:00:00.000Z", "updatedAt":"2026-09-12T00:00:00.000Z"
}$json$::jsonb, 0)).revision), 1::bigint, 'Existe una iniciativa padre válida');
select is((select (api.save_project($json${
  "id":"proj_legacy_001", "name":"Atención digital", "description":"", "projectContext":[],
  "initiativeIds":["init_project_probe"], "linkedBusinessProjects":["NEG-2026-620"],
  "userId":"62000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-12T00:00:00.000Z", "updatedAt":"2026-09-12T00:00:00.000Z"
}$json$::jsonb, 0)).revision), 1::bigint,
  'Crear es guardar la raíz con revisión esperada 0 (F4-06)');
select throws_ok($$select api.save_project(
  '{"id":"proj_legacy_001","name":"Otra atención","initiativeIds":["init_project_probe"],"userId":"62000000-0000-4000-8000-000000000001"}'::jsonb, 0)$$,
  'P0001', 'Conflicto de proyecto: recarga antes de guardar',
  'Un segundo «crear» con el mismo id se rechaza en vez de pisar el primero');
select is((api.create_artifact('proj_legacy_001', $json$
  {"id":"art_legacy_001", "name":"Diagrama", "type":"mermaid-graph", "versionGroupId":"vg_001", "version":1, "createdAt":"2026-09-12T00:00:00.000Z", "phase":"design", "architecturalView":"Vista Lógica y de Diseño", "content":"graph TD; A-->B", "objective":"Explicar la relación", "keyConcepts":[{"term":"A", "definition":"Origen"}], "representation":"diagram"}
$json$::jsonb) ->> 'revision')::bigint, 1::bigint,
  'El artefacto se crea con su propio comando');
reset role;
select is((select artifact_count from api.architecture_projects where id = 'proj_legacy_001'), 1,
  'El contador se actualiza dentro de la misma operación');
select is((select jsonb_array_length(artifact_index) from api.architecture_projects where id = 'proj_legacy_001'), 1,
  'El índice se actualiza junto con contador y artefacto');
select is((select revision from api.architecture_projects where id = 'proj_legacy_001'), 1::bigint,
  'Crear un artefacto no cambia la revisión del proyecto: el índice es una proyección');

set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000001"}';
select is((select jsonb_array_length((api.load_project_aggregate('proj_legacy_001'))->'artifacts')), 1,
  'La hidratación devuelve el artefacto del agregado');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.load_project_aggregate('proj_legacy_001')$$,
  '42501', 'El proyecto no pertenece a la sesión actual',
  'Otro usuario no hidrata el agregado ajeno');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.save_project(
  '{"id":"proj_secret","name":"Atención con secreto","initiativeIds":["init_project_probe"],"userId":"62000000-0000-4000-8000-000000000001","nested":{"apiKey":"[REDACTED]"}}'::jsonb, 0)$$,
  '22023', 'El agregado no puede contener apiKey',
  'La RPC rechaza secretos anidados antes de persistir');
select throws_ok($$select api.create_artifact('proj_legacy_001',
  '{"id":"art_legacy_001","name":"Dos","type":"mermaid-graph","versionGroupId":"vg_two","version":1,"createdAt":"2026-09-12T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"graph TD; A-->C","objective":"Dos","keyConcepts":[{"term":"A","definition":"Dos"}],"representation":"diagram"}'::jsonb)$$,
  '23505', 'El id de artefacto ya existe',
  'Un id de artefacto repetido se rechaza antes de desnormalizar el índice');
select throws_ok($$select api.create_artifact('proj_legacy_001',
  '{"id":"art_incomplete","name":"Incompleto","type":"mermaid-graph","versionGroupId":"vg_incomplete","version":1}'::jsonb)$$,
  '22023', 'Un artefacto del proyecto no tiene una forma válida',
  'La RPC exige el contrato mínimo completo de un artefacto');
select throws_ok($$select api.create_artifact('proj_legacy_001',
  '{"id":"art_unknown_type","name":"Inválido","type":"unknown-artifact","versionGroupId":"vg_invalid","version":1,"createdAt":"2026-09-12T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}'::jsonb)$$,
  '22023', 'Un artefacto del proyecto no tiene una forma válida',
  'La RPC rechaza un tipo de artefacto fuera del contrato');
select throws_ok($$select api.create_artifact('proj_legacy_001',
  '{"id":"art_unknown_view","name":"Inválido","type":"mermaid-graph","versionGroupId":"vg_invalid","version":1,"createdAt":"2026-09-12T00:00:00.000Z","phase":"design","architecturalView":"logical","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}'::jsonb)$$,
  '22023', 'Un artefacto del proyecto no tiene una forma válida',
  'La RPC rechaza una vista fuera del contrato');
select throws_ok($$select api.create_artifact('proj_legacy_001',
  '{"id":"art_invalid_version","name":"Inválido","type":"mermaid-graph","versionGroupId":"vg_invalid","version":0,"createdAt":"2026-09-12T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}'::jsonb)$$,
  '22023', 'Un artefacto del proyecto no tiene una forma válida',
  'La RPC rechaza una versión de artefacto no positiva');
select is(
  (api.save_project(
    '{"id":"proj_normalized","name":"Atención normalizada","initiativeIds":["init_project_probe"," ","init_project_probe"],"userId":"62000000-0000-4000-8000-000000000001"}'::jsonb, 0
  )).revision,
  1::bigint,
  'La RPC guarda una relación de iniciativas normalizada');
select is(
  (api.load_project_aggregate('proj_normalized')->'initiativeIds')::text,
  '["init_project_probe"]',
  'La relación normalizada en la columna y el documento devuelto coincide');
reset role;

select * from finish();
rollback;
