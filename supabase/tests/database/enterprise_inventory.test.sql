begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

select has_table('api', 'enterprise_inventory_items', 'El inventario tiene tabla');
select columns_are('api', 'enterprise_inventory_items',
  array['id', 'owner_id', 'kind', 'name', 'normalized_name', 'lifecycle', 'data', 'revision', 'created_at', 'updated_at'],
  'La tabla conserva cabecera consultable, documento y revisión');
select ok((select relrowsecurity from pg_class where oid = 'api.enterprise_inventory_items'::regclass),
  'El inventario tiene RLS activa');
select ok(not has_table_privilege('anon', 'api.enterprise_inventory_items', 'SELECT'),
  'Anónimo no lee el inventario');
select ok(not has_table_privilege('authenticated', 'api.enterprise_inventory_items', 'SELECT'),
  'Cliente autenticado no obtiene tabla directa');
select ok(not has_table_privilege('authenticated', 'api.enterprise_inventory_items', 'INSERT'),
  'Cliente autenticado no inserta directamente');
select ok(has_function_privilege('authenticated', 'api.list_enterprise_inventory()', 'EXECUTE'),
  'Cliente recibe la RPC de lectura');
select ok(has_function_privilege('authenticated', 'api.save_enterprise_inventory_item(jsonb,bigint)', 'EXECUTE'),
  'Cliente recibe la RPC de guardado');
select ok(has_function_privilege('authenticated', 'api.delete_enterprise_inventory_item(text,bigint)', 'EXECUTE'),
  'Cliente recibe la RPC de borrado');
select ok(not has_function_privilege('anon', 'api.list_enterprise_inventory()', 'EXECUTE'),
  'Anónimo no ejecuta la lectura');

