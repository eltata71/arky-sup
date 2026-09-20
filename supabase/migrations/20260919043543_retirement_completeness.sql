-- F9.1 — Lo que faltaba para que Firebase pueda retirarse.
--
-- Hasta aquí el esquema cubría los cortes verticales que F5 migró uno a uno.
-- Retirar Firestore exige algo más estricto: **ningún** dato del producto puede
-- quedar sin casa en PostgreSQL, porque el que quede se pierde el día que se
-- borre el proyecto de Firebase. Esta migración cierra los seis huecos que un
-- inventario de `collectionPaths.ts` contra `api.*` deja ver:
--
--   1. listar los proyectos propios (existía `load_project_aggregate(id)`, que
--      sirve para abrir uno y no para pintar el portafolio),
--   2. el historial de chat por proyecto,
--   3. el registro de acciones del agente,
--   4. la ficha configurada de cada agente por usuario,
--   5. los hilos de comentarios y el rastro inmutable de decisiones de revisión,
--   6. el directorio de usuarios que necesita la pantalla de administración.
--
-- Todas siguen la postura ya establecida: RLS activo y deny-by-default,
-- privilegios revocados sobre la tabla, acceso exclusivamente por RPC
-- `security definer` que comprueba permiso y sesión viva.
begin;

-- ─────────────────────────────────────────────── 1. listado de portafolio
-- El portafolio no necesita los cuerpos de los artefactos: le basta el índice
-- que la raíz ya mantiene. Devolverlos aquí convertiría la carga de la pantalla
-- de inicio en la descarga de la cuenta entera, que es exactamente lo que el
-- camino de Firestore evitaba leyendo `artifactIndex`.
create function api.list_project_aggregates()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();

  select coalesce(jsonb_agg(
    project.data || jsonb_build_object(
      'artifacts', '[]'::jsonb,
      'artifactIndex', project.artifact_index,
      'artifactCount', project.artifact_count,
      'updatedAt', project.updated_at
    )
    order by project.updated_at desc
  ), '[]'::jsonb)
  into result
  from api.architecture_projects project
  where project.owner_id = actor;

  return result;
end;
$$;
comment on function api.list_project_aggregates() is
  'Proyectos propios con su índice de artefactos, sin los cuerpos: lo que el portafolio necesita.';

