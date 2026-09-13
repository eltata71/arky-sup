-- F5 / Corte 4 — Encargos de Oficina y decisiones ARB.
--
-- Un encargo vive bajo su proyecto pero NO exige que la raíz del proyecto esté
-- migrada: durante la cohorte el enlace es textual (`project_id`), con propietario
-- `auth.uid()` como frontera. Las decisiones ARB son un registro inmutable
-- (sólo-creación) con actor firmante = sesión actual y permiso arb:decide.
--
-- Validación de forma moderada a nivel SQL (la semántica completa del DAG vive
-- en el dominio TypeScript); aquí se defiende: identidad, sesión, permisos,
-- enums de estado, presupuesto numérico, sin secretos y decisiones no mutables.
begin;

create table api.office_engagements (
  id text primary key check (btrim(id) <> ''),
  project_id text not null check (btrim(project_id) <> ''),
  owner_id uuid not null references auth.users(id) on delete restrict,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint office_engagements_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint office_engagements_data_matches_identity check (
    data ->> 'id' = id and data ->> 'projectId' = project_id
  ),
  constraint office_engagements_no_api_key check (not jsonb_path_exists(data, '$.**.apiKey'))
);
comment on table api.office_engagements is
  'Encargo de Oficina. El enlace al proyecto es textual durante la cohorte; el propietario es la frontera de autorización.';
create index office_engagements_project_idx on api.office_engagements (owner_id, project_id, updated_at desc);

create table api.office_arb_decisions (
  id text primary key check (btrim(id) <> ''),
  engagement_id text not null check (btrim(engagement_id) <> ''),
  project_id text not null check (btrim(project_id) <> ''),
  owner_id uuid not null references auth.users(id) on delete restrict,
  data jsonb not null,
  created_at timestamptz not null default now(),
  constraint office_arb_decisions_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint office_arb_decisions_data_matches_identity check (
    data ->> 'id' = id and data ->> 'engagementId' = engagement_id
  ),
  constraint office_arb_decisions_no_api_key check (not jsonb_path_exists(data, '$.**.apiKey'))
);
comment on table api.office_arb_decisions is
  'Registro ARB a prueba de manipulación: sin UPDATE, sólo inserción mediante RPC autorizada.';
create index office_arb_decisions_engagement_idx on api.office_arb_decisions (owner_id, project_id, engagement_id);

alter table api.office_engagements enable row level security;
alter table api.office_arb_decisions enable row level security;

create function api.save_engagement(
  p_project_id text,
  p_engagement jsonb,
  p_expected_revision bigint
)
returns api.office_engagements
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved api.office_engagements;
  engagement_key text := btrim(coalesce(p_engagement ->> 'id', ''));
  project_key text := btrim(coalesce(p_project_id, ''));
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('project:write') then
    raise exception 'Permiso insuficiente: project:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_engagement) is distinct from 'object'
    or engagement_key = '' or p_engagement ->> 'id' <> engagement_key
    or project_key = '' or p_engagement ->> 'projectId' is distinct from project_key
    or btrim(coalesce(p_engagement ->> 'title', '')) = ''
    or btrim(coalesce(p_engagement ->> 'brief', '')) = '' then
    raise exception 'El encargo no tiene una forma válida' using errcode = '22023';
  end if;
  if coalesce(p_engagement ->> 'status', '') not in
    ('intake', 'planning', 'awaiting-charter', 'in-progress', 'awaiting-arb', 'delivered', 'blocked', 'cancelled') then
    raise exception 'El estado del encargo no es válido' using errcode = '22023';
  end if;
  if jsonb_typeof(p_engagement -> 'charter') is distinct from 'object'
    or jsonb_typeof(p_engagement -> 'tasks') is distinct from 'array'
    or jsonb_typeof(p_engagement -> 'auditTrail') is distinct from 'array'
    or jsonb_typeof(p_engagement -> 'budget') is distinct from 'object'
    or jsonb_typeof(p_engagement -> 'budget' -> 'maxAiCalls') is distinct from 'number'
    or jsonb_typeof(p_engagement -> 'budget' -> 'consumedAiCalls') is distinct from 'number'
    or (p_engagement -> 'budget' ->> 'maxAiCalls')::numeric < 0
    or (p_engagement -> 'budget' ->> 'consumedAiCalls')::numeric < 0 then
    raise exception 'El encargo no tiene una forma válida' using errcode = '22023';
  end if;
  if jsonb_path_exists(p_engagement, '$.**.apiKey') then
    raise exception 'El encargo no puede contener apiKey' using errcode = '22023';
  end if;

  insert into api.office_engagements as target (id, project_id, owner_id, data, revision)
  values (engagement_key, project_key, actor, p_engagement, 1)
  on conflict (id) do update
    set data = excluded.data,
        revision = target.revision + 1,
        updated_at = now()
    where target.owner_id = actor
      and target.project_id = project_key
      and target.revision = p_expected_revision
  returning target.* into saved;
  if not found then
    raise exception 'Conflicto de encargo: recarga antes de guardar' using errcode = 'P0001';
  end if;
  return saved;
