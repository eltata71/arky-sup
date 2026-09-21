-- F2-02/F2-03/F2-09: lifecycle guards, separated ARB review and least RPC surface.
--
-- This migration is additive. It keeps deployed history immutable and replaces
-- only the current function bodies/privileges.
begin;

create or replace function private.office_engagement_transition_allowed(
  p_previous text,
  p_next text
)
returns boolean
language sql immutable set search_path = '' as $$
  select (p_previous, p_next) in (
    ('intake', 'intake'),
    ('intake', 'planning'),
    ('intake', 'cancelled'),
    ('planning', 'planning'),
    ('planning', 'awaiting-charter'),
    ('planning', 'in-progress'),
    ('planning', 'cancelled'),
    ('awaiting-charter', 'awaiting-charter'),
    ('awaiting-charter', 'in-progress'),
    ('awaiting-charter', 'cancelled'),
    ('in-progress', 'in-progress'),
    ('in-progress', 'blocked'),
    ('in-progress', 'awaiting-arb'),
    ('in-progress', 'cancelled'),
    ('blocked', 'blocked'),
    ('blocked', 'in-progress'),
    ('blocked', 'cancelled'),
    ('awaiting-arb', 'awaiting-arb')
  )
$$;
comment on function private.office_engagement_transition_allowed(text, text) is
  'Closed transition matrix for ordinary engagement saves. ARB outcomes use api.decide_engagement.';
revoke all on function private.office_engagement_transition_allowed(text, text)
  from public, anon, authenticated, service_role;

create or replace function api.save_engagement(
  p_project_id text,
  p_engagement jsonb,
  p_expected_revision bigint
)
returns api.office_engagements
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved api.office_engagements;
  current_row api.office_engagements;
  engagement_key text := btrim(coalesce(p_engagement ->> 'id', ''));
  project_key text := btrim(coalesce(p_project_id, ''));
  next_status text := coalesce(p_engagement ->> 'status', '');
  previous_status text;
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
  if next_status not in
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
  if next_status = 'delivered' then
    raise exception 'Use api.decide_engagement para entregar un encargo' using errcode = '22023';
  end if;

  select * into current_row
  from api.office_engagements
  where id = engagement_key and project_id = project_key
  for update;

  if found then
    if current_row.owner_id <> actor then
      raise exception 'El encargo no existe o es ajeno' using errcode = 'P0002';
    end if;
    if current_row.revision <> p_expected_revision then
      raise exception 'Conflicto de encargo: recarga antes de guardar' using errcode = 'P0001';
    end if;
    previous_status := coalesce(current_row.data ->> 'status', '');
    if not private.office_engagement_transition_allowed(previous_status, next_status) then
      raise exception 'Transición de encargo no permitida: % -> %', previous_status, next_status
        using errcode = '22023';
    end if;
    update api.office_engagements
    set data = p_engagement,
        revision = revision + 1,
        updated_at = now()
    where id = current_row.id
      and project_id = current_row.project_id
      and owner_id = actor
      and revision = p_expected_revision
    returning * into saved;
    if not found then
      raise exception 'Conflicto de encargo: recarga antes de guardar' using errcode = 'P0001';
    end if;
    return saved;
  end if;

  if p_expected_revision <> 0 then
    raise exception 'Conflicto de encargo: recarga antes de guardar' using errcode = 'P0001';
  end if;
  if next_status <> 'awaiting-charter' then
    raise exception 'Un encargo nuevo debe comenzar en awaiting-charter' using errcode = '22023';
  end if;

  begin
    insert into api.office_engagements (id, project_id, owner_id, data, revision)
    values (engagement_key, project_key, actor, p_engagement, 1)
    returning * into saved;
  exception
    when unique_violation then
      raise exception 'Conflicto de encargo: recarga antes de guardar' using errcode = 'P0001';
  end;
  return saved;
end;
$$;

