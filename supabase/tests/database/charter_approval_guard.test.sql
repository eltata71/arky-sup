-- F6-08 · E-02 / H06 y 14.1 · R-02: nadie ejecuta un charter sin aprobar, y quien
-- aprueba no es quien lo escribió — en el servidor.
--
-- Cada regla con su caso negativo, el camino que usa la aplicación (aprobar y
-- pasar a `in-progress` en una sola escritura, firmado por la sesión), que un
-- encargo ajeno no revela si está aprobado, y que una aprobación antigua sin
-- firmante se sigue pudiendo guardar.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

select ok(not has_function_privilege('authenticated', 'private.assert_charter_approval(jsonb,jsonb,uuid)', 'EXECUTE'),
  'La regla no es invocable por el cliente: sólo desde save_engagement');

insert into auth.users (id, email) values
  ('68000000-0000-4000-8000-000000000001', 'charter-owner@example.invalid'),
  ('68000000-0000-4000-8000-000000000002', 'charter-other@example.invalid'),
  ('68000000-0000-4000-8000-000000000003', 'charter-author-reviewer@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('68000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('68000000-0000-4000-8000-000000000002', 'reviewer', 'active'),
  ('68000000-0000-4000-8000-000000000003', 'reviewer', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('78000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', null),
  ('78000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000002', null),
  ('78000000-0000-4000-8000-000000000003', '68000000-0000-4000-8000-000000000003', null)
on conflict (id) do nothing;

-- Un encargo con el estado y la aprobación que se pidan.
create function pg_temp.engagement(p_id text, p_status text, p_approved_at text, p_approved_by text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'projectId', 'proj_charter', 'schemaVersion', 1,
    'title', 'Encargo con charter', 'brief', 'Probar la aprobación en el servidor.',
    'initiativeIds', jsonb_build_array('init_charter'), 'businessProjectIds', '[]'::jsonb,
    'status', p_status, 'priority', 'medium',
    'charter', jsonb_strip_nulls(jsonb_build_object(
      'kind', 'new-solution', 'objectives', '[]'::jsonb, 'scope', '[]'::jsonb,
      'outOfScope', '[]'::jsonb, 'constraints', '[]'::jsonb, 'regulatoryDrivers', '[]'::jsonb,
      'deliverables', jsonb_build_array(jsonb_build_object('id', 'd1', 'title', 'Artefacto')), 'participantIds', '[]'::jsonb,
      'coordinatorId', 'lucia', 'consolidatorId', 'alejandro', 'provenance', 'deterministic',
      'proposedAt', '2026-09-26T00:00:00.000Z',
      'approvedAt', p_approved_at,
      'approvedBy', case when p_approved_by is null then null
                         else jsonb_build_object('id', p_approved_by, 'name', 'Quien firma', 'role', 'architect') end)),
    'tasks', '[]'::jsonb, 'arbDecisions', '[]'::jsonb,
    'budget', jsonb_build_object('maxAiCalls', 10, 'consumedAiCalls', 0),
    'auditTrail', '[]'::jsonb,
    'createdAt', '2026-09-26T00:00:00.000Z', 'updatedAt', '2026-09-26T00:00:00.000Z');
$$;
grant execute on function pg_temp.engagement(text, text, text, text) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"68000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"78000000-0000-4000-8000-000000000001"}';

select is((api.save_business_initiative($json${
  "id":"init_charter", "schemaVersion":1, "code":"NEG-2034-001",
  "title":"Necesidad", "need":"Probar la aprobación del charter", "driver":"",
  "objectives":[], "expectedOutcomes":[], "affectedCapabilities":[], "businessUnits":[],
  "status":"draft", "priority":"medium", "horizon":"next", "riskLevel":"medium",
  "risks":[], "regulatoryDrivers":[], "kpis":[], "milestones":[], "stakeholders":[],
  "documents":[], "dependsOnCodes":[], "notes":[], "provenance":"manual",
  "userId":"68000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-26T00:00:00.000Z", "updatedAt":"2026-09-26T00:00:00.000Z"
}$json$::jsonb, 0)).revision, 1::bigint, 'Existe la iniciativa');
select is((api.save_project(
  '{"id":"proj_charter","name":"Atención con encargo","initiativeIds":["init_charter"],"userId":"68000000-0000-4000-8000-000000000001"}'::jsonb,
  0)).revision, 1::bigint, 'Existe el proyecto');

select is((api.save_engagement('proj_charter', pg_temp.engagement('eng_c1', 'awaiting-charter', null, null), 0)).revision,
  1::bigint, 'Un encargo nace esperando la aprobación de su charter');

-- ───────────────────────────────────────────── regla 1: sin aprobación no se ejecuta
select throws_ok($$select api.save_engagement('proj_charter', pg_temp.engagement('eng_c1', 'in-progress', null, null), 1)$$,
  '22023', 'El charter debe aprobarse antes de ejecutar el encargo',
  'Pasar a in-progress sin aprobar el charter se rechaza: ya no basta con saltarse el runner');

-- ───────────────────────────────────────────── regla 3 (14.1): save_engagement no aprueba
select throws_ok($$select api.save_engagement('proj_charter',
    pg_temp.engagement('eng_c1', 'in-progress', '2026-09-26T01:00:00.000Z', '68000000-0000-4000-8000-000000000001'), 1)$$,
  '42501', 'El charter se aprueba sólo con api.approve_charter',
  'Ni el propio autor firma su charter por una escritura genérica');
select throws_ok($$select api.save_engagement('proj_charter',
    pg_temp.engagement('eng_c1', 'awaiting-charter', '2026-09-26T01:00:00.000Z', '68000000-0000-4000-8000-000000000002'), 1)$$,
  '42501', 'El charter se aprueba sólo con api.approve_charter',
  'Ni con la firma de otro, ni sin cambiar de estado');

-- ───────────────────────────────────────────── aprobar exige charter:approve
select throws_ok($$select api.approve_charter('proj_charter', 'eng_c1', 1)$$,
  '42501', 'Permiso insuficiente: charter:approve',
  'Un arquitecto no aprueba charters');
select throws_ok($$select api.load_charter_engagements()$$,
  '42501', 'Permiso insuficiente: charter:approve',
  'Ni ve la bandeja de aprobación');

-- ───────────────────────────────────────────── el autor no aprueba el suyo
reset role;
insert into api.office_engagements (id, project_id, owner_id, data, revision)
values ('eng_c3', 'proj_charter', '68000000-0000-4000-8000-000000000003',
  pg_temp.engagement('eng_c3', 'awaiting-charter', null, null), 1);
set local role authenticated;
set local request.jwt.claims = '{"sub":"68000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"78000000-0000-4000-8000-000000000003"}';
select throws_ok($$select api.approve_charter('proj_charter', 'eng_c3', 1)$$,
  '42501', 'El autor no puede aprobar su propio charter',
  'Un revisor autor de su encargo tampoco aprueba el suyo');

-- ───────────────────────────────────────────── el camino de la aplicación
set local request.jwt.claims = '{"sub":"68000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"78000000-0000-4000-8000-000000000002"}';
select ok((api.load_charter_engagements()) @> '[{"data":{"id":"eng_c1"}}]'::jsonb,
  'La bandeja del aprobador incluye el encargo ajeno que espera charter');
select throws_ok($$select api.approve_charter('proj_charter', 'eng_c1', 5)$$,
  'P0001', 'Conflicto de encargo: recarga antes de guardar',
  'Una revisión vieja no aprueba');
select is((api.approve_charter('proj_charter', 'eng_c1', 1)).revision,
  2::bigint, 'Otra persona con charter:approve firma y el encargo pasa a in-progress');
reset role;
select is((select data -> 'charter' -> 'approvedBy' ->> 'id' from api.office_engagements where id = 'eng_c1'),
  '68000000-0000-4000-8000-000000000002', 'La firma es de la sesión que aprueba, puesta por el servidor');
select is((select data ->> 'status' from api.office_engagements where id = 'eng_c1'), 'in-progress',
  'El estado lo mueve la misma transacción');
select is((select data -> 'auditTrail' -> 0 ->> 'action' from api.office_engagements where id = 'eng_c1'), 'charter-approved',
  'Con su entrada de auditoría');
set local role authenticated;
select is((api.approve_charter('proj_charter', 'eng_c1', 1)).revision,
  2::bigint, 'Un reintento de red de la misma sesión devuelve lo guardado');

-- ───────────────────────────────────────────── regla 2: lo aprobado se queda aprobado
set local request.jwt.claims = '{"sub":"68000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"78000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.save_engagement('proj_charter', pg_temp.engagement('eng_c1', 'in-progress', null, null), 2)$$,
  '22023', 'La aprobación del charter no se puede retirar ni reescribir',
  'Una aprobación no se retira');
select throws_ok($$select api.save_engagement('proj_charter',
    pg_temp.engagement('eng_c1', 'in-progress', '2026-09-26T05:00:00.000Z', '68000000-0000-4000-8000-000000000001'), 2)$$,
  '22023', 'La aprobación del charter no se puede retirar ni reescribir',
  'Ni se reescribe');

-- ───────────────────────────────────────────── un encargo ajeno no revela su aprobación
set local request.jwt.claims = '{"sub":"68000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"78000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.save_engagement('proj_charter', pg_temp.engagement('eng_c1', 'awaiting-arb', null, null), 2)$$,
  'P0002', 'El encargo no existe o es ajeno',
  'Sobre un encargo ajeno responde «ajeno», nunca «la aprobación no se puede retirar»');
