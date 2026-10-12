-- 14.7 · (14.1b) Pedir cambios al charter.
--
-- Quien tiene `charter:approve` y no es el autor podía hacer una sola cosa con
-- un charter que no le convencía: no firmarlo. Nada quedaba escrito. `save_engagement`
-- es sólo del dueño, así que el revisor tampoco podía dejar constancia. Esta RPC
-- registra la petición con su razón y su firma, sin mover el estado del encargo:
-- sigue esperando un charter, y el rastro dice quién lo devolvió y por qué.
--
-- Reglas, las mismas que `api.approve_charter` menos el cambio de estado:
--   1. Exige `charter:approve` y sesión viva.
--   2. El autor no pide cambios a su propio charter (42501).
--   3. El encargo debe estar en `awaiting-charter` o `planning`, sin aprobar.
--   4. La razón es obligatoria. Firma, fecha y rol los pone el servidor.
--
-- Reversión: `drop function api.request_charter_changes(text, text, bigint, text);`
begin;

create function api.request_charter_changes(
  p_project_id text,
  p_engagement_id text,
  p_expected_revision bigint,
  p_reason text
)
returns api.office_engagements
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  actor_role text;
  project_key text := btrim(coalesce(p_project_id, ''));
  engagement_key text := btrim(coalesce(p_engagement_id, ''));
  reason text := btrim(coalesce(p_reason, ''));
  current_row api.office_engagements;
  saved api.office_engagements;
  previous_status text;
  signature jsonb;
  stamp text;
  audit jsonb;
  next_data jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('charter:approve') then
    raise exception 'Permiso insuficiente: charter:approve' using errcode = '42501';
  end if;
  perform private.assert_session_active();

  if project_key = '' or engagement_key = '' then
    raise exception 'La petición de cambios no tiene una forma válida' using errcode = '22023';
  end if;
  if reason = '' then
    raise exception 'Pedir cambios exige explicar qué hay que cambiar' using errcode = '22023';
  end if;
  if char_length(reason) > 2000 then
    raise exception 'La razón es demasiado larga' using errcode = '22023';
  end if;

  select * into current_row
  from api.office_engagements
  where id = engagement_key and project_id = project_key
  for update;
  if not found then
    raise exception 'El encargo no existe' using errcode = 'P0002';
  end if;
  if current_row.owner_id = actor then
    raise exception 'El autor no puede pedir cambios a su propio charter' using errcode = '42501';
  end if;

  select coalesce(display_name, actor::text), role
  into actor_name, actor_role
  from api.user_profiles
  where id = actor and status = 'active';
  if actor_role is null then
    raise exception 'El perfil activo de la sesión no existe' using errcode = '42501';
  end if;

  if current_row.revision <> p_expected_revision then
    raise exception 'Conflicto de encargo: recarga antes de guardar' using errcode = 'P0001';
  end if;

  previous_status := coalesce(current_row.data ->> 'status', '');
  if previous_status not in ('awaiting-charter', 'planning')
    or nullif(btrim(coalesce(current_row.data -> 'charter' ->> 'approvedAt', '')), '') is not null then
    raise exception 'El encargo no espera la aprobación del charter (estado actual: "%")', previous_status
      using errcode = '22023';
  end if;

  stamp := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  signature := jsonb_build_object('id', actor::text, 'name', actor_name, 'role', actor_role);
  audit := jsonb_build_object(
    'id', 'audit-' || replace(gen_random_uuid()::text, '-', ''),
    'engagementId', engagement_key,
    'action', 'charter-changes-requested',
    'actor', signature,
    'timestamp', stamp,
    'details', reason,
    'before', previous_status,
    'after', previous_status
  );
  if nullif(current_row.data ->> 'currentRunId', '') is not null then
    audit := audit || jsonb_build_object('runId', current_row.data ->> 'currentRunId');
  end if;

  next_data := jsonb_set(
    current_row.data,
    '{auditTrail}',
    coalesce(current_row.data -> 'auditTrail', '[]'::jsonb) || jsonb_build_array(audit),
    true
  );
  next_data := jsonb_set(next_data, '{updatedAt}', to_jsonb(stamp), true);

  update api.office_engagements
  set data = next_data,
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
comment on function api.request_charter_changes(text, text, bigint, text) is
  'Un revisor con charter:approve, distinto del autor, devuelve el charter con una razón; el estado no cambia y la firma y la auditoría son del servidor.';
revoke all on function api.request_charter_changes(text, text, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function api.request_charter_changes(text, text, bigint, text) to authenticated;

notify pgrst, 'reload schema';

commit;
