-- Contratos de `api.decide_engagement` — la decisión del ARB en una transacción.
--
-- Cada guarda lleva su caso negativo. La que da nombre a todo esto es la
-- última del bloque de atomicidad: un fallo **después** de insertar la decisión
-- no puede dejar la decisión escrita y el encargo sin mover, porque las dos
-- cosas están en la misma transacción.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant usage on schema api to authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

select has_column('api', 'office_arb_decisions', 'decided_revision',
  'La decisión recuerda sobre qué versión del encargo se firmó');
select ok(has_function_privilege('authenticated', 'api.decide_engagement(text,jsonb,bigint,jsonb)', 'EXECUTE'),
  'El cliente recibe la RPC transaccional de decisión');
select ok(not has_table_privilege('authenticated', 'api.office_arb_decisions', 'UPDATE'),
  'El registro del comité sigue sin poder modificarse');

insert into auth.users (id, email) values
  ('65000000-0000-4000-8000-000000000001', 'arb-admin@example.invalid'),
  ('65000000-0000-4000-8000-000000000002', 'arb-architect@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('65000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('65000000-0000-4000-8000-000000000002', 'architect', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('75000000-0000-4000-8000-000000000001', '65000000-0000-4000-8000-000000000001', null),
  ('75000000-0000-4000-8000-000000000002', '65000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000002"}';

-- El autor prepara dos encargos; quien los decidirá será otra persona.
select is((select (api.save_engagement('proj_arb_001', $json${
  "id":"eng_arb_001", "projectId":"proj_arb_001", "schemaVersion":1,
  "title":"Encargo en comité", "brief":"Listo para el ARB.",
  "initiativeIds":["init_arb_001"], "businessProjectIds":[],
  "status":"awaiting-charter", "priority":"medium",
  "charter":{"kind":"new-solution","objectives":[],"scope":[],"outOfScope":[],"constraints":[],
    "regulatoryDrivers":[],"deliverables":[],"participantIds":[],"coordinatorId":"lucia",
    "consolidatorId":"alejandro","provenance":"deterministic",
    "proposedAt":"2026-09-20T00:00:00.000Z","approvedAt":"2026-09-20T01:00:00.000Z"},
  "tasks":[], "arbDecisions":[], "budget":{"maxAiCalls":40,"consumedAiCalls":0},
  "auditTrail":[], "createdBy":{"id":"65000000-0000-4000-8000-000000000001","name":"Ana","role":"admin"},
  "createdAt":"2026-09-20T00:00:00.000Z", "updatedAt":"2026-09-20T00:00:00.000Z"
}$json$::jsonb, 0)).revision), 1::bigint, 'Hay un encargo esperando al comité');

-- Otro encargo permite demostrar que un id de decisión globalmente repetido no
-- puede "firmar" el primero y transicionar el segundo. Ésa era la grieta de
-- `on conflict (id) do nothing`: callaba la colisión y seguía con el UPDATE.
select is((select (api.save_engagement('proj_arb_002', $json${
  "id":"eng_arb_002", "projectId":"proj_arb_002", "schemaVersion":1,
  "title":"Segundo encargo en comité", "brief":"También listo para el ARB.",
  "initiativeIds":["init_arb_002"], "businessProjectIds":[],
  "status":"awaiting-charter", "priority":"medium",
  "charter":{"kind":"new-solution","objectives":[],"scope":[],"outOfScope":[],"constraints":[],
    "regulatoryDrivers":[],"deliverables":[],"participantIds":[],"coordinatorId":"lucia",
    "consolidatorId":"alejandro","provenance":"deterministic",
    "proposedAt":"2026-09-20T00:00:00.000Z","approvedAt":"2026-09-20T01:00:00.000Z"},
  "tasks":[], "arbDecisions":[], "budget":{"maxAiCalls":40,"consumedAiCalls":0},
  "auditTrail":[], "createdBy":{"id":"65000000-0000-4000-8000-000000000001","name":"Ana","role":"admin"},
  "createdAt":"2026-09-20T00:00:00.000Z", "updatedAt":"2026-09-20T00:00:00.000Z"
}$json$::jsonb, 0)).revision), 1::bigint, 'Hay un segundo encargo esperando al comité');

reset role;
-- Fixture de la RPC de decisión: el recorrido ordinario hasta awaiting-arb está
-- cubierto por la matriz de F2-02; aquí se aísla la transacción del comité.
update api.office_engagements
set data = jsonb_set(data, '{status}', '"awaiting-arb"'::jsonb)
where id in ('eng_arb_001', 'eng_arb_002');
insert into api.office_arb_decisions
  (id, engagement_id, project_id, owner_id, data, decided_revision)
values (
  'arb_collision', 'eng_arb_002', 'proj_arb_002',
  '65000000-0000-4000-8000-000000000001',
  $json${
    "id":"arb_collision","engagementId":"eng_arb_002","verdict":"approved","rationale":"",
    "actor":{"id":"65000000-0000-4000-8000-000000000001","name":"Ana","role":"admin"},
    "gateStatusAtDecision":"pass","previousStatus":"awaiting-arb",
    "decidedAt":"2026-09-20T01:30:00.000Z"
  }$json$::jsonb,
  1
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000001"}';
select is(jsonb_array_length(api.load_arb_engagements()), 2,
  'El miembro ARB descubre los dos encargos ajenos pendientes');
select throws_ok($$select api.decide_engagement('proj_arb_001', $j${
  "id":"eng_arb_001","projectId":"proj_arb_001","title":"Encargo en comité","brief":"x",
  "status":"delivered","charter":{"k":1},"tasks":[],"auditTrail":[],"arbDecisions":[],
  "budget":{"maxAiCalls":1,"consumedAiCalls":0}}$j$::jsonb, 1,
  $j${"id":"arb_collision","engagementId":"eng_arb_001","verdict":"approved","rationale":"",
  "actor":{"id":"65000000-0000-4000-8000-000000000001","name":"Ana","role":"admin"}}$j$::jsonb)$$,
  '23505', 'El identificador de la decisión ya pertenece a otra decisión',
  'Una colisión del id de decisión aborta toda la operación');
reset role;
-- La colisión se sembró deliberadamente en el segundo encargo; el intento sobre
-- el primero debe abortar entero en vez de convertir un id ajeno en su firma.
select is((select count(*)::int from api.office_arb_decisions where engagement_id = 'eng_arb_001'), 0,
  'La colisión no añadió una decisión al encargo objetivo');

-- Incluso con el permiso del comité, el autor no puede autoaprobarse.
update api.user_profiles set role = 'reviewer'
where id = '65000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.decide_engagement('proj_arb_002', $j${
  "id":"eng_arb_002","projectId":"proj_arb_002","status":"delivered"}$j$::jsonb, 1,
  $j${"id":"arb_self","engagementId":"eng_arb_002","verdict":"approved","rationale":"",
  "actor":{"id":"65000000-0000-4000-8000-000000000002","name":"Beto","role":"reviewer"}}$j$::jsonb)$$,
  '42501', 'El autor no puede decidir su propio encargo',
  'El permiso arb:decide no permite autoaprobarse');
reset role;
update api.user_profiles set role = 'architect'
where id = '65000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000001"}';

-- ─────────────────────────────── las guardas, cada una con su negativo
-- La fila conserva un gate bloqueado aunque el cliente intente aprobarla directo
-- por RPC: la autoridad es el estado bloqueado, no la UI.
reset role;
update api.office_engagements
set data = jsonb_set(data, '{gateAssessment}', '{"overallStatus":"blocked","gates":[]}'::jsonb)
where id = 'eng_arb_002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.decide_engagement('proj_arb_002', $j${
  "id":"eng_arb_002","projectId":"proj_arb_002","status":"delivered"}$j$::jsonb, 1,
  $j${"id":"arb_blocked","engagementId":"eng_arb_002","verdict":"approved","rationale":""}$j$::jsonb)$$,
  '22023', 'No se puede aprobar: hay quality gates bloqueados',
  'La RPC rechaza aprobar por encima de un gate bloqueado');
