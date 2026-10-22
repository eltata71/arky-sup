-- Plan de agentes 16.4 — la ficha del agente se valida, se revisa y se registra
-- en el servidor.
--
-- Hasta hoy `save_agent_profile` sólo rechazaba la gobernanza (quién produce,
-- quién revisa, qué papel de orquestación tiene un agente). Los límites que el
-- editor aplica —longitudes, tiers, concurrencia— vivían únicamente en el
-- navegador, que es el sitio que la persona controla; dos pestañas abiertas
-- sobre la misma ficha se pisaban sin aviso; y nada decía quién cambió qué
-- agente ni cuándo.
--
-- 1. `revision` por ficha, con concurrencia optimista (el patrón de
--    `save_user_settings`): el cliente envía la revisión que leyó y el servidor
--    la avanza; una revisión vieja es un conflicto, no una sobrescritura.
-- 2. Validación completa del documento en la RPC: lista blanca de claves y los
--    mismos límites del editor.
-- 3. `api.agent_profile_changes`: bitácora append-only (quién, cuándo, qué
--    campos, contra qué versión del contrato), leída por
--    `list_agent_profile_changes`.
--
-- Aditiva respecto a la aplicación en ejecución: la firma antigua
-- `save_agent_profile(jsonb)` sigue resolviendo porque `p_expected_revision`
-- tiene valor por defecto (0 = crear).
--
-- Reversión (como migración NUEVA, nunca editando ésta; casi nunca hace falta,
-- porque revertir el código basta: es aditiva):
--   1. drop function api.save_agent_profile(jsonb, bigint);
--      y recrear save_agent_profile(jsonb) con la definición de 20260919043543.
--   2. create or replace api.list_agent_profiles() con la definición de
--      20260919043543 (sin `revision`) y delete_agent_profile(text) igual.
--   3. drop function api.list_agent_profile_changes(text, integer);
--      drop table api.agent_profile_changes;
--      drop function private.agent_profile_problem(jsonb);
--      drop function private.agent_profile_changes_immutable();
--   4. alter table api.agent_profiles drop column revision;
begin;

-- ───────────────────────────────────────────────────────────── revisión
alter table api.agent_profiles
  add column revision bigint not null default 1 check (revision > 0);

-- ─────────────────────────────────────────────────────────── bitácora
create table api.agent_profile_changes (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null check (btrim(agent_id) <> ''),
  action text not null check (action in ('save', 'reset')),
  changed_fields text[] not null default '{}',
  revision bigint not null check (revision >= 0),
  contract_version integer,
  changed_at timestamptz not null default now()
);
comment on table api.agent_profile_changes is
  'Bitácora append-only de las fichas de agente: quién, cuándo, qué campos y contra qué versión del contrato. Sólo la escriben save_agent_profile y delete_agent_profile.';
create index agent_profile_changes_owner_idx
  on api.agent_profile_changes (owner_id, agent_id, id desc);
alter table api.agent_profile_changes enable row level security;

create function private.agent_profile_changes_immutable()
returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'La bitácora de fichas de agente es de sólo añadir' using errcode = '42501';
end;
$$;
create trigger agent_profile_changes_no_update
  before update on api.agent_profile_changes
  for each row execute function private.agent_profile_changes_immutable();

-- ─────────────────────────────────────────────────────── validación
-- Devuelve la lista de problemas del documento; vacía si es válido. Aparte de
-- la RPC para poder ejercitarla en pgTAP sin sesión.
create function private.agent_profile_problem(p_profile jsonb)
returns text
language plpgsql immutable set search_path = '' as $$
declare
  allowed constant text[] := array[
    'agentId', 'userId', 'schemaVersion', 'definitionVersion', 'alias', 'role',
    'avatar', 'skills', 'knowledge', 'memory', 'instruction', 'modelTier',
    'maxConcurrentTasks', 'enabled', 'updatedAt', 'revision'
  ];
  extra text;
  list_key text;
  entry jsonb;
