begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

select has_table('api', 'office_engagements', 'El corte de encargos tiene su tabla raíz');
select has_table('api', 'office_arb_decisions', 'Las decisiones ARB viven en su propio registro');
select ok((select relrowsecurity from pg_class where oid = 'api.office_engagements'::regclass),
  'Los encargos tienen RLS');
select ok((select relrowsecurity from pg_class where oid = 'api.office_arb_decisions'::regclass),
  'Las decisiones ARB tienen RLS');
select ok(not has_table_privilege('authenticated', 'api.office_engagements', 'INSERT'),
  'El cliente no escribe encargo directo');
select ok(not has_table_privilege('authenticated', 'api.office_arb_decisions', 'INSERT'),
  'El cliente no escribe decisión ARB directa');
select ok(has_function_privilege('authenticated', 'api.save_engagement(text,jsonb,bigint)', 'EXECUTE'),
  'El cliente recibe una RPC de guardado de encargo');
select ok(has_function_privilege('authenticated', 'api.load_engagements(text)', 'EXECUTE'),
  'El cliente recibe una RPC de listado de encargos');
select ok(not has_function_privilege('authenticated', 'api.record_arb_decision(jsonb)', 'EXECUTE'),
  'La RPC de decisión antigua ya no forma parte de la superficie cliente');
select ok(
  (select exists(select 1 from information_schema.routines
    where routine_schema = 'api' and routine_name = 'load_arb_engagements'))
  is true,
  'La bandeja ARB existe tras las migraciones de gobernanza');

insert into auth.users (id, email) values
  ('63000000-0000-4000-8000-000000000001', 'office-architect@example.invalid'),
  ('63000000-0000-4000-8000-000000000002', 'office-reviewer@example.invalid'),
  ('63000000-0000-4000-8000-000000000003', 'office-admin@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('63000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('63000000-0000-4000-8000-000000000002', 'reviewer', 'active'),
  ('63000000-0000-4000-8000-000000000003', 'admin', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('73000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', null),
  ('73000000-0000-4000-8000-000000000002', '63000000-0000-4000-8000-000000000002', null),
  ('73000000-0000-4000-8000-000000000003', '63000000-0000-4000-8000-000000000003', null)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"63000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"73000000-0000-4000-8000-000000000001"}';
select is((select (api.save_engagement('proj_legacy_001', $json$
{
  "id": "eng_legacy_001", "projectId": "proj_legacy_001", "schemaVersion": 1,
  "title": "Encargo de prueba", "brief": "Brief original del encargo",
  "initiativeIds": ["init_legacy_001"], "businessProjectIds": ["NEG-2026-620"],
  "status": "awaiting-charter", "priority": "medium",
  "charter": {"kind": "new-solution", "objectives": [], "scope": [], "outOfScope": [], "constraints": [],
    "regulatoryDrivers": [], "deliverables": [], "participantIds": [], "coordinatorId": "lucia",
    "consolidatorId": "alejandro", "provenance": "deterministic", "proposedAt": "2026-09-12T00:00:00.000Z"},
  "tasks": [], "arbDecisions": [], "budget": {"maxAiCalls": 40, "consumedAiCalls": 0},
  "auditTrail": [], "createdBy": {"id": "63000000-0000-4000-8000-000000000001", "name": "Arquitecto", "role": "architect"},
  "createdAt": "2026-09-12T00:00:00.000Z", "updatedAt": "2026-09-12T00:00:00.000Z"
}$json$::jsonb, 0)).revision), 1::bigint,
  'El arquitecto guarda un encargo con proyecto textual ajeno a la tabla de proyectos');
select is((select jsonb_array_length(api.load_engagements('proj_legacy_001'))), 1,
  'El listado hidrata el encargo propio');

-- La forma de la fila, no sólo el recuento. El repositorio lee `{revision, data}`
-- —igual que en la respuesta de `save_engagement`— y descarta cualquier fila sin
-- `revision` entera. Cuando esta RPC devolvía el documento a secas, toda lectura
-- de encargos moría con «fila inválida» y la sala se quedaba vacía; el recuento
-- de arriba pasaba igual, porque contaba elementos y no su forma.
select is((select api.load_engagements('proj_legacy_001') -> 0 ? 'revision'), true,
  'Cada fila trae su revisión: es la concurrencia optimista del agregado');
select is((select api.load_engagements('proj_legacy_001') -> 0 ? 'data'), true,
  'El documento viaja bajo `data`, que es donde el repositorio lo busca');
select is((select api.load_engagements('proj_legacy_001') -> 0 -> 'data' ->> 'id'), 'eng_legacy_001',
  'El documento sigue siendo el encargo, no un envoltorio vacío');
select is((select api.load_engagements('proj_legacy_001') -> 0 -> 'data' -> 'arbDecisions'), '[]'::jsonb,
  'El espejo de decisiones se reemplaza por el registro inmutable, dentro de `data`');
reset role;

-- La API antigua queda cerrada; la decisión se cubre en decide_engagement_atomic.
select is((select count(*) from api.office_arb_decisions), 0::bigint,
  'Crear y leer el encargo no inventa decisiones ARB');

set local role authenticated;
set local request.jwt.claims = '{"sub":"63000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"73000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.save_engagement(
  'proj_legacy_001', '{"id":"eng_secret","projectId":"proj_legacy_001","title":"x","brief":"x","status":"intake","charter":{"k":1},"tasks":[],"auditTrail":[],"budget":{"maxAiCalls":1,"consumedAiCalls":0},"nested":{"apiKey":"[REDACTED]"}}'::jsonb, 0)$$,
  '22023', 'El encargo no puede contener apiKey',
  'La RPC rechaza secretos anidados en el encargo');
select throws_ok($$select api.save_engagement(
  'proj_legacy_001', '{"id":"eng_bad_status","projectId":"proj_legacy_001","title":"x","brief":"x","status":"running","charter":{"k":1},"tasks":[],"auditTrail":[],"budget":{"maxAiCalls":1,"consumedAiCalls":0}}'::jsonb, 0)$$,
  '22023', 'El estado del encargo no es válido',
  'La RPC rechaza un estado fuera del ciclo de vida');
select throws_ok($$select api.save_engagement(
  'proj_legacy_001', '{"id":"eng_legacy_001","projectId":"proj_legacy_001","title":"x","brief":"x","status":"intake","charter":{"k":1},"tasks":[],"auditTrail":[],"budget":{"maxAiCalls":1,"consumedAiCalls":0}}'::jsonb, 0)$$,
  'P0001', 'Conflicto de encargo: recarga antes de guardar',
  'Una revisión obsoleta no sobrescribe el encargo');
select throws_ok($$select api.save_engagement(
  'proj_legacy_001', '{"id":"eng_legacy_001","projectId":"proj_legacy_001","title":"x","brief":"x","status":"delivered","charter":{"k":1},"tasks":[],"auditTrail":[],"budget":{"maxAiCalls":1,"consumedAiCalls":0}}'::jsonb, 1)$$,
  '22023', 'Use api.decide_engagement para entregar un encargo',
  'Sólo la RPC transaccional del comité lleva un encargo a delivered');
select throws_ok($$select api.delete_engagement('proj_legacy_001', 'eng_legacy_001', 99)$$,
  'P0001', 'Conflicto de encargo: recarga antes de borrar',
  'Un borrado desde una vista obsoleta no elimina una edición concurrente');
reset role;

select is((select count(*) from api.office_arb_decisions), 0::bigint,
  'Las operaciones ordinarias no dejaron decisiones ARB');

select * from finish();
rollback;