-- Contratos del registro de mensajes del chat (14.3 · R-03).
--
-- Un registro por mensaje: añadir es idempotente por id, así que dos pestañas
-- que escriben sobre el mismo proyecto no se pisan. Sólo `replace_chat_history`
-- sustituye la lista. Cada guarda lleva su caso negativo.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
grant usage on schema extensions to anon, authenticated;
grant usage on schema api to authenticated;
grant execute on all functions in schema extensions to anon, authenticated;
select no_plan();

select ok(not has_table_privilege('authenticated', 'api.project_chat_messages', 'SELECT'),
  'La tabla de mensajes no se lee directamente');
select ok(not has_table_privilege('authenticated', 'api.project_chat_messages', 'INSERT'),
  'La tabla de mensajes no se escribe directamente');
select ok(has_function_privilege('authenticated', 'api.append_chat_messages(text,jsonb)', 'EXECUTE'),
  'El cliente puede añadir mensajes');
select ok(to_regprocedure('api.save_chat_history(text,jsonb)') is null,
  'La reescritura de la lista entera está retirada');

insert into auth.users (id, email) values
  ('66000000-0000-4000-8000-000000000001', 'chat-owner@example.invalid'),
  ('66000000-0000-4000-8000-000000000002', 'chat-other@example.invalid'),
  ('66000000-0000-4000-8000-000000000003', 'chat-viewer@example.invalid')
on conflict (id) do nothing;
insert into api.user_profiles (id, role, status) values
  ('66000000-0000-4000-8000-000000000001', 'architect', 'active'),
  ('66000000-0000-4000-8000-000000000002', 'architect', 'active'),
  ('66000000-0000-4000-8000-000000000003', 'viewer', 'active')
on conflict (id) do nothing;
insert into auth.sessions (id, user_id, not_after) values
  ('76000000-0000-4000-8000-000000000001', '66000000-0000-4000-8000-000000000001', null),
  ('76000000-0000-4000-8000-000000000002', '66000000-0000-4000-8000-000000000002', null),
  ('76000000-0000-4000-8000-000000000003', '66000000-0000-4000-8000-000000000003', null)
on conflict (id) do nothing;
insert into api.architecture_projects (id, owner_id, name, initiative_ids, data)
values ('proj_chat_001', '66000000-0000-4000-8000-000000000001', 'Proyecto de chat',
  array['init_chat_001'],
  '{"id":"proj_chat_001","userId":"66000000-0000-4000-8000-000000000001","name":"Proyecto de chat"}'::jsonb);

set local role authenticated;
set local request.jwt.claims = '{"sub":"66000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000001"}';

select is(api.append_chat_messages('proj_chat_001',
  '[{"id":"m1","role":"user","content":"uno"},{"id":"m2","role":"model","content":"dos"}]'::jsonb),
  2, 'Se añaden dos mensajes');
select is(api.append_chat_messages('proj_chat_001',
  '[{"id":"m2","role":"model","content":"dos"},{"id":"m3","role":"user","content":"tres"}]'::jsonb),
  1, 'Reenviar un mensaje ya guardado no lo duplica: sólo entra el nuevo');
select is((select jsonb_agg(e ->> 'id') from jsonb_array_elements(api.load_chat_history('proj_chat_001')) e),
  '["m1","m2","m3"]'::jsonb, 'La carga devuelve los mensajes en orden de llegada, sin pérdidas');

select throws_ok($$select api.append_chat_messages('proj_chat_001', '[{"role":"user","content":"sin id"}]'::jsonb)$$,
  '22023', 'Cada mensaje requiere un id', 'Un mensaje sin id se rechaza');
select throws_ok($$select api.append_chat_messages('proj_chat_001', '[{"id":"m9","apiKey":"sk-secreto"}]'::jsonb)$$,
  '22023', 'El historial no puede contener apiKey', 'Una clave de proveedor no cruza la frontera');

select is(api.replace_chat_history('proj_chat_001', '[{"id":"n1","role":"user","content":"nuevo"}]'::jsonb),
  1, 'replace sustituye la lista entera');
select is((select jsonb_agg(e ->> 'id') from jsonb_array_elements(api.load_chat_history('proj_chat_001')) e),
  '["n1"]'::jsonb, 'Tras replace sólo queda lo nuevo');

-- Otra persona no escribe en el chat ajeno ni lo lee.
set local request.jwt.claims = '{"sub":"66000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000002"}';
select throws_ok($$select api.append_chat_messages('proj_chat_001', '[{"id":"x1","content":"intruso"}]'::jsonb)$$,
  '42501', null, 'Quien no es dueño del proyecto no añade mensajes');
select is(api.load_chat_history('proj_chat_001'), '[]'::jsonb, 'Quien no es dueño no lee el chat');

-- Un lector no escribe.
set local request.jwt.claims = '{"sub":"66000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"76000000-0000-4000-8000-000000000003"}';
select throws_ok($$select api.append_chat_messages('proj_chat_001', '[{"id":"v1","content":"lector"}]'::jsonb)$$,
  '42501', 'Permiso insuficiente: project:write', 'Un lector no añade mensajes');

select * from finish();
rollback;