select is((select count(*)::int from api.office_arb_decisions where engagement_id = 'eng_arb_002'), 1,
  'El gate bloqueado no añade una decisión');

select throws_ok($$select api.decide_engagement('proj_arb_001', $j${
  "id":"eng_arb_001","projectId":"proj_arb_001","title":"x","brief":"x","status":"delivered",
  "charter":{"k":1},"tasks":[],"auditTrail":[],"arbDecisions":[],
  "budget":{"maxAiCalls":1,"consumedAiCalls":0}}$j$::jsonb, 99,
  $j${"id":"arb_x","engagementId":"eng_arb_001","verdict":"approved","rationale":"",
  "actor":{"id":"65000000-0000-4000-8000-000000000001","name":"Ana","role":"admin"}}$j$::jsonb)$$,
  'P0001', 'Conflicto de encargo: recarga antes de guardar',
  'Una revisión obsoleta no decide');

select throws_ok($$select api.decide_engagement('proj_arb_001', $j${
  "id":"eng_arb_001","projectId":"proj_arb_001","title":"x","brief":"x","status":"cancelled",
  "charter":{"k":1},"tasks":[],"auditTrail":[],"arbDecisions":[],
  "budget":{"maxAiCalls":1,"consumedAiCalls":0}}$j$::jsonb, 1,
  $j${"id":"arb_x","engagementId":"eng_arb_001","verdict":"approved","rationale":"",
  "actor":{"id":"65000000-0000-4000-8000-000000000001","name":"Ana","role":"admin"}}$j$::jsonb)$$,
  '22023', 'Un veredicto "approved" lleva el encargo a "delivered", no a "cancelled"',
  'El veredicto y el estado nuevo tienen que corresponderse');

