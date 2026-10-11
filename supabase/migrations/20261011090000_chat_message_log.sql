-- 14.3 · R-03 / T-06: el historial de chat es un registro por mensaje.
--
-- `save_chat_history` reescribía la lista entera de un proyecto en cada
-- guardado, sin revisión: con dos pestañas en el mismo proyecto la última que
-- guardaba borraba los mensajes de la otra, sin aviso. Decisión del propietario
-- (R-03): un registro por mensaje.
--
--   * `api.project_chat_messages` — una fila por (proyecto, id de mensaje).
--   * `api.append_chat_messages` — alta idempotente por id: reintentar o
--     escribir desde dos pestañas nunca pierde ni duplica un mensaje.
--   * `api.replace_chat_history` — la operación explícita y destructiva (borrar o
--     compactar desde el Centro de Memoria). Es lo único que sustituye la lista.
--   * `api.load_chat_history` — lee los mensajes en orden de llegada, con su id.
--   * `api.save_chat_history` — se retira.
--
-- Los datos de `api.project_chat_history` se copian aquí; la tabla antigua se
-- conserva sin uso (solo lectura histórica) para que la reversión no pierda nada.
--
-- Reversión: recrear `api.save_chat_history` y `api.load_chat_history` con la
-- definición de `20260919043543_retirement_completeness.sql`; las filas de la
-- tabla antigua siguen siendo las anteriores a esta migración.
begin;

create table api.project_chat_messages (
  seq bigint generated always as identity,
  project_id text not null references api.architecture_projects(id) on delete cascade,
  message_id text not null check (btrim(message_id) <> ''),
  owner_id uuid not null references auth.users(id) on delete restrict,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  primary key (project_id, message_id)
);
create unique index project_chat_messages_seq_idx on api.project_chat_messages (seq);
comment on table api.project_chat_messages is
  'Un registro por mensaje del chat de un proyecto. Se añade de forma idempotente por id; solo replace_chat_history lo sustituye.';
alter table api.project_chat_messages enable row level security;
revoke all on table api.project_chat_messages from public, anon, authenticated, service_role;

-- Copia de lo que ya existía. Los mensajes antiguos sin id reciben uno estable
-- derivado de su contenido, y la carga lo devuelve dentro del mensaje.
insert into api.project_chat_messages (project_id, message_id, owner_id, data)
select h.project_id,
       coalesce(nullif(btrim(m.value ->> 'id'), ''),
                'legacy-' || md5(coalesce(m.value ->> 'role', '') || '|' ||
                                 coalesce(m.value ->> 'timestamp', '') || '|' ||
                                 coalesce(m.value ->> 'content', ''))),
       h.owner_id,
       m.value
from api.project_chat_history h
cross join lateral jsonb_array_elements(h.messages) with ordinality as m(value, ord)
where jsonb_typeof(m.value) = 'object'
order by h.project_id, m.ord
on conflict (project_id, message_id) do nothing;

drop function api.save_chat_history(text, jsonb);

create or replace function api.load_chat_history(p_project_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  stored jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select coalesce(jsonb_agg(m.data || jsonb_build_object('id', m.message_id) order by m.seq), '[]'::jsonb)
  into stored
  from api.project_chat_messages m
  where m.project_id = p_project_id and m.owner_id = actor;
  return stored;
end;
$$;

create function private.assert_chat_write(p_project_id text, p_messages jsonb)
returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('project:write') then
    raise exception 'Permiso insuficiente: project:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_messages) is distinct from 'array' then
    raise exception 'El historial debe ser una lista' using errcode = '22023';
  end if;
  -- Ninguna clave de proveedor cruza esta frontera: el historial es texto del
  -- usuario y del modelo, y una clave pegada en el chat quedaría almacenada.
  if jsonb_path_exists(p_messages, '$.**.apiKey') then
    raise exception 'El historial no puede contener apiKey' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_messages) e
    where jsonb_typeof(e) <> 'object' or nullif(btrim(coalesce(e ->> 'id', '')), '') is null
  ) then
    raise exception 'Cada mensaje requiere un id' using errcode = '22023';
  end if;
  if not exists (
    select 1 from api.architecture_projects
    where id = p_project_id and owner_id = actor
  ) then
    raise exception 'El proyecto no existe o no pertenece a la sesión actual' using errcode = '42501';
  end if;
  return actor;
end;
$$;
revoke all on function private.assert_chat_write(text, jsonb) from public, anon, authenticated, service_role;

create function api.append_chat_messages(p_project_id text, p_messages jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.assert_chat_write(p_project_id, p_messages);
  added integer;
begin
  insert into api.project_chat_messages (project_id, message_id, owner_id, data)
  select p_project_id, btrim(e.value ->> 'id'), actor, e.value
  from jsonb_array_elements(p_messages) with ordinality as e(value, ord)
  order by e.ord
  on conflict (project_id, message_id) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;
comment on function api.append_chat_messages(text, jsonb) is
  'Añade mensajes al chat de un proyecto propio; uno con un id ya guardado se ignora, así que reintentar o escribir desde dos pestañas no pierde ni duplica.';

create function api.replace_chat_history(p_project_id text, p_messages jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.assert_chat_write(p_project_id, p_messages);
  added integer;
begin
  delete from api.project_chat_messages
  where project_id = p_project_id and owner_id = actor;
  insert into api.project_chat_messages (project_id, message_id, owner_id, data)
  select p_project_id, btrim(e.value ->> 'id'), actor, e.value
  from jsonb_array_elements(p_messages) with ordinality as e(value, ord)
  order by e.ord
  on conflict (project_id, message_id) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;
comment on function api.replace_chat_history(text, jsonb) is
  'Sustituye el chat de un proyecto propio por la lista dada: borrar o compactar desde el Centro de Memoria. Es la única operación que quita mensajes.';

revoke all on function api.load_chat_history(text) from public, anon, authenticated, service_role;
revoke all on function api.append_chat_messages(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function api.replace_chat_history(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function api.load_chat_history(text) to authenticated;
grant execute on function api.append_chat_messages(text, jsonb) to authenticated;
grant execute on function api.replace_chat_history(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