-- ────────────────────────────────────────────────── 2. historial de chat
create table api.project_chat_history (
  project_id text primary key references api.architecture_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table api.project_chat_history is
  'Un documento por proyecto. Se reescribe entero: la compactación ocurre antes de escribir.';
alter table api.project_chat_history enable row level security;

create function api.load_chat_history(p_project_id text)
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
  select messages into stored
  from api.project_chat_history
  where project_id = p_project_id and owner_id = actor;
  return coalesce(stored, '[]'::jsonb);
end;
$$;

create function api.save_chat_history(p_project_id text, p_messages jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
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
  if not exists (
    select 1 from api.architecture_projects
    where id = p_project_id and owner_id = actor
  ) then
    raise exception 'El proyecto no existe o no pertenece a la sesión actual' using errcode = '42501';
  end if;

  insert into api.project_chat_history as target (project_id, owner_id, messages)
  values (p_project_id, actor, p_messages)
  on conflict (project_id) do update
    set messages = excluded.messages, updated_at = now()
    where target.owner_id = actor;
  if not found then
    raise exception 'El historial pertenece a otra sesión' using errcode = '42501';
  end if;
end;
$$;

-- ──────────────────────────────────────────── 3. acciones del agente
create table api.agent_actions (
  trace_id text primary key check (btrim(trace_id) <> ''),
  project_id text not null references api.architecture_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now()
);
comment on table api.agent_actions is
  'Registro append-only de lo que hizo el agente. La versión del artefacto sigue siendo la verdad para deshacer.';
create index agent_actions_project_created_idx on api.agent_actions (project_id, created_at desc);
alter table api.agent_actions enable row level security;

create function api.append_agent_action(p_project_id text, p_action jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  trace text := btrim(coalesce(p_action ->> 'traceId', ''));
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('project:write') then
    raise exception 'Permiso insuficiente: project:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_action) is distinct from 'object' or trace = '' then
    raise exception 'La acción del agente requiere traceId' using errcode = '22023';
  end if;
  if not exists (
    select 1 from api.architecture_projects where id = p_project_id and owner_id = actor
  ) then
    raise exception 'El proyecto no existe o no pertenece a la sesión actual' using errcode = '42501';
  end if;

  insert into api.agent_actions as target (trace_id, project_id, owner_id, data)
  values (trace, p_project_id, actor, p_action)
  on conflict (trace_id) do update
    set data = excluded.data
    where target.owner_id = actor and target.project_id = p_project_id;
  if not found then
    raise exception 'El traceId ya pertenece a otro proyecto o sesión' using errcode = '23505';
  end if;
end;
$$;

create function api.list_agent_actions(p_project_id text, p_limit integer default 50)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  capped integer := greatest(1, least(200, coalesce(p_limit, 50)));
  result jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select coalesce(jsonb_agg(data order by created_at desc), '[]'::jsonb) into result
  from (
    select data, created_at from api.agent_actions
    where project_id = p_project_id and owner_id = actor
    order by created_at desc
    limit capped
  ) as page;
  return result;
end;
$$;

-- ─────────────────────────────────────── 4. ficha configurada del agente
create table api.agent_profiles (
  owner_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null check (btrim(agent_id) <> ''),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, agent_id)
);
comment on table api.agent_profiles is
  'Personalización por usuario y por agente. Sólo lo que el usuario cambió: los valores de fábrica no se congelan aquí.';
alter table api.agent_profiles enable row level security;

create function api.list_agent_profiles()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select coalesce(jsonb_agg(data order by agent_id), '[]'::jsonb) into result
  from api.agent_profiles where owner_id = actor;
  return result;
end;
$$;

create function api.save_agent_profile(p_profile jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  agent text := btrim(coalesce(p_profile ->> 'agentId', ''));
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_profile) is distinct from 'object' or agent = '' then
    raise exception 'La ficha de agente requiere agentId' using errcode = '22023';
  end if;
  -- La mitad de gobernanza de la ficha no es configurable desde una pantalla:
  -- quién produce, quién revisa y qué papel de orquestación tiene un agente son
  -- la separación de funciones que justifica una oficina de arquitectura.
  if p_profile ? 'orchestrationRole'
    or p_profile ? 'producesArtifactTypes'
    or p_profile ? 'reviewsArtifactTypes' then
    raise exception 'La ficha no puede alterar la gobernanza del agente' using errcode = '22023';
  end if;
  insert into api.agent_profiles as target (owner_id, agent_id, data)
  values (actor, agent, jsonb_set(p_profile, '{userId}', to_jsonb(actor::text), true))
  on conflict (owner_id, agent_id) do update
    set data = excluded.data, updated_at = now();
end;
$$;

create function api.delete_agent_profile(p_agent_id text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  delete from api.agent_profiles where owner_id = actor and agent_id = p_agent_id;
end;
$$;

-- ──────────────────────────────── 5. revisión: comentarios y decisiones
create table api.artifact_comments (
  id text primary key check (btrim(id) <> ''),
  project_id text not null references api.architecture_projects(id) on delete cascade,
  artifact_id text not null check (btrim(artifact_id) <> ''),
  owner_id uuid not null references auth.users(id) on delete restrict,
  author_id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table api.artifact_comments is
  'Hilos de revisión. El autor escribe el suyo; el propietario del proyecto los lee todos.';
create index artifact_comments_scope_idx on api.artifact_comments (project_id, artifact_id, created_at);
alter table api.artifact_comments enable row level security;

create table api.artifact_review_decisions (
  id text primary key check (btrim(id) <> ''),
  project_id text not null references api.architecture_projects(id) on delete cascade,
  artifact_id text not null check (btrim(artifact_id) <> ''),
  owner_id uuid not null references auth.users(id) on delete restrict,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now()
);
comment on table api.artifact_review_decisions is
  'Rastro inmutable de revisión: se crea y nunca se actualiza ni se borra. Es la contrapartida de allow update:false.';
create index artifact_review_decisions_scope_idx on api.artifact_review_decisions (project_id, artifact_id, created_at);
alter table api.artifact_review_decisions enable row level security;

create function private.assert_owns_project(p_project_id text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from api.architecture_projects
    where id = p_project_id and owner_id = auth.uid()
  ) then
    raise exception 'El proyecto no existe o no pertenece a la sesión actual' using errcode = '42501';
  end if;
end;
$$;

create function api.list_artifact_comments(p_project_id text, p_artifact_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  perform private.assert_owns_project(p_project_id);
  select coalesce(jsonb_agg(data order by created_at), '[]'::jsonb) into result
  from api.artifact_comments
  where project_id = p_project_id and artifact_id = p_artifact_id;
  return result;
end;
$$;

create function api.save_artifact_comment(p_comment jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  comment_id text := btrim(coalesce(p_comment ->> 'id', ''));
  project_key text := btrim(coalesce(p_comment ->> 'projectId', ''));
  artifact_key text := btrim(coalesce(p_comment ->> 'artifactId', ''));
  author_key text := btrim(coalesce(p_comment #>> '{author,id}', ''));
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('artifact:write') then
    raise exception 'Permiso insuficiente: artifact:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_comment) is distinct from 'object'
    or comment_id = '' or project_key = '' or artifact_key = '' or author_key = ''
    or btrim(coalesce(p_comment ->> 'body', '')) = '' then
    raise exception 'El comentario no tiene una forma válida' using errcode = '22023';
  end if;
  perform private.assert_owns_project(project_key);

  insert into api.artifact_comments as target
    (id, project_id, artifact_id, owner_id, author_id, data)
  values (comment_id, project_key, artifact_key, actor, author_key, p_comment)
  on conflict (id) do update
    set data = excluded.data, updated_at = now()
    where target.owner_id = actor and target.author_id = excluded.author_id;
  if not found then
    raise exception 'El comentario pertenece a otra persona' using errcode = '42501';
  end if;
end;
$$;

create function api.delete_artifact_comment(p_comment_id text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  delete from api.artifact_comments where id = p_comment_id and owner_id = actor;
end;
$$;

create function api.list_artifact_review_decisions(p_project_id text, p_artifact_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  perform private.assert_owns_project(p_project_id);
  select coalesce(jsonb_agg(data order by created_at), '[]'::jsonb) into result
  from api.artifact_review_decisions
  where project_id = p_project_id and artifact_id = p_artifact_id;
  return result;
end;
$$;

-- Crea y nunca actualiza. Es la mitad de servidor de la regla que en Firestore
-- se escribía `allow update: if false`: un rastro que se puede reescribir no es
-- un rastro, es una opinión con fecha.
create function api.record_artifact_review_decision(p_decision jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  decision_id text := btrim(coalesce(p_decision ->> 'id', ''));
  project_key text := btrim(coalesce(p_decision ->> 'projectId', ''));
  artifact_key text := btrim(coalesce(p_decision ->> 'artifactId', ''));
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('artifact:write') then
    raise exception 'Permiso insuficiente: artifact:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_decision) is distinct from 'object'
    or decision_id = '' or project_key = '' or artifact_key = '' then
    raise exception 'La decisión de revisión no tiene una forma válida' using errcode = '22023';
  end if;
  perform private.assert_owns_project(project_key);
  insert into api.artifact_review_decisions (id, project_id, artifact_id, owner_id, data)
  values (decision_id, project_key, artifact_key, actor, p_decision)
  on conflict (id) do nothing;
end;
$$;

-- ───────────────────────────────────────────── 6. directorio de usuarios
-- La pantalla de administración leía la colección entera. Aquí la lectura es
-- una RPC con permiso `users:read`, y el correo sale de `auth.users` en vez de
-- duplicarse en el perfil: un correo copiado se queda viejo, y es justo el dato
-- que un administrador mira antes de cambiarle el rol a alguien.
create function api.list_user_profiles()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('users:read') then
    raise exception 'Permiso insuficiente: users:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select coalesce(jsonb_agg(jsonb_build_object(
    'uid', p.id,
    'email', u.email,
    'displayName', p.display_name,
    'role', p.role,
    'status', p.status,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at
  ) order by p.created_at), '[]'::jsonb) into result
  from api.user_profiles p
  join auth.users u on u.id = p.id;
  return result;
end;
$$;

create function api.load_own_profile()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'uid', p.id,
    'email', u.email,
    'displayName', p.display_name,
    'role', p.role,
    'status', p.status,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at
  ) into result
  from api.user_profiles p
  join auth.users u on u.id = p.id
  where p.id = actor and p.status = 'active';
  return result;
end;
$$;
comment on function api.load_own_profile() is
  'Perfil propio con su correo. NULL si no hay perfil o está deshabilitado: falla cerrado, como current_role().';

create function api.update_own_display_name(p_display_name text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  trimmed text := btrim(coalesce(p_display_name, ''));
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if trimmed = '' or char_length(trimmed) > 120 then
    raise exception 'El nombre debe tener entre 1 y 120 caracteres' using errcode = '22023';
  end if;
  update api.user_profiles set display_name = trimmed
  where id = actor and status = 'active';
  if not found then
    raise exception 'No hay perfil activo para esta sesión' using errcode = '42501';
  end if;
end;
$$;

-- ─────────────────────────────────────────────── privilegios explícitos
revoke all on table api.project_chat_history from public, anon, authenticated, service_role;
revoke all on table api.agent_actions from public, anon, authenticated, service_role;
revoke all on table api.agent_profiles from public, anon, authenticated, service_role;
revoke all on table api.artifact_comments from public, anon, authenticated, service_role;
revoke all on table api.artifact_review_decisions from public, anon, authenticated, service_role;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'api.list_project_aggregates()',
    'api.load_chat_history(text)',
    'api.save_chat_history(text, jsonb)',
    'api.append_agent_action(text, jsonb)',
    'api.list_agent_actions(text, integer)',
    'api.list_agent_profiles()',
    'api.save_agent_profile(jsonb)',
    'api.delete_agent_profile(text)',
    'api.list_artifact_comments(text, text)',
    'api.save_artifact_comment(jsonb)',
    'api.delete_artifact_comment(text)',
    'api.list_artifact_review_decisions(text, text)',
    'api.record_artifact_review_decision(jsonb)',
    'api.list_user_profiles()',
    'api.load_own_profile()',
    'api.update_own_display_name(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