end;
$$;

create function api.load_engagements(p_project_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  project_key text := btrim(coalesce(p_project_id, ''));
  payload jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select coalesce(jsonb_agg(
    e.data || jsonb_build_object(
      'arbDecisions',
      coalesce((select jsonb_agg(d.data order by d.created_at) from api.office_arb_decisions d
                where d.owner_id = actor and d.project_id = btrim(p_project_id)
                  and d.engagement_id = e.id), '[]'::jsonb)
    ) order by e.updated_at desc), '[]'::jsonb)
  into payload
  from api.office_engagements e
  where e.owner_id = actor and e.project_id = btrim(coalesce(p_project_id, ''));
  return payload;
end;
$$;

create function api.delete_engagement(p_project_id text, p_engagement_id text)
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
  delete from api.office_engagements
  where id = btrim(coalesce(p_engagement_id, ''))
    and project_id = btrim(coalesce(p_project_id, ''))
    and owner_id = actor;
  if not found then
    raise exception 'El encargo no existe o es ajeno' using errcode = 'P0002';
  end if;
end;
$$;

create function api.record_arb_decision(p_decision jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  decision_key text := btrim(coalesce(p_decision ->> 'id', ''));
  engagement_key text := btrim(coalesce(p_decision ->> 'engagementId', ''));
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('arb:decide') then
    raise exception 'Permiso insuficiente: arb:decide' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_decision) is distinct from 'object'
    or decision_key = '' or p_decision ->> 'id' <> decision_key
    or engagement_key = '' or p_decision ->> 'engagementId' <> engagement_key
    or (p_decision -> 'actor') ->> 'id' is distinct from actor::text then
    raise exception 'La decisión del ARB no tiene una forma válida' using errcode = '22023';
  end if;
  if coalesce(p_decision ->> 'verdict', '') not in ('approved', 'changes-requested', 'rejected') then
    raise exception 'El veredicto del ARB no es válido' using errcode = '22023';
  end if;
  if coalesce(p_decision ->> 'verdict', '') in ('changes-requested', 'rejected')
    and btrim(coalesce(p_decision ->> 'rationale', '')) = '' then
    raise exception 'Un veredicto de cambio o rechazo exige motivo' using errcode = '22023';
  end if;
  if jsonb_path_exists(p_decision, '$.**.apiKey') then
    raise exception 'La decisión no puede contener apiKey' using errcode = '22023';
  end if;
  if not exists (
    select 1 from api.office_engagements e
    where e.id = engagement_key
  ) then
    raise exception 'El encargo del ARB no existe' using errcode = 'P0002';
  end if;
  -- El registro pertenece al propietario del encargo: un comité firma sobre
  -- encargos ajenos (el autor no aprueba su propio trabajo), como en firestore.rules.
  insert into api.office_arb_decisions (id, engagement_id, project_id, owner_id, data)
  select decision_key, engagement_key, e.project_id, e.owner_id, p_decision
  from api.office_engagements e where e.id = engagement_key;
end;
$$;

revoke all on table api.office_engagements from public, anon, authenticated, service_role;
revoke all on table api.office_arb_decisions from public, anon, authenticated, service_role;
revoke all on function api.save_engagement(text, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function api.load_engagements(text) from public, anon, authenticated, service_role;
revoke all on function api.delete_engagement(text, text) from public, anon, authenticated, service_role;
revoke all on function api.record_arb_decision(jsonb) from public, anon, authenticated, service_role;
grant execute on function api.save_engagement(text, jsonb, bigint) to authenticated;
grant execute on function api.load_engagements(text) to authenticated;
grant execute on function api.delete_engagement(text, text) to authenticated;
grant execute on function api.record_arb_decision(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;