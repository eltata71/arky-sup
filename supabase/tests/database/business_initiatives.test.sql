begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

select has_table('api', 'business_initiatives', 'Iniciativas tiene tabla expuesta');
select columns_are('api', 'business_initiatives',
  array['id', 'owner_id', 'code', 'title', 'need', 'status', 'priority', 'horizon', 'risk_level', 'data', 'revision', 'created_at', 'updated_at'],
  'La tabla conserva encabezado consultable, agregado completo y revisión');
select ok((select relrowsecurity from pg_class where oid = 'api.business_initiatives'::regclass),
  'Iniciativas tiene RLS activa');
select ok(not has_table_privilege('anon', 'api.business_initiatives', 'SELECT'),
  'Anónimo no lee iniciativas');
select ok(not has_table_privilege('authenticated', 'api.business_initiatives', 'SELECT'),
  'Cliente autenticado no obtiene tabla directa: usa RPC filtrada');
select ok(not has_table_privilege('authenticated', 'api.business_initiatives', 'INSERT'),
  'Cliente autenticado no inserta iniciativas directamente');
select ok(has_function_privilege('authenticated', 'api.list_business_initiatives()', 'EXECUTE'),
  'Cliente recibe la RPC de lectura de iniciativas');
select ok(has_function_privilege('authenticated', 'api.save_business_initiative(jsonb,bigint)', 'EXECUTE'),
  'Cliente recibe la RPC de guardado de iniciativas');
select ok(has_function_privilege('authenticated', 'api.delete_business_initiative(text,bigint)', 'EXECUTE'),
  'Cliente recibe la RPC de borrado de iniciativas');

insert into auth.users (id, email) values
  ('61000000-0000-4000-8000-000000000001', 'initiative-owner@example.invalid'),
  ('61000000-0000-4000-8000-000000000002', 'initiative-other@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('61000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('61000000-0000-4000-8000-000000000002', 'viewer', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('71000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', null),
  ('71000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"71000000-0000-4000-8000-000000000001"}';
select is((select (api.save_business_initiative($json${
  "id":"init_legacy_001", "schemaVersion":1, "code":"NEG-2026-001",
  "title":"Simplificar alta digital", "need":"El alta tarda doce días", "driver":"",
  "objectives":[], "expectedOutcomes":[], "affectedCapabilities":[], "businessUnits":[],
  "status":"draft", "priority":"medium", "horizon":"next", "riskLevel":"medium",
  "risks":[], "regulatoryDrivers":[], "kpis":[], "milestones":[], "stakeholders":[],
  "documents":[], "dependsOnCodes":[], "notes":[], "provenance":"manual",
  "userId":"61000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-12T00:00:00.000Z", "updatedAt":"2026-09-12T00:00:00.000Z"
}$json$::jsonb, 0)).revision), 1::bigint,
  'El primer guardado conserva el id textual y crea revisión uno');
select results_eq($$select id from api.list_business_initiatives()$$,
  array['init_legacy_001'],
  'La lectura RPC devuelve la iniciativa del propietario');
select throws_ok($$select api.save_business_initiative($json${
  "id":"init_legacy_001", "schemaVersion":1, "code":"NEG-2026-001",
  "title":"Simplificar alta digital", "need":"El alta tarda doce días", "driver":"",
  "objectives":[], "expectedOutcomes":[], "affectedCapabilities":[], "businessUnits":[],
  "status":"draft", "priority":"medium", "horizon":"next", "riskLevel":"medium",
  "risks":[], "regulatoryDrivers":[], "kpis":[], "milestones":[], "stakeholders":[],
  "documents":[], "dependsOnCodes":[], "notes":[], "provenance":"manual",
  "userId":"61000000-0000-4000-8000-000000000001",
  "createdAt":"2026-09-12T00:00:00.000Z", "updatedAt":"2026-09-12T00:00:00.000Z"
}$json$::jsonb, 0)$$,
  'P0001', 'Conflicto de iniciativa: recarga antes de guardar',
  'Una revisión obsoleta no pisa la iniciativa');
select throws_ok($$select * from api.business_initiatives$$,
  '42501', null,
  'Ni el propietario salta la RPC mediante tabla directa');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"71000000-0000-4000-8000-000000000002"}';
select is((select count(*)::int from api.list_business_initiatives()), 0,
  'Otro usuario no lee iniciativas ajenas');
select throws_ok($$select api.delete_business_initiative('init_legacy_001', 1)$$,
  '42501', 'Permiso insuficiente: initiative:write',
  'Un observador no borra iniciativas');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"71000000-0000-4000-8000-000000000001"}';
select lives_ok($$select api.delete_business_initiative('init_legacy_001', 1)$$,
  'El propietario borra usando la revisión vigente');
select is((select count(*)::int from api.list_business_initiatives()), 0,
  'El borrado no deja una fila visible');
reset role;

select * from finish();
rollback;