select throws_ok($$select api.approve_charter('proj_charter', 'eng_c1', 2)$$,
  '22023', 'El charter ya está aprobado',
  'Un charter aprobado por otra sesión no se vuelve a aprobar');

-- ───────────────────────────────────────────── compatibilidad: una aprobación antigua sin firmante
reset role;
insert into api.office_engagements (id, project_id, owner_id, data, revision)
values ('eng_legacy', 'proj_charter', '68000000-0000-4000-8000-000000000001',
  pg_temp.engagement('eng_legacy', 'in-progress', '2026-09-01T00:00:00.000Z', null), 1);
set local role authenticated;
set local request.jwt.claims = '{"sub":"68000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"78000000-0000-4000-8000-000000000001"}';
select is((api.save_engagement('proj_charter',
    pg_temp.engagement('eng_legacy', 'in-progress', '2026-09-01T00:00:00.000Z', null), 1)).revision,
  2::bigint, 'Un encargo guardado con una aprobación antigua sin firmante se sigue guardando');

-- ───────────────────────────────────────────── 14.7 · pedir cambios al charter
reset role;
insert into api.office_engagements (id, project_id, owner_id, data, revision)
values ('eng_c7', 'proj_charter', '68000000-0000-4000-8000-000000000001',
  pg_temp.engagement('eng_c7', 'awaiting-charter', null, null), 1);