insert into auth.users (id, email) values
  ('62000000-0000-4000-8000-000000000001', 'inventory-owner@example.invalid'),
  ('62000000-0000-4000-8000-000000000002', 'inventory-viewer@example.invalid'),
  ('62000000-0000-4000-8000-000000000003', 'inventory-other@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('62000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('62000000-0000-4000-8000-000000000002', 'viewer', 'active'),
  ('62000000-0000-4000-8000-000000000003', 'architect', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('72000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', null),
  ('72000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000002', null),
  ('72000000-0000-4000-8000-000000000003', '62000000-0000-4000-8000-000000000003', null)
on conflict (id) do nothing;

-- El propietario crea y lee.
set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000001"}';
select is((select (api.save_enterprise_inventory_item($json${
  "id":"inv_core_banking", "schemaVersion":1, "userId":"62000000-0000-4000-8000-000000000001",
  "kind":"application", "name":"Core Bancario", "normalizedName":"core bancario",
  "aliases":["CBS"], "description":"", "lifecycle":"candidate", "projectIds":["p1","p2"],
  "createdAt":"2026-10-09T00:00:00.000Z", "updatedAt":"2026-10-09T00:00:00.000Z"
}$json$::jsonb, 0)).revision), 1::bigint,
  'El primer guardado crea la revisión uno');
select results_eq($$select id from api.list_enterprise_inventory()$$,
  array['inv_core_banking'],
  'La lectura RPC devuelve el elemento del propietario');
select throws_ok($$select api.save_enterprise_inventory_item($json${
  "id":"inv_core_banking", "schemaVersion":1, "userId":"62000000-0000-4000-8000-000000000001",
  "kind":"application", "name":"Core Bancario", "normalizedName":"core bancario",
  "aliases":[], "description":"", "lifecycle":"active", "projectIds":[],
  "createdAt":"2026-10-09T00:00:00.000Z", "updatedAt":"2026-10-09T00:00:00.000Z"
}$json$::jsonb, 0)$$,
  'P0001', 'Conflicto de inventario: recarga antes de guardar',
  'Una revisión obsoleta no pisa el elemento');
select throws_ok($$select api.save_enterprise_inventory_item($json${
  "id":"inv_dup", "schemaVersion":1, "userId":"62000000-0000-4000-8000-000000000001",
  "kind":"application", "name":"CORE bancario", "normalizedName":"core bancario",
  "aliases":[], "description":"", "lifecycle":"candidate", "projectIds":[],
  "createdAt":"2026-10-09T00:00:00.000Z", "updatedAt":"2026-10-09T00:00:00.000Z"
}$json$::jsonb, 0)$$,
  '23505', null,
  'Dos elementos del mismo tipo no comparten nombre normalizado');
select is((select (api.save_enterprise_inventory_item($json${
  "id":"inv_norm", "schemaVersion":1, "userId":"62000000-0000-4000-8000-000000000001",
  "kind":"capability", "name":"Pagos Móviles “Pro”", "normalizedName":"falso",
  "aliases":[], "description":"", "lifecycle":"candidate", "projectIds":[],
  "createdAt":"2026-10-09T00:00:00.000Z", "updatedAt":"2026-10-09T00:00:00.000Z"
}$json$::jsonb, 0)).normalized_name), 'pagos moviles pro',
  'El servidor calcula el nombre normalizado y ignora el que declara el cliente');
select lives_ok($$select api.delete_enterprise_inventory_item('inv_norm', 1)$$,
  'El elemento de prueba de normalización se retira');
select throws_ok($$select * from api.enterprise_inventory_items$$,
  '42501', null,
  'Ni el propietario salta la RPC mediante tabla directa');
reset role;

-- Un observador: sin elementos ajenos y sin escritura.
set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000002"}';
select is((select count(*)::int from api.list_enterprise_inventory()), 0,
  'Otro usuario no lee el inventario ajeno');
select throws_ok($$select api.save_enterprise_inventory_item($json${
  "id":"inv_viewer", "schemaVersion":1, "userId":"62000000-0000-4000-8000-000000000002",
  "kind":"technology", "name":"Kafka", "normalizedName":"kafka",
  "aliases":[], "description":"", "lifecycle":"candidate", "projectIds":[],
  "createdAt":"2026-10-09T00:00:00.000Z", "updatedAt":"2026-10-09T00:00:00.000Z"
}$json$::jsonb, 0)$$,
  '42501', 'Permiso insuficiente: project:write',
  'Un observador no escribe en el inventario');
select throws_ok($$select api.delete_enterprise_inventory_item('inv_core_banking', 1)$$,
  '42501', 'Permiso insuficiente: project:write',
  'Un observador no borra elementos');
reset role;

-- Otro arquitecto: ni ve ni edita lo ajeno.
set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000003"}';
select is((select count(*)::int from api.list_enterprise_inventory()), 0,
  'Otro arquitecto no ve el inventario ajeno');
select throws_ok($$select api.save_enterprise_inventory_item($json${
  "id":"inv_core_banking", "schemaVersion":1, "userId":"62000000-0000-4000-8000-000000000003",
  "kind":"application", "name":"Secuestrado", "normalizedName":"secuestrado",
  "aliases":[], "description":"", "lifecycle":"active", "projectIds":[],
  "createdAt":"2026-10-09T00:00:00.000Z", "updatedAt":"2026-10-09T00:00:00.000Z"
}$json$::jsonb, 1)$$,
  'P0001', null,
  'Otro arquitecto no edita un elemento ajeno aunque conozca su id y revisión');
select throws_ok($$select api.delete_enterprise_inventory_item('inv_core_banking', 1)$$,
  'P0001', null,
  'Otro arquitecto no borra un elemento ajeno');
reset role;

-- El propietario borra con la revisión vigente.
set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000001"}';
select lives_ok($$select api.delete_enterprise_inventory_item('inv_core_banking', 1)$$,
  'El propietario borra usando la revisión vigente');
select is((select count(*)::int from api.list_enterprise_inventory()), 0,
  'El borrado no deja una fila visible');
reset role;

select * from finish();
rollback;
