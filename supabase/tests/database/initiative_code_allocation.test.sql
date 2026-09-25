-- F6-04 · El servidor asigna el código de una iniciativa nueva.
--
-- El código `NEG-AAAA-NNN` es único en toda la base, pero el cliente lo
-- calculaba a partir de *sus* iniciativas. Un segundo usuario calculaba siempre
-- el 001, chocaba con el del primero y no podía crear ninguna; dos altas
-- simultáneas del mismo usuario chocaban igual. Lo encontró el recorrido E2E de
-- F6-04. Aquí: el código libre se respeta, el ocupado se reasigna (también entre
-- usuarios), el documento guardado lleva el asignado, y una actualización no
-- reasigna nada.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

insert into auth.users (id, email) values
  ('66000000-0000-4000-8000-000000000001', 'code-first@example.invalid'),
  ('66000000-0000-4000-8000-000000000002', 'code-second@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('66000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('66000000-0000-4000-8000-000000000002', 'architect', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('76000000-0000-4000-8000-000000000001', '66000000-0000-4000-8000-000000000001', null),
  ('76000000-0000-4000-8000-000000000002', '66000000-0000-4000-8000-000000000002', null)
on conflict (id) do nothing;

create function pg_temp.initiative(p_id text, p_code text, p_user text, p_title text default 'Necesidad')
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'schemaVersion', 1, 'code', p_code,
    'title', p_title, 'need', 'Una necesidad del negocio', 'driver', '',
    'objectives', '[]'::jsonb, 'expectedOutcomes', '[]'::jsonb, 'affectedCapabilities', '[]'::jsonb,
    'businessUnits', '[]'::jsonb, 'status', 'draft', 'priority', 'medium', 'horizon', 'next',
    'riskLevel', 'medium', 'risks', '[]'::jsonb, 'regulatoryDrivers', '[]'::jsonb, 'kpis', '[]'::jsonb,
    'milestones', '[]'::jsonb, 'stakeholders', '[]'::jsonb, 'documents', '[]'::jsonb,
    'dependsOnCodes', '[]'::jsonb, 'notes', '[]'::jsonb, 'provenance', 'manual',
    'userId', p_user, 'createdAt', '2026-09-25T00:00:00.000Z', 'updatedAt', '2026-09-25T00:00:00.000Z'
  );
$$;

set local role authenticated;

-- ───────────────────────────────────────────── el código libre se respeta
set local request.jwt.claims = '{"sub":"66000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000001"}';
select is((api.save_business_initiative(
  pg_temp.initiative('init_code_a1', 'NEG-2031-001', '66000000-0000-4000-8000-000000000001'), 0)).code,
  'NEG-2031-001', 'Un código libre se guarda tal cual');

-- ───────────────────────────────────────────── entre usuarios: el caso que bloqueaba
set local request.jwt.claims = '{"sub":"66000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000002"}';
select is(jsonb_array_length(to_jsonb(array(select id from api.list_business_initiatives()))), 0,
  'El segundo usuario no ve las iniciativas del primero, así que calcula el 001');
select is((api.save_business_initiative(
  pg_temp.initiative('init_code_b1', 'NEG-2031-001', '66000000-0000-4000-8000-000000000002'), 0)).code,
  'NEG-2031-002', 'Su 001 ocupado se reasigna al siguiente libre del año, en vez de fallar');
select is((select data ->> 'code' from api.list_business_initiatives() where id = 'init_code_b1'),
  'NEG-2031-002', 'El documento guardado lleva el código asignado, que es el que adopta el cliente');

-- ───────────────────────────────────────────── el mismo usuario, dos altas con el mismo código
set local request.jwt.claims = '{"sub":"66000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000001"}';
select is((api.save_business_initiative(
  pg_temp.initiative('init_code_a2', 'NEG-2031-002', '66000000-0000-4000-8000-000000000001'), 0)).code,
  'NEG-2031-003', 'Dos altas simultáneas con el mismo código ya no chocan');

-- ───────────────────────────────────────────── una actualización no reasigna
select is((api.save_business_initiative(
  pg_temp.initiative('init_code_a1', 'NEG-2031-001', '66000000-0000-4000-8000-000000000001', 'Necesidad editada'), 1)).code,
  'NEG-2031-001', 'Actualizar una iniciativa existente conserva su código');
select throws_ok($$select api.save_business_initiative(
  pg_temp.initiative('init_code_a1', 'NEG-2031-003', '66000000-0000-4000-8000-000000000001'), 2)$$,
  '23505', null,
  'Una actualización no puede tomar el código de otra: eso sigue siendo un error, no una reasignación');

-- ───────────────────────────────────────────── otro año, su propia secuencia
select is((api.save_business_initiative(
  pg_temp.initiative('init_code_a3', 'NEG-2032-001', '66000000-0000-4000-8000-000000000001'), 0)).code,
  'NEG-2032-001', 'Cada año lleva su propia secuencia');

select * from finish();
rollback;
