-- E-01 (R-04) y R-13 — contrato de 20260927090000_engagement_initiative_guard.
--
-- Cada regla con su caso negativo: un encargo nace vinculado a una iniciativa
-- (por id o por código), no se queda sin ella, un encargo ajeno no revela nada,
-- un encargo antiguo sin vínculo se sigue pudiendo guardar, y la RPC de
-- decisión antigua ya no existe.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

-- ───────────────────────────────────────────── superficie
select ok(not has_function_privilege('authenticated', 'private.assert_engagement_initiative_link(jsonb,jsonb)', 'EXECUTE'),
  'La regla no es invocable por el cliente: sólo desde save_engagement');
select ok(not has_function_privilege('authenticated', 'private.engagement_initiative_link_count(jsonb)', 'EXECUTE'),
  'El recuento tampoco');
select hasnt_function('api', 'record_arb_decision', array['jsonb'],
  'R-13: la RPC de decisión en dos pasos ya no existe; api.decide_engagement es la única puerta');

insert into auth.users (id, email) values
  ('6a000000-0000-4000-8000-000000000001', 'link-owner@example.invalid'),
  ('6a000000-0000-4000-8000-000000000002', 'link-other@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('6a000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('6a000000-0000-4000-8000-000000000002', 'architect', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('7a000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000001', null),
  ('7a000000-0000-4000-8000-000000000002', '6a000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;

-- Un encargo con los vínculos que se pidan.
create function pg_temp.engagement(p_id text, p_initiative_ids jsonb, p_codes jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'projectId', 'proj_link', 'schemaVersion', 1,
    'title', 'Encargo vinculado', 'brief', 'Probar el vínculo con la iniciativa en el servidor.',
    'initiativeIds', p_initiative_ids, 'businessProjectIds', p_codes,
    'status', 'awaiting-charter', 'priority', 'medium',
    'charter', jsonb_build_object('kind', 'new-solution', 'objectives', '[]'::jsonb),
    'tasks', '[]'::jsonb, 'arbDecisions', '[]'::jsonb,
    'budget', jsonb_build_object('maxAiCalls', 10, 'consumedAiCalls', 0),
    'auditTrail', '[]'::jsonb,
    'createdAt', '2026-09-27T00:00:00.000Z', 'updatedAt', '2026-09-27T00:00:00.000Z');
$$;
grant execute on function pg_temp.engagement(text, jsonb, jsonb) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"6a000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"7a000000-0000-4000-8000-000000000001"}';

select is((api.save_business_initiative($json${
  "id":"init_link", "schemaVersion":1, "code":"NEG-2035-001",
  "title":"Necesidad", "need":"Probar el vínculo del encargo", "driver":"",
  "objectives":[], "expectedOutcomes":[], "affectedCapabilities":[], "businessUnits":[],
  "status":"draft", "priority":"medium", "horizon":"next", "riskLevel":"medium",
  "risks":[], "regulatoryDrivers":[], "kpis":[], "milestones":[], "stakeholders":[],
  "documents":[], "dependsOnCodes":[], "notes":[], "provenance":"manual",
  "userId":"6a000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-27T00:00:00.000Z", "updatedAt":"2026-09-27T00:00:00.000Z"
}$json$::jsonb, 0)).revision, 1::bigint, 'Existe la iniciativa');
select is((api.save_project(
  '{"id":"proj_link","name":"Atención con encargos","initiativeIds":["init_link"],"userId":"6a000000-0000-4000-8000-000000000001"}'::jsonb,
  0)).revision, 1::bigint, 'Existe el proyecto');

-- ───────────────────────────────────────────── regla 1: nace vinculado
select throws_ok($$select api.save_engagement('proj_link', pg_temp.engagement('eng_l0', '[]'::jsonb, '[]'::jsonb), 0)$$,
  '22023', 'Un encargo nace vinculado a una iniciativa',
  'Sin ids ni códigos, el encargo no se crea');
select throws_ok($$select api.save_engagement('proj_link', pg_temp.engagement('eng_l0', null, null), 0)$$,
  '22023', 'Un encargo nace vinculado a una iniciativa',
  'Sin los campos, tampoco');
select throws_ok($$select api.save_engagement('proj_link', pg_temp.engagement('eng_l0', '["  "]'::jsonb, '["NEG-26-1", 7]'::jsonb), 0)$$,
  '22023', 'Un encargo nace vinculado a una iniciativa',
  'Un id en blanco, un código mal formado o un número no son un vínculo');

select is((api.save_engagement('proj_link', pg_temp.engagement('eng_l1', '["init_link"]'::jsonb, '[]'::jsonb), 0)).revision,
  1::bigint, 'Con el id de la iniciativa, el encargo nace');
select is((api.save_engagement('proj_link', pg_temp.engagement('eng_l2', '[]'::jsonb, '["neg-2035-001"]'::jsonb), 0)).revision,
  1::bigint, 'Con sólo el código —como un proyecto de una versión antigua—, también: se normaliza antes de validar');

-- ───────────────────────────────────────────── regla 2: no se queda sin iniciativa
select throws_ok($$select api.save_engagement('proj_link', pg_temp.engagement('eng_l1', '[]'::jsonb, '[]'::jsonb), 1)$$,
  '22023', 'Un encargo no puede quedarse sin iniciativa',
  'Quitar el último vínculo se rechaza');
select is((api.save_engagement('proj_link', pg_temp.engagement('eng_l1', '[]'::jsonb, '["NEG-2035-001"]'::jsonb), 1)).revision,
  2::bigint, 'Cambiar el id por el código conserva el vínculo');

-- ───────────────────────────────────────────── un encargo ajeno no revela nada
set local request.jwt.claims = '{"sub":"6a000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"7a000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.save_engagement('proj_link', pg_temp.engagement('eng_l1', '[]'::jsonb, '[]'::jsonb), 2)$$,
  'P0002', 'El encargo no existe o es ajeno',
  'Sobre un encargo ajeno responde «ajeno», nunca «no puede quedarse sin iniciativa»');

-- ───────────────────────────────────────────── compatibilidad: un encargo antiguo sin vínculo
reset role;
insert into api.office_engagements (id, project_id, owner_id, data, revision)
values ('eng_legacy_link', 'proj_link', '6a000000-0000-4000-8000-000000000001',
  pg_temp.engagement('eng_legacy_link', '[]'::jsonb, '[]'::jsonb), 1);
set local role authenticated;
set local request.jwt.claims = '{"sub":"6a000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"7a000000-0000-4000-8000-000000000001"}';
select is((api.save_engagement('proj_link', pg_temp.engagement('eng_legacy_link', '[]'::jsonb, '[]'::jsonb), 1)).revision,
  2::bigint, 'Un encargo guardado antes de la regla sin vínculo se sigue pudiendo guardar');

select * from finish();
rollback;
