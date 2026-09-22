-- Contratos de 20260920120000 — la sobrecarga retirada y la referencia protegida.
--
-- Cada bloque comprueba las dos mitades: que lo legítimo sigue funcionando, y
-- que lo ilegítimo se rechaza. Una guarda sin caso negativo es una guarda que
-- nadie ha comprobado que esté cerrada — que es exactamente cómo la sobrecarga
-- de dos argumentos sobrevivió a la migración que la sustituía.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

-- ───────────────────────────── 1. la sobrecarga sin revisión ya no existe
select is(
  (select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname = 'delete_engagement'),
  1,
  'api.delete_engagement tiene exactamente una firma');

-- Por número de argumentos, no por el texto de la firma:
-- `pg_get_function_identity_arguments` incluye los **nombres** de los
-- parámetros (`p_project_id text, …`), así que compararlo contra `text, text,
-- bigint` falla por una razón que no tiene nada que ver con lo que se quiere
-- afirmar, y renombrar un parámetro rompería la prueba sin romper la guarda.
select is(
  (select p.pronargs::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname = 'delete_engagement'),
  3,
  'La firma que queda es la de tres argumentos, la que compara revisión');

select ok(
  not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'api' and p.proname = 'delete_engagement' and p.pronargs = 2),
  'La sobrecarga de dos argumentos, que borraba sin comparar revisión, no es invocable');

select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api' and p.proname = 'delete_engagement'),
  'p_project_id text, p_engagement_id text, p_expected_revision bigint',
  'Y el tercer argumento es la revisión esperada, no cualquier bigint');

select ok(has_function_privilege('authenticated', 'api.delete_engagement(text,text,bigint)', 'EXECUTE'),
  'El cliente conserva la RPC de borrado con revisión');

-- ───────────────────────────── 2. la referencia proyecto → iniciativa
insert into auth.users (id, email) values
  ('64000000-0000-4000-8000-000000000001', 'ref-owner@example.invalid'),
  ('64000000-0000-4000-8000-000000000002', 'ref-other@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('64000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('64000000-0000-4000-8000-000000000002', 'architect', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('74000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001', null),
  ('74000000-0000-4000-8000-000000000002', '64000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000001"}';

select is((select (api.save_business_initiative($json${
  "id":"init_ref_cited", "schemaVersion":1, "code":"NEG-2026-701",
  "title":"Iniciativa citada", "need":"Sostiene un proyecto", "driver":"",
  "objectives":[], "expectedOutcomes":[], "affectedCapabilities":[], "businessUnits":[],
  "status":"draft", "priority":"medium", "horizon":"next", "riskLevel":"medium",
  "risks":[], "regulatoryDrivers":[], "kpis":[], "milestones":[], "stakeholders":[],
  "documents":[], "dependsOnCodes":[], "notes":[], "provenance":"manual",
  "userId":"64000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-20T00:00:00.000Z", "updatedAt":"2026-09-20T00:00:00.000Z"
}$json$::jsonb, 0)).revision), 1::bigint, 'Existe una iniciativa que un proyecto va a citar');

select is((select (api.save_business_initiative($json${
  "id":"init_ref_free", "schemaVersion":1, "code":"NEG-2026-702",
  "title":"Iniciativa sin proyectos", "need":"No la cita nadie", "driver":"",
  "objectives":[], "expectedOutcomes":[], "affectedCapabilities":[], "businessUnits":[],
  "status":"draft", "priority":"medium", "horizon":"next", "riskLevel":"medium",
  "risks":[], "regulatoryDrivers":[], "kpis":[], "milestones":[], "stakeholders":[],
  "documents":[], "dependsOnCodes":[], "notes":[], "provenance":"manual",
  "userId":"64000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-20T00:00:00.000Z", "updatedAt":"2026-09-20T00:00:00.000Z"
}$json$::jsonb, 0)).revision), 1::bigint, 'Existe una iniciativa que nadie cita');

select is((select (api.save_project($json${
  "id":"proj_ref_001", "name":"Atención que cita", "description":"", "projectContext":[],
  "initiativeIds":["init_ref_cited"], "linkedBusinessProjects":["NEG-2026-701"],
  "userId":"64000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-20T00:00:00.000Z", "updatedAt":"2026-09-20T00:00:00.000Z"
}$json$::jsonb, 0)).revision), 1::bigint,
  'El proyecto se guarda citando una iniciativa viva — el bloqueo no estorba al camino feliz');

-- El caso negativo que da nombre al hallazgo.
select throws_ok($$select api.delete_business_initiative('init_ref_cited', 1)$$,
  '23503', null::text,
  'Una iniciativa citada por un proyecto no se borra');

reset role;
-- Fuera del bloque `authenticated`: los privilegios de tabla están revocados
-- para ese rol por diseño, así que una lectura directa escrita dentro no falla
-- como aserción — aborta la transacción con `permission denied` y se lleva por
-- delante todo lo que viene después, que aquí era justo lo que da nombre al
-- hallazgo.
select is((select count(*)::int from api.business_initiatives where id = 'init_ref_cited'), 1,
  'El borrado rechazado no dejó la iniciativa a medias');
set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000001"}';

select is((select (api.save_project($json${
  "id":"proj_ref_001", "name":"Atención que cita", "description":"", "projectContext":[],
  "initiativeIds":["init_ref_cited"], "linkedBusinessProjects":["NEG-2026-701"],
  "userId":"64000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-20T00:00:00.000Z", "updatedAt":"2026-09-20T00:00:00.000Z"
}$json$::jsonb, 1)).revision), 2::bigint,
  'El proyecto sigue siendo guardable — que es lo que el borrado silencioso rompía');

-- Una iniciativa sin citas se borra igual que antes: la guarda nueva no
-- convierte el borrado en imposible, sólo en informado.
select lives_ok($$select api.delete_business_initiative('init_ref_free', 1)$$,
  'Una iniciativa que nadie cita se borra');
reset role;
select is((select count(*)::int from api.business_initiatives where id = 'init_ref_free'), 0,
  'El borrado legítimo sí ocurre');
set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000001"}';

-- La revisión sigue mandando, y se comprueba **después** de las citas: un
-- borrado con revisión obsoleta sobre una iniciativa libre sigue siendo conflicto.
select throws_ok($$select api.delete_business_initiative('init_ref_cited', 99)$$,
  '23503', null::text,
  'La comprobación de citas precede a la de revisión: lo que impide el borrado es la referencia');

reset role;

-- Las citas de otro usuario no cuentan: la frontera de autorización sigue
-- siendo el propietario, y contar proyectos ajenos filtraría su existencia.
set local role authenticated;
set local request.jwt.claims = '{"sub":"64000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"74000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.delete_business_initiative('init_ref_cited', 1)$$,
  'P0001', 'Conflicto de iniciativa: recarga antes de borrar',
  'Una iniciativa ajena no se borra, y el motivo no revela que la citen proyectos ajenos');
reset role;

select * from finish();
rollback;