create or replace function api.load_arb_engagements()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  payload jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('arb:decide') then
    raise exception 'Permiso insuficiente: arb:decide' using errcode = '42501';
  end if;
  perform private.assert_session_active();

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'revision', e.revision,
      'data', e.data || jsonb_build_object(
        'arbDecisions',
        coalesce((
          select jsonb_agg(d.data order by d.created_at)
          from api.office_arb_decisions d
          where d.owner_id = e.owner_id
            and d.project_id = e.project_id
            and d.engagement_id = e.id
        ), '[]'::jsonb)
      )
    ) order by e.updated_at desc
  ), '[]'::jsonb)
  into payload
  from api.office_engagements e
  where e.owner_id <> actor
    and coalesce(e.data ->> 'status', '') in ('awaiting-arb', 'blocked');
  return payload;
end;
$$;
comment on function api.load_arb_engagements() is
  'Bandeja global de encargos ajenos awaiting-arb/blocked para miembros con arb:decide.';
revoke all on function api.load_arb_engagements()
  from public, anon, authenticated, service_role;
grant execute on function api.load_arb_engagements() to authenticated;

create or replace function api.decide_engagement(
  p_project_id text,
  p_engagement jsonb,
  p_expected_revision bigint,
  p_decision jsonb
)
returns api.office_engagements
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved api.office_engagements;
  engagement_key text := btrim(coalesce(p_engagement ->> 'id', ''));
  project_key text := btrim(coalesce(p_project_id, ''));
  decision_key text := btrim(coalesce(p_decision ->> 'id', ''));
  verdict text := coalesce(p_decision ->> 'verdict', '');
  next_status text := coalesce(p_engagement ->> 'status', '');
  expected_status text;
  current_row api.office_engagements;
  mirror jsonb;
  recorded_decision_id text;
  next_data jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('arb:decide') then
    raise exception 'Permiso insuficiente: arb:decide' using errcode = '42501';
  end if;
  perform private.assert_session_active();

  if jsonb_typeof(p_engagement) is distinct from 'object'
    or jsonb_typeof(p_decision) is distinct from 'object'
    or engagement_key = '' or project_key = ''
    or p_engagement ->> 'projectId' is distinct from project_key
    or decision_key = ''
    or p_decision ->> 'engagementId' is distinct from engagement_key then
    raise exception 'La decisión del ARB no tiene una forma válida' using errcode = '22023';
  end if;
  if (p_decision -> 'actor') ->> 'id' is distinct from actor::text then
    raise exception 'La decisión debe ir firmada por la sesión actual' using errcode = '42501';
  end if;
  if verdict not in ('approved', 'changes-requested', 'rejected') then
    raise exception 'El veredicto del ARB no es válido' using errcode = '22023';
  end if;
  if verdict in ('changes-requested', 'rejected')
    and btrim(coalesce(p_decision ->> 'rationale', '')) = '' then
    raise exception 'Un veredicto de cambio o rechazo exige motivo' using errcode = '22023';
  end if;
  if jsonb_path_exists(p_engagement, '$.**.apiKey')
    or jsonb_path_exists(p_decision, '$.**.apiKey') then
    raise exception 'La decisión no puede contener apiKey' using errcode = '22023';
  end if;

  select * into current_row
  from api.office_engagements
  where id = engagement_key and project_id = project_key
  for update;
  if not found then
    raise exception 'El encargo no existe' using errcode = 'P0002';
  end if;
  if current_row.owner_id = actor then
    raise exception 'El autor no puede decidir su propio encargo' using errcode = '42501';
  end if;
  if current_row.revision <> p_expected_revision then
    raise exception 'Conflicto de encargo: recarga antes de guardar' using errcode = 'P0001';
  end if;
  if coalesce(current_row.data ->> 'status', '') not in ('awaiting-arb', 'blocked') then
    raise exception 'El encargo no está en revisión del comité (estado actual: "%")',
      coalesce(current_row.data ->> 'status', '') using errcode = '22023';
  end if;

  expected_status := case verdict
    when 'approved' then 'delivered'
    when 'changes-requested' then 'in-progress'
    else 'cancelled'
  end;
  if next_status is distinct from expected_status then
    raise exception 'Un veredicto "%" lleva el encargo a "%", no a "%"',
      verdict, expected_status, next_status using errcode = '22023';
  end if;

  -- The server keeps every author-owned field. The client can propose only the
  -- transition and an appended audit trail; title, charter, tasks and budget in
  -- p_engagement are deliberately ignored.
  if p_engagement ? 'auditTrail' and (
    jsonb_typeof(p_engagement -> 'auditTrail') is distinct from 'array'
    or jsonb_array_length(p_engagement -> 'auditTrail') < jsonb_array_length(current_row.data -> 'auditTrail')
    or not (p_engagement -> 'auditTrail') @> (current_row.data -> 'auditTrail')
  ) then
    raise exception 'La decisión debe conservar la auditoría existente' using errcode = '22023';
  end if;
  next_data := jsonb_set(current_row.data, '{status}', to_jsonb(next_status), true);
  if p_engagement ? 'auditTrail' then
    next_data := jsonb_set(next_data, '{auditTrail}', p_engagement -> 'auditTrail', true);
  end if;
  if p_engagement ? 'updatedAt' then
    next_data := jsonb_set(next_data, '{updatedAt}', p_engagement -> 'updatedAt', true);
  end if;

  insert into api.office_arb_decisions
    (id, engagement_id, project_id, owner_id, data, decided_revision)
  values
    (decision_key, engagement_key, project_key, current_row.owner_id, p_decision, current_row.revision)
  on conflict (id) do update
    set id = excluded.id
    where office_arb_decisions.engagement_id = excluded.engagement_id
      and office_arb_decisions.project_id = excluded.project_id
      and office_arb_decisions.owner_id = excluded.owner_id
      and office_arb_decisions.data = excluded.data
      and office_arb_decisions.decided_revision = excluded.decided_revision
  returning id into recorded_decision_id;
  if recorded_decision_id is null then
    raise exception 'El identificador de la decisión ya pertenece a otra decisión'
      using errcode = '23505';
  end if;

  select coalesce(jsonb_agg(d.data order by d.created_at), '[]'::jsonb)
  into mirror
  from api.office_arb_decisions d
  where d.engagement_id = engagement_key
    and d.project_id = project_key
    and d.owner_id = current_row.owner_id;

  update api.office_engagements
  set data = jsonb_set(next_data, '{arbDecisions}', mirror, true),
      revision = revision + 1,
      updated_at = now()
  where id = engagement_key
    and project_id = project_key
    and owner_id = current_row.owner_id
    and revision = p_expected_revision
  returning * into saved;
  if not found then
    raise exception 'Conflicto de encargo: recarga antes de guardar' using errcode = 'P0001';
  end if;
  return saved;