begin
  select string_agg(k, ', ' order by k) into extra
  from jsonb_object_keys(p_profile) as k
  where k <> all (allowed);
  if extra is not null then
    return 'La ficha contiene claves no admitidas: ' || extra;
  end if;

  if char_length(btrim(p_profile ->> 'agentId')) > 64 then
    return 'agentId excede 64 caracteres';
  end if;
  if p_profile ? 'alias' then
    if jsonb_typeof(p_profile -> 'alias') <> 'string'
      or char_length(btrim(p_profile ->> 'alias')) not between 1 and 40 then
      return 'El alias debe tener entre 1 y 40 caracteres';
    end if;
  end if;
  if p_profile ? 'role' then
    if jsonb_typeof(p_profile -> 'role') <> 'string'
      or char_length(p_profile ->> 'role') > 120 then
      return 'El rol no puede exceder 120 caracteres';
    end if;
  end if;
  if p_profile ? 'avatar' then
    if jsonb_typeof(p_profile -> 'avatar') <> 'string'
      or char_length(p_profile ->> 'avatar') > 8 then
      return 'El avatar no puede exceder 8 caracteres';
    end if;
  end if;
  if p_profile ? 'instruction' then
    if jsonb_typeof(p_profile -> 'instruction') <> 'string'
      or char_length(p_profile ->> 'instruction') > 1200 then
      return 'La instrucción no puede exceder 1200 caracteres';
    end if;
  end if;
  if p_profile ? 'modelTier' then
    if jsonb_typeof(p_profile -> 'modelTier') <> 'string'
      or (p_profile ->> 'modelTier') not in ('quick', 'default', 'deep') then
      return 'modelTier debe ser quick, default o deep';
    end if;
  end if;
  if p_profile ? 'maxConcurrentTasks' then
    if jsonb_typeof(p_profile -> 'maxConcurrentTasks') <> 'number'
      or (p_profile ->> 'maxConcurrentTasks') !~ '^[1-5]$' then
      return 'maxConcurrentTasks debe ser un entero de 1 a 5';
    end if;
  end if;
  if p_profile ? 'enabled' and jsonb_typeof(p_profile -> 'enabled') <> 'boolean' then
    return 'enabled debe ser booleano';
  end if;
  foreach list_key in array array['skills', 'knowledge', 'memory'] loop
    if p_profile ? list_key then
      if jsonb_typeof(p_profile -> list_key) <> 'array' then
        return list_key || ' debe ser una lista';
      end if;
      if jsonb_array_length(p_profile -> list_key) > 12 then
        return list_key || ' admite como máximo 12 entradas';
      end if;
      for entry in select value from jsonb_array_elements(p_profile -> list_key) loop
        if jsonb_typeof(entry) <> 'string' or char_length(entry #>> '{}') > 280 then
          return list_key || ': cada entrada es texto de hasta 280 caracteres';
        end if;
      end loop;
    end if;
  end loop;
  return null;
end;
$$;

-- ────────────────────────────────────────────────────── lectura (con revisión)
create or replace function api.list_agent_profiles()
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
  select coalesce(
    jsonb_agg(data || jsonb_build_object('revision', revision) order by agent_id),
    '[]'::jsonb) into result
  from api.agent_profiles where owner_id = actor;
  return result;
end;
$$;

-- ───────────────────────────────────────────────────────────── escritura
drop function api.save_agent_profile(jsonb);

create function api.save_agent_profile(p_profile jsonb, p_expected_revision bigint default 0)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  agent text := btrim(coalesce(p_profile ->> 'agentId', ''));
  problem text;
  previous jsonb;
  stored jsonb;
  saved_revision bigint;
  fields text[];
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_profile) is distinct from 'object' or agent = '' then
    raise exception 'La ficha de agente requiere agentId' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'La revisión esperada debe ser cero o positiva' using errcode = '22023';
  end if;
  -- La mitad de gobernanza de la ficha no es configurable desde una pantalla:
  -- quién produce, quién revisa y qué papel de orquestación tiene un agente son
  -- la separación de funciones que justifica una oficina de arquitectura.
  if p_profile ? 'orchestrationRole'
    or p_profile ? 'producesArtifactTypes'
    or p_profile ? 'reviewsArtifactTypes' then
    raise exception 'La ficha no puede alterar la gobernanza del agente' using errcode = '22023';
  end if;
  problem := private.agent_profile_problem(p_profile);
  if problem is not null then
    raise exception '%', problem using errcode = '22023';
  end if;

  -- La revisión viaja aparte: no se guarda dentro del documento.
  stored := jsonb_set(p_profile - 'revision', '{userId}', to_jsonb(actor::text), true);

  select data into previous from api.agent_profiles
  where owner_id = actor and agent_id = agent;

  if previous is null then
    if p_expected_revision <> 0 then
      raise exception 'Conflicto de ficha: recarga antes de guardar' using errcode = 'P0001';
    end if;
    insert into api.agent_profiles (owner_id, agent_id, data)
    values (actor, agent, stored)
    on conflict (owner_id, agent_id) do nothing
    returning revision into saved_revision;
    if saved_revision is null then
      raise exception 'Conflicto de ficha: recarga antes de guardar' using errcode = 'P0001';
    end if;
  else
    update api.agent_profiles
      set data = stored, revision = revision + 1, updated_at = now()
    where owner_id = actor and agent_id = agent and revision = p_expected_revision
    returning revision into saved_revision;
    if saved_revision is null then
      raise exception 'Conflicto de ficha: recarga antes de guardar' using errcode = 'P0001';
    end if;
  end if;

  -- Campos que cambiaron, sin el ruido que cambia siempre.
  select coalesce(array_agg(k order by k), '{}') into fields
  from (
    select k from jsonb_object_keys(stored) as k
    where k not in ('updatedAt', 'userId')
      and (previous is null or previous -> k is distinct from stored -> k)
    union
    select k from jsonb_object_keys(coalesce(previous, '{}'::jsonb)) as k
    where k not in ('updatedAt', 'userId') and not (stored ? k)
  ) as changed;

  insert into api.agent_profile_changes
    (owner_id, agent_id, action, changed_fields, revision, contract_version)
  values (actor, agent, 'save', fields, saved_revision,
    case when jsonb_typeof(stored -> 'definitionVersion') = 'number'
      then (stored ->> 'definitionVersion')::integer end);

  return jsonb_build_object('revision', saved_revision);
