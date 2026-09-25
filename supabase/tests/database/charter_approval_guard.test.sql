-- F6-08 · E-02 / H06: nadie ejecuta un charter sin aprobar — en el servidor.
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
  ('68000000-0000-4000-8000-000000000002', 'charter-other@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('68000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('68000000-0000-4000-8000-000000000002', 'architect', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('78000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000001', null),
  ('78000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000002', null)
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
      'deliverables', '[]'::jsonb, 'participantIds', '[]'::jsonb,
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

-- ───────────────────────────────────────────── regla 3: la firma es de la sesión
select throws_ok($$select api.save_engagement('proj_charter',
    pg_temp.engagement('eng_c1', 'in-progress', '2026-09-26T01:00:00.000Z', '68000000-0000-4000-8000-000000000002'), 1)$$,
  '42501', 'El charter lo aprueba la sesión que lo firma',
  'Nadie aprueba en nombre de otro');
select throws_ok($$select api.save_engagement('proj_charter',
    pg_temp.engagement('eng_c1', 'in-progress', 'mañana', '68000000-0000-4000-8000-000000000001'), 1)$$,
  '22023', 'La fecha de aprobación del charter no es válida',
  'Una fecha de aprobación que no es una fecha se rechaza');

-- ───────────────────────────────────────────── el camino de la aplicación
select is((api.save_engagement('proj_charter',
    pg_temp.engagement('eng_c1', 'in-progress', '2026-09-26T01:00:00.000Z', '68000000-0000-4000-8000-000000000001'), 1)).revision,
  2::bigint, 'Aprobar, firmado por la sesión, y pasar a in-progress en una sola escritura');

-- ───────────────────────────────────────────── regla 2: lo aprobado se queda aprobado
select throws_ok($$select api.save_engagement('proj_charter', pg_temp.engagement('eng_c1', 'in-progress', null, null), 2)$$,
  '22023', 'La aprobación del charter no se puede retirar ni reescribir',
  'Una aprobación no se retira');
select throws_ok($$select api.save_engagement('proj_charter',
    pg_temp.engagement('eng_c1', 'in-progress', '2026-09-26T05:00:00.000Z', '68000000-0000-4000-8000-000000000001'), 2)$$,
  '22023', 'La aprobación del charter no se puede retirar ni reescribir',
  'Ni se reescribe su fecha');
select is((api.save_engagement('proj_charter',
    pg_temp.engagement('eng_c1', 'awaiting-arb', '2026-09-26T01:00:00.000Z', '68000000-0000-4000-8000-000000000001'), 2)).revision,
  3::bigint, 'Conservándola, el encargo sigue su curso');

-- ───────────────────────────────────────────── un encargo ajeno no revela su aprobación
set local request.jwt.claims = '{"sub":"68000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"78000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.save_engagement('proj_charter', pg_temp.engagement('eng_c1', 'awaiting-arb', null, null), 3)$$,
  'P0002', 'El encargo no existe o es ajeno',
  'Sobre un encargo ajeno responde «ajeno», nunca «la aprobación no se puede retirar»');

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

select * from finish();
rollback;