select throws_ok($$select api.decide_engagement('proj_arb_001', $j${
  "id":"eng_arb_001","projectId":"proj_arb_001","title":"x","brief":"x","status":"cancelled",
  "charter":{"k":1},"tasks":[],"auditTrail":[],"arbDecisions":[],
  "budget":{"maxAiCalls":1,"consumedAiCalls":0}}$j$::jsonb, 1,
  $j${"id":"arb_x","engagementId":"eng_arb_001","verdict":"rejected","rationale":"",
  "actor":{"id":"65000000-0000-4000-8000-000000000001","name":"Ana","role":"admin"}}$j$::jsonb)$$,
  '22023', 'Un veredicto de cambio o rechazo exige motivo',
  'El comité no rechaza sin motivo escrito');

reset role;
-- La lectura directa va **fuera** del bloque `authenticated`, y no es un detalle
-- de estilo: los privilegios de tabla están revocados para ese rol por diseño,
-- así que una comprobación escrita dentro no falla como aserción — aborta la
-- transacción con `permission denied` y se lleva por delante el resto del
-- fichero. Que estas tres líneas hubiera que moverlas es la postura
-- deny-by-default funcionando sobre su propia suite.
select is((select count(*)::int from api.office_arb_decisions where engagement_id = 'eng_arb_001'), 0,
  'Ninguna guarda dejó una decisión a medias');

-- Un arquitecto no decide, aunque pueda escribir el proyecto.
update api.user_profiles set role = 'architect'
where id = '65000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.decide_engagement('proj_arb_001', $j${
  "id":"eng_arb_001","projectId":"proj_arb_001","title":"x","brief":"x","status":"delivered",
  "charter":{"k":1},"tasks":[],"auditTrail":[],"arbDecisions":[],
  "budget":{"maxAiCalls":1,"consumedAiCalls":0}}$j$::jsonb, 1,
  $j${"id":"arb_x","engagementId":"eng_arb_001","verdict":"approved","rationale":"",
  "actor":{"id":"65000000-0000-4000-8000-000000000002","name":"Beto","role":"architect"}}$j$::jsonb)$$,
  '42501', 'Permiso insuficiente: arb:decide',
  'project:write no basta para firmar en el comité');
reset role;

-- ─────────────────────────────── el camino feliz, y su atomicidad
set local role authenticated;
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000001"}';
select is((select (api.decide_engagement('proj_arb_001', $json${
  "id":"eng_arb_001","projectId":"proj_arb_001","schemaVersion":1,
  "title":"Título manipulado por el revisor","brief":"Listo para el ARB.",
  "initiativeIds":["init_arb_001"],"businessProjectIds":[],
  "status":"delivered","priority":"medium",
  "charter":{"kind":"new-solution","objectives":[],"scope":[],"outOfScope":[],"constraints":[],
    "regulatoryDrivers":[],"deliverables":[],"participantIds":[],"coordinatorId":"lucia",
    "consolidatorId":"alejandro","provenance":"deterministic",
    "proposedAt":"2026-09-20T00:00:00.000Z","approvedAt":"2026-09-20T01:00:00.000Z"},
  "tasks":[],"arbDecisions":[],"budget":{"maxAiCalls":40,"consumedAiCalls":0},
  "auditTrail":[{"id":"audit_1","engagementId":"eng_arb_001","action":"arb-decided",
    "actor":{"id":"65000000-0000-4000-8000-000000000001","name":"Ana","role":"admin"},
    "timestamp":"2026-09-20T02:00:00.000Z","details":"Ana aprobó el encargo."}],
  "createdBy":{"id":"65000000-0000-4000-8000-000000000001","name":"Ana","role":"admin"},
  "createdAt":"2026-09-20T00:00:00.000Z","updatedAt":"2026-09-20T02:00:00.000Z"
}$json$::jsonb, 1, $json${
  "id":"arb_001","engagementId":"eng_arb_001","verdict":"approved","rationale":"",
  "actor":{"id":"65000000-0000-4000-8000-000000000001","name":"Mallory","role":"superadmin"},
  "gateStatusAtDecision":"blocked","previousStatus":"intake",
  "decidedAt":"1970-01-01T00:00:00.000Z"
}$json$::jsonb)).revision), 2::bigint, 'La decisión firma y transiciona en una operación');
reset role;