end;
$$;
comment on function api.save_agent_profile(jsonb, bigint) is
  'Guarda la ficha del agente del auth.uid con validación completa, concurrencia optimista (0 = crear) y bitácora. Devuelve la revisión nueva.';

create or replace function api.delete_agent_profile(p_agent_id text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  removed api.agent_profiles;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  delete from api.agent_profiles
  where owner_id = actor and agent_id = p_agent_id
  returning * into removed;
  if found then
    insert into api.agent_profile_changes
      (owner_id, agent_id, action, changed_fields, revision, contract_version)
    values (actor, p_agent_id, 'reset', '{}', removed.revision,
      case when jsonb_typeof(removed.data -> 'definitionVersion') = 'number'
        then (removed.data ->> 'definitionVersion')::integer end);
  end if;
end;
$$;

create function api.list_agent_profile_changes(p_agent_id text default null, p_limit integer default 50)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  capped integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  result jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select coalesce(jsonb_agg(row_to_json(page)::jsonb order by page.id desc), '[]'::jsonb) into result
  from (
    select id, agent_id as "agentId", action, changed_fields as "changedFields",
           revision, contract_version as "contractVersion", changed_at as "changedAt"
    from api.agent_profile_changes
    where owner_id = actor and (p_agent_id is null or agent_id = p_agent_id)
    order by id desc
    limit capped
  ) as page;
  return result;
end;
$$;
comment on function api.list_agent_profile_changes(text, integer) is
  'Bitácora de cambios de las fichas del auth.uid, más reciente primero.';

-- ─────────────────────────────────────────────────────────── privilegios
revoke all on table api.agent_profile_changes from public, anon, authenticated, service_role;
revoke all on function private.agent_profile_problem(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.agent_profile_changes_immutable() from public, anon, authenticated, service_role;
revoke all on function api.save_agent_profile(jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function api.list_agent_profile_changes(text, integer) from public, anon, authenticated, service_role;
grant execute on function api.save_agent_profile(jsonb, bigint) to authenticated;
grant execute on function api.list_agent_profile_changes(text, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