end;
$$;
comment on function api.decide_engagement(text, jsonb, bigint, jsonb) is
  'Un miembro ARB distinto del autor firma y transiciona el encargo en una transacción.';
revoke all on function api.decide_engagement(text, jsonb, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function api.decide_engagement(text, jsonb, bigint, jsonb) to authenticated;

-- `register_file_object` already validates the physical object, owner, route,
-- MIME, size and declared SHA before inserting. Promote that validated insert in
-- the same transaction, rather than asking the browser to call the service-role
-- only `mark_file_object_ready` RPC afterwards (a call that could never work).
create or replace function private.confirm_registered_file_object()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'pending' then
    new.state := 'ready';
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.confirm_registered_file_object()
  from public, anon, authenticated, service_role;
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'api' and table_name = 'file_objects') then
    create trigger confirm_registered_file_object
    before insert on api.file_objects
    for each row execute function private.confirm_registered_file_object();
  end if;
end;
$$;

-- F2-09: these client grants have no production consumer. Keep the functions
-- for migration compatibility/internal recovery, but close the public surface.
-- Each revoke is conditional so the migration applies cleanly to a fresh schema.
do $$
begin
  if exists (select 1 from information_schema.routines where routine_schema = 'api' and routine_name = 'record_arb_decision') then
    revoke all on function api.record_arb_decision(jsonb)
      from public, anon, authenticated, service_role;
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from information_schema.routines where routine_schema = 'api' and routine_name = 'load_platform_reference_parameters') then
    revoke all on function api.load_platform_reference_parameters()
      from public, anon, authenticated, service_role;
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from information_schema.routines where routine_schema = 'api' and routine_name = 'save_platform_reference_parameters') then
    revoke all on function api.save_platform_reference_parameters(jsonb, bigint)
      from public, anon, authenticated, service_role;
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from information_schema.routines where routine_schema = 'api' and routine_name = 'mark_file_object_deleted') then
    revoke all on function api.mark_file_object_deleted(uuid)
      from public, anon, authenticated, service_role;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