select is((select count(*)::int from api.office_arb_decisions where id = 'arb_001'), 1,
  'La decisión quedó en el registro inmutable');
select is((select decided_revision from api.office_arb_decisions where id = 'arb_001'), 1::bigint,
  'La decisión recuerda la revisión que el comité tenía delante');
select is((select data ->> 'status' from api.office_engagements where id = 'eng_arb_001'), 'delivered',
  'El encargo transicionó en la misma transacción');
select is((select data ->> 'title' from api.office_engagements where id = 'eng_arb_001'), 'Encargo en comité',
  'El revisor no puede alterar el título del encargo mientras decide');
select is(
  (select jsonb_array_length(data -> 'arbDecisions') from api.office_engagements where id = 'eng_arb_001'),
  1, 'El espejo lo reconstruyó el servidor desde el registro');
select is(
  (select (data -> 'arbDecisions' -> 0 -> 'actor') ->> 'name' from api.office_engagements where id = 'eng_arb_001'),
  '65000000-0000-4000-8000-000000000001',
  'El servidor canoniza el nombre del firmante y no conserva el enviado por el cliente');
select is(
  (select (data -> 'arbDecisions' -> 0 -> 'actor') ->> 'role' from api.office_engagements where id = 'eng_arb_001'),
  'admin', 'El servidor canoniza el rol vigente del firmante');
select is(
  (select (data -> 'arbDecisions' -> 0) ->> 'gateStatusAtDecision' from api.office_engagements where id = 'eng_arb_001'),
  'conditional', 'El servidor toma el estado de gates persistido, no el enviado');
select is(
  (select (data -> 'arbDecisions' -> 0) ->> 'previousStatus' from api.office_engagements where id = 'eng_arb_001'),
  'awaiting-arb', 'El servidor toma el estado previo bloqueado de la fila');
select isnt(
  (select (data -> 'arbDecisions' -> 0) ->> 'decidedAt' from api.office_engagements where id = 'eng_arb_001'),
  '1970-01-01T00:00:00.000Z', 'El servidor estampa la hora de la decisión');
select is(
  (select jsonb_array_length(data -> 'auditTrail') from api.office_engagements where id = 'eng_arb_001'),
  0, 'La auditoría enviada por el cliente se ignora al decidir');
select is(
  (select (api.decide_engagement('proj_arb_001', $j${
    "id":"eng_arb_001","projectId":"proj_arb_001","status":"delivered"}$j$::jsonb, 1,
    $j${"id":"arb_001","engagementId":"eng_arb_001","verdict":"approved","rationale":"",
    "actor":{"id":"forged","name":"Mallory","role":"superadmin"}}$j$::jsonb)).revision),
  2::bigint, 'El reintento exacto devuelve la decisión ya persistida sin duplicarla');
select is((select count(*)::int from api.office_arb_decisions where id = 'arb_001'), 1,
  'El reintento exacto no duplica el registro inmutable');
-- Un encargo ya entregado no vuelve al comité.
set local role authenticated;
set local request.jwt.claims = '{"sub":"65000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"75000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.decide_engagement('proj_arb_001', $j${
  "id":"eng_arb_001","projectId":"proj_arb_001","title":"x","brief":"x","status":"cancelled",
  "charter":{"k":1},"tasks":[],"auditTrail":[],"arbDecisions":[],
  "budget":{"maxAiCalls":1,"consumedAiCalls":0}}$j$::jsonb, 2,
  $j${"id":"arb_002","engagementId":"eng_arb_001","verdict":"rejected","rationale":"Cambio de opinión",
  "actor":{"id":"65000000-0000-4000-8000-000000000001","name":"Ana","role":"admin"}}$j$::jsonb)$$,
  '22023', 'El encargo no está en revisión del comité (estado actual: "delivered")',
  'Un encargo entregado no se vuelve a decidir');
reset role;

select is((select count(*)::int from api.office_arb_decisions where engagement_id = 'eng_arb_001'), 1,
  'El intento rechazado no añadió una segunda firma');

select * from finish();
rollback;
