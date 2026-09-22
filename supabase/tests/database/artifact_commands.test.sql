-- F4-03 · ADR-106: el Artefacto se escribe con sus propios comandos.
--
-- La prueba que importa es la de H05: dos ediciones de artefactos **distintos**
-- hechas desde la misma lectura ya no chocan, y la misma edición sobre una
-- revisión vieja sí. El resto fija las invariantes que ADR-106 mueve al
-- servidor (A-02, P-04) y los rechazos: otro dueño, sin permiso, forma inválida,
-- secreto, y la guarda de la ruta compuesta.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

-- ───────────────────────────────────────────── superficie
select ok(has_function_privilege('authenticated', 'api.save_project(jsonb,bigint)', 'EXECUTE'),
  'El cliente guarda la raíz sin artefactos');
select ok(has_function_privilege('authenticated', 'api.create_artifact(text,jsonb)', 'EXECUTE'),
  'El cliente crea un artefacto con su comando');
select ok(has_function_privilege('authenticated', 'api.create_artifact_version(text,jsonb)', 'EXECUTE'),
  'El cliente versiona un artefacto con su comando');
select ok(has_function_privilege('authenticated', 'api.update_artifact(text,bigint,jsonb)', 'EXECUTE'),
  'El cliente edita un artefacto con su comando');
select ok(has_function_privilege('authenticated', 'api.delete_artifact(text,bigint)', 'EXECUTE'),
  'El cliente borra un artefacto con su comando');
select ok(has_function_privilege('authenticated', 'api.revise_artifacts(text,jsonb)', 'EXECUTE'),
  'El cliente aplica varios cambios en una transacción');
select ok(not has_function_privilege('anon', 'api.update_artifact(text,bigint,jsonb)', 'EXECUTE'),
  'Sin sesión no hay comandos de artefacto');
select ok(not has_function_privilege('authenticated', 'private.insert_artifact(text,uuid,jsonb,boolean)', 'EXECUTE'),
  'Los ayudantes privados no son invocables');
select has_index('api', 'project_artifacts', 'project_artifacts_version_unique',
  'A-02 tiene autoridad de base de datos');