set local role authenticated;
set local request.jwt.claims = '{"sub":"68000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"78000000-0000-4000-8000-000000000001"}';
select throws_ok($$select api.request_charter_changes('proj_charter', 'eng_c7', 1, 'Falta alcance')$$,
  '42501', 'Permiso insuficiente: charter:approve',
  'Un arquitecto no pide cambios a charters');
set local request.jwt.claims = '{"sub":"68000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"78000000-0000-4000-8000-000000000003"}';
select throws_ok($$select api.request_charter_changes('proj_charter', 'eng_c3', 1, 'Falta alcance')$$,
  '42501', 'El autor no puede pedir cambios a su propio charter',
  'El autor no se pide cambios a sí mismo');
set local request.jwt.claims = '{"sub":"68000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"78000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.request_charter_changes('proj_charter', 'eng_c7', 1, '   ')$$,
  '22023', 'Pedir cambios exige explicar qué hay que cambiar',
  'Sin razón no se piden cambios');
select throws_ok($$select api.request_charter_changes('proj_charter', 'eng_c7', 9, 'Falta alcance')$$,
  'P0001', 'Conflicto de encargo: recarga antes de guardar',
  'Una revisión vieja no pide cambios');
select is((api.request_charter_changes('proj_charter', 'eng_c7', 1, 'Falta alcance')).revision,
  2::bigint, 'Otra persona con charter:approve devuelve el charter con su razón');
reset role;
select is((select data ->> 'status' from api.office_engagements where id = 'eng_c7'),
  'awaiting-charter', 'El estado no cambia');
select is((select data -> 'auditTrail' -> 0 ->> 'action' from api.office_engagements where id = 'eng_c7'),
  'charter-changes-requested', 'El rastro lo registra');
select is((select data -> 'auditTrail' -> 0 -> 'actor' ->> 'id' from api.office_engagements where id = 'eng_c7'),
  '68000000-0000-4000-8000-000000000002', 'Firmado por la sesión, no por el cliente');

select * from finish();
rollback;
