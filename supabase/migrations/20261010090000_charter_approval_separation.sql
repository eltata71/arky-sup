-- 14.1 · R-02: quien aprueba el charter no es quien lo escribió.
--
-- Hasta hoy el charter lo aprobaba el propio dueño del encargo
-- (`save_engagement` es sólo del dueño y la regla 3 de `assert_charter_approval`
-- pedía que firmara la sesión que escribe). `charter:approve` existía en la
-- matriz y nada lo exigía: la separación de funciones —el motivo de que exista
-- una oficina— se saltaba con un clic. Decisión del propietario (R-02):
--
--   1. Aprobar un charter exige `charter:approve`.
--   2. El autor del encargo no aprueba el suyo (42501), igual que en el ARB.
--   3. La firma, la fecha y el rol los pone el servidor, no el cliente.
--
-- Cuatro piezas:
--
--   * `api.approve_charter` — el único camino que aprueba. Firma y mueve el
--     encargo a `in-progress` en una transacción, con su entrada de auditoría.
--     Un reintento de red con la aprobación ya firmada por la misma sesión
--     devuelve lo guardado.
--   * `private.assert_charter_approval` — la regla 3 cambia: una primera
--     aprobación escrita por `save_engagement` se rechaza. Las reglas 1 y 2 se
--     mantienen, y un encargo guardado antes con su aprobación sigue
--     guardándose (la regla 3 sólo mira la primera aparición).
--   * `api.load_charter_engagements` — la bandeja de quien aprueba: encargos
--     ajenos en `awaiting-charter`/`planning`. Sin ella el aprobador no vería
--     nunca lo que debe firmar.
--
-- Reversión: recrear `private.assert_charter_approval` con la definición de
-- `20260926090000_charter_approval_guard.sql` y borrar las dos RPC nuevas.
begin;

create or replace function private.assert_charter_approval(
  p_previous jsonb,
  p_next jsonb,
  p_actor uuid
)
returns void
language plpgsql stable set search_path = '' as $$
declare
  next_status text := coalesce(p_next ->> 'status', '');
  next_approved_at text := nullif(btrim(coalesce(p_next -> 'charter' ->> 'approvedAt', '')), '');
  next_approved_by text := nullif(btrim(coalesce(p_next -> 'charter' -> 'approvedBy' ->> 'id', '')), '');
  previous_approved_at text := nullif(btrim(coalesce(p_previous -> 'charter' ->> 'approvedAt', '')), '');
  previous_approved_by text := nullif(btrim(coalesce(p_previous -> 'charter' -> 'approvedBy' ->> 'id', '')), '');
begin
  -- Regla 2: lo aprobado se queda aprobado, con su fecha y su firmante.
  if previous_approved_at is not null then
    if next_approved_at is distinct from previous_approved_at
      or next_approved_by is distinct from previous_approved_by then
      raise exception 'La aprobación del charter no se puede retirar ni reescribir' using errcode = '22023';
    end if;
  -- Regla 3 (14.1): una primera aprobación no entra por una escritura genérica.
  elsif next_approved_at is not null then
    raise exception 'El charter se aprueba sólo con api.approve_charter' using errcode = '42501';
  end if;

  -- Regla 1: nadie ejecuta un charter sin aprobar.
  if next_status = 'in-progress' and next_approved_at is null then
    raise exception 'El charter debe aprobarse antes de ejecutar el encargo' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.assert_charter_approval(jsonb, jsonb, uuid) from public, anon, authenticated, service_role;

