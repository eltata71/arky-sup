-- F2-03 follow-up: immutable ARB evidence is server-owned, never client-owned.
--
-- `p_decision` contains only the decision intent (id, engagement id, verdict and
-- rationale). The RPC derives actor identity, role, previous state, gate status
-- and timestamp from authoritative server state before it writes the immutable
-- register.
begin;

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
  actor_name text;
  actor_role text;
  saved api.office_engagements;
  engagement_key text := btrim(coalesce(p_engagement ->> 'id', ''));
  project_key text := btrim(coalesce(p_project_id, ''));
  decision_key text := btrim(coalesce(p_decision ->> 'id', ''));
  verdict text := coalesce(p_decision ->> 'verdict', '');
  rationale text := btrim(coalesce(p_decision ->> 'rationale', ''));
  next_status text := coalesce(p_engagement ->> 'status', '');
  expected_status text;
  previous_status text;
  gate_status text;
  current_row api.office_engagements;
  mirror jsonb;
  canonical_decision jsonb;
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
  if verdict not in ('approved', 'changes-requested', 'rejected') then
    raise exception 'El veredicto del ARB no es válido' using errcode = '22023';
  end if;
  if verdict in ('changes-requested', 'rejected') and rationale = '' then
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
  select coalesce(display_name, actor::text), role
  into actor_name, actor_role
  from api.user_profiles
  where id = actor and status = 'active';
  if actor_role is null then
    raise exception 'El perfil activo de la sesión no existe' using errcode = '42501';
  end if;

  -- A network retry arrives after the row moved and with an old revision. Its immutable intent is compared without the server timestamp; the exact already-persisted aggregate is returned.
  -- through to the unique-id collision below and aborts fail-closed.
  if exists (
    select 1 from api.office_arb_decisions d
    where d.id = decision_key
      and d.engagement_id = engagement_key
      and d.project_id = project_key
      and d.owner_id = current_row.owner_id
      and d.decided_revision = p_expected_revision
      and d.data ->> 'verdict' = verdict
      and d.data ->> 'rationale' = rationale
      and (d.data -> 'actor') ->> 'id' = actor::text
  ) then
    return current_row;
  end if;

  if current_row.revision <> p_expected_revision then
    raise exception 'Conflicto de encargo: recarga antes de guardar' using errcode = 'P0001';
  end if;

  previous_status := coalesce(current_row.data ->> 'status', '');
  if previous_status not in ('awaiting-arb', 'blocked') then
    raise exception 'El encargo no está en revisión del comité (estado actual: "%")', previous_status
      using errcode = '22023';
  end if;
  gate_status := coalesce(current_row.data #>> '{gateAssessment,overallStatus}', 'conditional');
  if gate_status not in ('pass', 'conditional', 'blocked') then
    raise exception 'El estado de quality gates no es válido' using errcode = '22023';
  end if;
  if verdict = 'approved' and gate_status = 'blocked' then
    raise exception 'No se puede aprobar: hay quality gates bloqueados' using errcode = '22023';
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

  canonical_decision := jsonb_build_object(
    'id', decision_key,
    'engagementId', engagement_key,
    'verdict', verdict,
    'rationale', rationale,
    'actor', jsonb_build_object('id', actor::text, 'name', actor_name, 'role', actor_role),
    'gateStatusAtDecision', gate_status,
    'previousStatus', previous_status,
    'decidedAt', now()
  );

  -- The client sends only transition intent. The aggregate's audit trail,
  -- timestamp, title, charter, tasks and budget remain server-owned here.
  next_data := jsonb_set(current_row.data, '{status}', to_jsonb(next_status), true);

  insert into api.office_arb_decisions
    (id, engagement_id, project_id, owner_id, data, decided_revision)
  values
    (decision_key, engagement_key, project_key, current_row.owner_id, canonical_decision, current_row.revision)
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
  'Un miembro ARB distinto del autor firma y transiciona el encargo en una transacción; la evidencia inmutable se canoniza en servidor.';
revoke all on function api.decide_engagement(text, jsonb, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function api.decide_engagement(text, jsonb, bigint, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