-- ───────────────────────────────────────────── identidades
insert into auth.users (id, email) values
  ('64000000-0000-4000-8000-000000000001', 'artifact-owner@example.invalid'),
  ('64000000-0000-4000-8000-000000000002', 'artifact-other@example.invalid'),
  ('64000000-0000-4000-8000-000000000003', 'artifact-viewer@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('64000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('64000000-0000-4000-8000-000000000002', 'architect', 'active'),
  ('64000000-0000-4000-8000-000000000003', 'viewer', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('74000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001', null),
  ('74000000-0000-4000-8000-000000000002', '64000000-0000-4000-8000-000000000002', null),
  ('74000000-0000-4000-8000-000000000003', '64000000-0000-4000-8000-000000000003', null)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000001"}';

select is((api.save_business_initiative($json${
  "id":"init_artifact_cmd", "schemaVersion":1, "code":"NEG-2026-640",
  "title":"Necesidad", "need":"Probar comandos de artefacto", "driver":"",
  "objectives":[], "expectedOutcomes":[], "affectedCapabilities":[], "businessUnits":[],
  "status":"draft", "priority":"medium", "horizon":"next", "riskLevel":"medium",
  "risks":[], "regulatoryDrivers":[], "kpis":[], "milestones":[], "stakeholders":[],
  "documents":[], "dependsOnCodes":[], "notes":[], "provenance":"manual",
  "userId":"64000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-22T00:00:00.000Z", "updatedAt":"2026-09-22T00:00:00.000Z"
}$json$::jsonb, 0)).revision, 1::bigint, 'Existe la iniciativa padre');

-- ───────────────────────────────────────────── raíz sin artefactos
select is((api.save_project(
  '{"id":"proj_cmd","name":"Atención con comandos","initiativeIds":["init_artifact_cmd"],"userId":"64000000-0000-4000-8000-000000000001"}'::jsonb,
  0)).revision, 1::bigint, 'save_project crea la raíz con revisión 1');
select is((api.load_project_aggregate('proj_cmd') -> 'revision')::bigint, 1::bigint,
  'La lectura devuelve la revisión del proyecto (antes no, y la primera edición tras recargar chocaba)');
select is((select (x -> 'revision')::bigint from jsonb_array_elements(api.list_project_aggregates()) x
  where x ->> 'id' = 'proj_cmd'), 1::bigint,
  'La lista de portafolio devuelve la revisión');
select throws_ok($$select api.save_project(
  '{"id":"proj_cmd","name":"Otra","initiativeIds":["init_artifact_cmd"],"userId":"64000000-0000-4000-8000-000000000001"}'::jsonb, 0)$$,
  'P0001', 'Conflicto de proyecto: recarga antes de guardar',
  'save_project no crea dos veces la misma identidad');

-- ───────────────────────────────────────────── crear
select is((api.create_artifact('proj_cmd', $json${
  "id":"art_a1", "name":"Contexto", "type":"mermaid-graph", "versionGroupId":"vg_a", "version":1,
  "createdAt":"2026-09-22T00:00:00.000Z", "phase":"design", "architecturalView":"Vista Lógica y de Diseño",
  "content":"graph TD; A-->B", "objective":"Explicar", "keyConcepts":[], "representation":"diagram",
  "revision":99
}$json$::jsonb) -> 'revision')::bigint, 1::bigint,
  'create_artifact devuelve la revisión 1 e ignora la que traiga el documento');
select is((api.create_artifact('proj_cmd', $json${
  "id":"art_b1", "name":"Datos", "type":"markdown", "versionGroupId":"vg_b", "version":1,
  "createdAt":"2026-09-22T00:00:00.000Z", "phase":"design", "architecturalView":"Vista de Datos",
  "content":"# Datos", "objective":"Modelo", "keyConcepts":[], "representation":"document"
}$json$::jsonb) -> 'revision')::bigint, 1::bigint, 'Un segundo artefacto en otro grupo');
reset role;
select is((select artifact_count from api.architecture_projects where id = 'proj_cmd'), 2,
  'P-04: el contador se recalcula desde las filas');
select is((select jsonb_array_length(artifact_index) from api.architecture_projects where id = 'proj_cmd'), 2,
  'P-04: el índice se recalcula desde las filas');
select is((select revision from api.architecture_projects where id = 'proj_cmd'), 1::bigint,
  'Escribir artefactos no mueve la revisión del proyecto');
select ok((select not (data ? 'revision') from api.project_artifacts where id = 'art_a1'),
  'El documento almacenado nunca guarda una revisión que pueda envejecer');

set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.create_artifact('proj_cmd', '{"id":"art_a_dup","name":"X","type":"mermaid-graph","versionGroupId":"vg_a","version":1,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}'::jsonb)$$,
  '23505', 'El grupo de versiones ya existe: crea una versión nueva',
  'create_artifact no abre un grupo que ya existe');
select throws_ok($$select api.create_artifact('proj_cmd', '{"id":"art_c1","name":"X","type":"mermaid-graph","versionGroupId":"vg_c","version":3,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}'::jsonb)$$,
  'P0001', 'La versión ya no es la siguiente de su grupo: recarga antes de guardar',
  'A-02: un grupo nuevo empieza en la versión 1');
select throws_ok($$select api.create_artifact('proj_cmd', '{"id":"art_a1","name":"X","type":"mermaid-graph","versionGroupId":"vg_z","version":1,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}'::jsonb)$$,
  '23505', 'El id de artefacto ya existe',
  'Un id repetido se rechaza, no se sobrescribe');
select throws_ok($$select api.create_artifact('proj_cmd', '{"id":"art_bad","name":"X","type":"mermaid-graph","versionGroupId":"vg_bad","version":1}'::jsonb)$$,
  '22023', 'Un artefacto del proyecto no tiene una forma válida',
  'create_artifact exige el contrato mínimo');
select throws_ok($$select api.create_artifact('proj_cmd', '{"id":"art_key","name":"X","type":"mermaid-graph","versionGroupId":"vg_key","version":1,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram","trace":{"apiKey":"[REDACTED]"}}'::jsonb)$$,
  '22023', 'El agregado no puede contener apiKey',
  'create_artifact rechaza un secreto anidado');
select throws_ok($$select api.create_artifact('proj_missing', '{"id":"art_m","name":"X","type":"mermaid-graph","versionGroupId":"vg_m","version":1,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}'::jsonb)$$,
  'P0002', 'El proyecto no existe',
  'No se crea un artefacto huérfano');

-- ───────────────────────────────────────────── versionar (A-02)
select is((api.create_artifact_version('proj_cmd', '{"id":"art_a2","name":"Contexto v2","type":"mermaid-graph","versionGroupId":"vg_a","version":2,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"graph TD; A-->C","objective":"Explicar","keyConcepts":[],"representation":"diagram"}'::jsonb) ->> 'id'),
  'art_a2', 'La versión siguiente de un grupo se acepta');
select throws_ok($$select api.create_artifact_version('proj_cmd', '{"id":"art_a2_bis","name":"X","type":"mermaid-graph","versionGroupId":"vg_a","version":2,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}'::jsonb)$$,
  'P0001', 'La versión ya no es la siguiente de su grupo: recarga antes de guardar',
  'A-02: dos pestañas que versionan a la vez no producen dos versiones 2');
select throws_ok($$select api.create_artifact_version('proj_cmd', '{"id":"art_a4","name":"X","type":"mermaid-graph","versionGroupId":"vg_a","version":4,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}'::jsonb)$$,
  'P0001', 'La versión ya no es la siguiente de su grupo: recarga antes de guardar',
  'A-02: no se salta una versión');
select throws_ok($$select api.create_artifact_version('proj_cmd', '{"id":"art_q2","name":"X","type":"mermaid-graph","versionGroupId":"vg_unknown","version":2,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}'::jsonb)$$,
  'P0002', 'El grupo de versiones no existe en el proyecto',
  'No se versiona un grupo que no existe');

-- ───────────────────────────────────────────── editar (H05)
select is((api.update_artifact('art_a1', 1, '{"name":"Contexto editado"}'::jsonb) -> 'revision')::bigint, 2::bigint,
  'Editar un artefacto sube su revisión');
select is((api.update_artifact('art_b1', 1, '{"content":"# Datos editados"}'::jsonb) -> 'revision')::bigint, 2::bigint,
  'H05: otra edición desde la misma lectura, en otro artefacto, no choca');
select throws_ok($$select api.update_artifact('art_a1', 1, '{"name":"Pisado"}'::jsonb)$$,
  'P0001', 'Conflicto de artefacto: recarga antes de guardar',
  'La misma edición sobre una revisión vieja sí choca');
select is((api.update_artifact('art_a1', 2, '{"id":"art_zz","version":7,"versionGroupId":"vg_zz","revision":50}'::jsonb) ->> 'version')::int, 1,
  'La identidad y la versión no se editan en sitio');
select throws_ok($$select api.update_artifact('art_a1', 3, '{"content":"   "}'::jsonb)$$,
  '22023', 'Un artefacto del proyecto no tiene una forma válida',
  'El resultado de un parche se valida entero');
select throws_ok($$select api.update_artifact('art_a1', 3, '{"meta":{"apiKey":"[REDACTED]"}}'::jsonb)$$,
  '22023', 'El agregado no puede contener apiKey',
  'Un parche no puede colar un secreto');
select throws_ok($$select api.update_artifact('art_missing', 1, '{"name":"x"}'::jsonb)$$,
  'P0002', 'El artefacto no existe',
  'Editar lo que no existe se informa');
reset role;
select is((select x ->> 'name' from api.architecture_projects p, jsonb_array_elements(p.artifact_index) x
  where p.id = 'proj_cmd' and x ->> 'id' = 'art_a1'), 'Contexto editado',
  'El índice refleja la edición');
select is((select revision from api.architecture_projects where id = 'proj_cmd'), 1::bigint,
  'Editar artefactos sigue sin mover la revisión del proyecto');

-- ───────────────────────────────────────────── varios a la vez
set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.revise_artifacts('proj_cmd', '[
  {"op":"create-version","artifact":{"id":"art_b2","name":"Datos v2","type":"markdown","versionGroupId":"vg_b","version":2,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista de Datos","content":"# v2","objective":"Modelo","keyConcepts":[],"representation":"document"}},
  {"op":"create-version","artifact":{"id":"art_a3","name":"Contexto v3","type":"mermaid-graph","versionGroupId":"vg_a","version":9,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}}
]'::jsonb)$$,
  'P0001', 'La versión ya no es la siguiente de su grupo: recarga antes de guardar',
  'Una sugerencia con un cambio inválido se rechaza entera');
reset role;
select is((select count(*)::int from api.project_artifacts where id = 'art_b2'), 0,
  'Y no deja aplicada la mitad válida');
set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000001"}';
select is(jsonb_array_length(api.revise_artifacts('proj_cmd', '[
  {"op":"create-version","artifact":{"id":"art_b2","name":"Datos v2","type":"markdown","versionGroupId":"vg_b","version":2,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista de Datos","content":"# v2","objective":"Modelo","keyConcepts":[],"representation":"document"}},
  {"op":"create-version","artifact":{"id":"art_a3","name":"Contexto v3","type":"mermaid-graph","versionGroupId":"vg_a","version":3,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"graph TD; A-->D","objective":"Explicar","keyConcepts":[],"representation":"diagram"}}
]'::jsonb)), 2, 'Dos versiones nuevas en una transacción');
select throws_ok($$select api.revise_artifacts('proj_cmd', '[{"op":"delete","artifactId":"art_a2","expectedRevision":7}]'::jsonb)$$,
  'P0001', 'Conflicto de artefacto: recarga antes de guardar',
  'Un borrado en lote también compara revisión');
select throws_ok($$select api.revise_artifacts('proj_cmd', '[{"op":"rename-everything"}]'::jsonb)$$,
  '22023', 'Operación de artefacto desconocida',
  'Una operación que no existe no se ignora');
select throws_ok($$select api.revise_artifacts('proj_cmd', '[]'::jsonb)$$,
  '22023', 'Los cambios de artefactos no tienen una forma válida',
  'Un lote vacío es un error del llamante');

-- ───────────────────────────────────────────── borrar
select throws_ok($$select api.delete_artifact('art_a2', 5)$$,
  'P0001', 'Conflicto de artefacto: recarga antes de borrar',
  'Borrar sobre una revisión vieja choca');
select lives_ok($$select api.delete_artifact('art_a2', 1)$$, 'Borrar con la revisión vigente');
select lives_ok($$select api.delete_artifact('art_a2', 1)$$, 'Borrar lo que ya no está es un éxito');
reset role;
select is((select artifact_count from api.architecture_projects where id = 'proj_cmd'), 4,
  'El contador sigue a las filas: a1, a3, b1, b2');
select is((select count(*)::int from api.project_artifacts where project_id = 'proj_cmd'), 4,
  'Borrar uno nunca borra otro');

-- ───────────────────────────────────────────── otro dueño, sin permiso
set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.update_artifact('art_a1', 3, '{"name":"Ajeno"}'::jsonb)$$,
  'P0002', 'El artefacto no existe',
  'Otro arquitecto no edita un artefacto ajeno, ni sabe que existe');
select throws_ok($$select api.create_artifact('proj_cmd', '{"id":"art_o1","name":"X","type":"mermaid-graph","versionGroupId":"vg_o","version":1,"createdAt":"2026-09-22T00:00:00.000Z","phase":"design","architecturalView":"Vista Lógica y de Diseño","content":"x","objective":"x","keyConcepts":[],"representation":"diagram"}'::jsonb)$$,
  '42501', 'El proyecto no pertenece a la sesión actual',
  'Otro arquitecto no crea en un proyecto ajeno');
select throws_ok($$select api.revise_artifacts('proj_cmd', '[{"op":"delete","artifactId":"art_a1","expectedRevision":3}]'::jsonb)$$,
  '42501', 'El proyecto no pertenece a la sesión actual',
  'Otro arquitecto no borra en lote en un proyecto ajeno');
select lives_ok($$select api.delete_artifact('art_a1', 3)$$,
  'Borrar lo ajeno no falla ni revela nada');
reset role;
select is((select count(*)::int from api.project_artifacts where id = 'art_a1'), 1,
  'Pero no borra lo ajeno');

set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000003"}';
select throws_ok($$select api.update_artifact('art_a1', 3, '{"name":"Lector"}'::jsonb)$$,
  '42501', 'Permiso insuficiente: project:write',
  'Un lector no escribe artefactos');
reset role;

-- ───────────────────────────────── la guarda de la ruta compuesta
set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.save_project_aggregate(
  '{"id":"proj_cmd","name":"Cliente viejo","initiativeIds":["init_artifact_cmd"],"userId":"64000000-0000-4000-8000-000000000001"}'::jsonb,
  '[]'::jsonb, 1)$$,
  'P0001', 'Los artefactos se guardan con sus propios comandos: recarga la aplicación',
  'Un cliente viejo con una lista distinta no borra lo que otros escribieron');
select is((api.save_project_aggregate(
  '{"id":"proj_cmd","name":"Raíz renombrada","initiativeIds":["init_artifact_cmd"],"userId":"64000000-0000-4000-8000-000000000001"}'::jsonb,
  api.load_project_aggregate('proj_cmd') -> 'artifacts', 1)).revision, 2::bigint,
  'Con la lista vigente, la ruta compuesta sólo guarda la raíz');
select is((api.save_project(
  '{"id":"proj_cmd","name":"Raíz otra vez","initiativeIds":["init_artifact_cmd"],"userId":"64000000-0000-4000-8000-000000000001"}'::jsonb,
  2)).revision, 3::bigint, 'save_project edita la raíz con su revisión');
reset role;
select is((select artifact_count from api.architecture_projects where id = 'proj_cmd'), 4,
  'Guardar la raíz no toca los artefactos');
select is((select name from api.architecture_projects where id = 'proj_cmd'), 'Raíz otra vez',
  'La raíz quedó guardada');

select * from finish();
rollback;