create function api.approve_charter(
  p_project_id text,
  p_engagement_id text,
  p_expected_revision bigint
)
returns api.office_engagements
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  actor_role text;
  project_key text := btrim(coalesce(p_project_id, ''));
  engagement_key text := btrim(coalesce(p_engagement_id, ''));
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
    raise exception 'La aprobación del charter no tiene una forma válida' using errcode = '22023';
  end if;

  select * into current_row
  from api.office_engagements
  where id = engagement_key and project_id = project_key
  for update;
  if not found then
    raise exception 'El encargo no existe' using errcode = 'P0002';
  end if;
  if current_row.owner_id = actor then
    raise exception 'El autor no puede aprobar su propio charter' using errcode = '42501';
  end if;

  select coalesce(display_name, actor::text), role
  into actor_name, actor_role
  from api.user_profiles
  where id = actor and status = 'active';
  if actor_role is null then
    raise exception 'El perfil activo de la sesión no existe' using errcode = '42501';
  end if;

  -- Reintento de red: la misma sesión ya firmó y el encargo avanzó.
  if nullif(btrim(coalesce(current_row.data -> 'charter' ->> 'approvedAt', '')), '') is not null then
    if (current_row.data -> 'charter' -> 'approvedBy') ->> 'id' = actor::text
      and current_row.revision = p_expected_revision + 1 then
      return current_row;
    end if;
    raise exception 'El charter ya está aprobado' using errcode = '22023';
  end if;

  if current_row.revision <> p_expected_revision then
    raise exception 'Conflicto de encargo: recarga antes de guardar' using errcode = 'P0001';
  end if;

  previous_status := coalesce(current_row.data ->> 'status', '');
  if previous_status not in ('awaiting-charter', 'planning') then
    raise exception 'El encargo no espera la aprobación del charter (estado actual: "%")', previous_status
      using errcode = '22023';
  end if;
  if jsonb_typeof(current_row.data -> 'charter' -> 'deliverables') is distinct from 'array'
    or jsonb_array_length(current_row.data -> 'charter' -> 'deliverables') = 0 then
    raise exception 'El charter no tiene artefactos que aprobar' using errcode = '22023';
  end if;

  stamp := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  signature := jsonb_build_object('id', actor::text, 'name', actor_name, 'role', actor_role);
  audit := jsonb_build_object(
    'id', 'audit-' || replace(gen_random_uuid()::text, '-', ''),
    'engagementId', engagement_key,
    'action', 'charter-approved',
    'actor', signature,
    'timestamp', stamp,
    'details', 'Charter aprobado por ' || actor_name || ' (distinto del autor)'
  );
  if nullif(current_row.data ->> 'currentRunId', '') is not null then
    audit := audit || jsonb_build_object('runId', current_row.data ->> 'currentRunId');
  end if;

  next_data := jsonb_set(current_row.data, '{status}', '"in-progress"'::jsonb, true);
  next_data := jsonb_set(next_data, '{charter,approvedAt}', to_jsonb(stamp), true);
  next_data := jsonb_set(next_data, '{charter,approvedBy}', signature, true);
  next_data := jsonb_set(
    next_data,
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
comment on function api.approve_charter(text, text, bigint) is
  'Un aprobador con charter:approve, distinto del autor, firma el charter y lleva el encargo a in-progress; firma, fecha y auditoría son del servidor.';
revoke all on function api.approve_charter(text, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function api.approve_charter(text, text, bigint) to authenticated;

create function api.load_charter_engagements()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  payload jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('charter:approve') then
    raise exception 'Permiso insuficiente: charter:approve' using errcode = '42501';
  end if;
  perform private.assert_session_active();

  select coalesce(jsonb_agg(
    jsonb_build_object('revision', e.revision, 'data', e.data)
    order by e.updated_at desc
  ), '[]'::jsonb)
  into payload
  from api.office_engagements e
  where e.owner_id <> actor
    and coalesce(e.data ->> 'status', '') in ('awaiting-charter', 'planning');
  return payload;
end;
$$;
comment on function api.load_charter_engagements() is
  'Bandeja de encargos ajenos esperando la aprobación del charter, para miembros con charter:approve.';
revoke all on function api.load_charter_engagements()
  from public, anon, authenticated, service_role;
grant execute on function api.load_charter_engagements() to authenticated;

notify pgrst, 'reload schema';
commit;
