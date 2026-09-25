-- F6-08 · E-02 / H06: nadie ejecuta un charter sin aprobar, y ahora lo sabe el servidor.
--
-- La regla que da sentido a la Oficina —un encargo no se ejecuta antes de que
-- alguien apruebe su charter— la aplicaba sólo el runner (`canRunEngagement`).
-- `awaiting-charter -> in-progress` era una transición legal en
-- `office_engagement_transition_allowed`, así que un cliente manipulado podía
-- escribir `in-progress` sobre un charter sin aprobar. Decisión del propietario,
-- 2026-09-26: llevar la regla al servidor, sin cambiar quién puede aprobar.
--
-- Tres reglas en `api.save_engagement`:
--
--   1. Pasar a (o seguir en) `in-progress` exige un charter aprobado.
--   2. Una aprobación ya registrada no se retira ni se reescribe: su fecha y su
--      firmante son los que se guardaron.
--   3. Cuando la aprobación aparece por primera vez, la firma la sesión que la
--      escribe (`approvedBy.id` = `auth.uid()`) y su fecha es una fecha. Nadie
--      aprueba en nombre de otro.
--
-- Lo que esta migración **no** cambia: quién puede aprobar. Hoy lo hace el
-- dueño del encargo, como decía el diseño (`approveCharter`). El permiso
-- `charter:approve` existe en la matriz y nada lo exige; exigirlo es una
-- decisión de producto registrada aparte (F6-08).
--
-- Compatibilidad: la aplicación ya escribe la aprobación con la firma de la
-- sesión, junto al paso a `in-progress`, en una sola escritura. Los encargos
-- guardados con una aprobación antigua sin firmante siguen guardándose: la
-- regla 3 sólo mira la primera aparición, y la 2 compara con lo guardado.
--
-- Reversión: `create or replace function api.save_engagement(...)` con la
-- definición de `20260920224928_phase_2_governance_guards.sql`.
begin;

-- Las tres reglas en un sitio, llamadas por `save_engagement` **después** de
-- comprobar que el encargo es del actor: antes, un encargo ajeno respondería
-- si está aprobado.
create function private.assert_charter_approval(
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
  -- Regla 3: la primera aprobación la firma la sesión que la escribe.
  elsif next_approved_at is not null then
    if next_approved_by is distinct from p_actor::text then
      raise exception 'El charter lo aprueba la sesión que lo firma' using errcode = '42501';
    end if;
    begin
      perform next_approved_at::timestamptz;
    exception when others then
      raise exception 'La fecha de aprobación del charter no es válida' using errcode = '22023';
    end;
  end if;

  -- Regla 1: nadie ejecuta un charter sin aprobar.
  if next_status = 'in-progress' and next_approved_at is null then
    raise exception 'El charter debe aprobarse antes de ejecutar el encargo' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.assert_charter_approval(jsonb, jsonb, uuid) from public, anon, authenticated, service_role;

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
    perform private.assert_charter_approval(current_row.data, p_engagement, actor);
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
  perform private.assert_charter_approval('{}'::jsonb, p_engagement, actor);

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

comment on function api.save_engagement(text, jsonb, bigint) is
  'Guarda un encargo con revisión optimista y transiciones legales; ejecutar exige un charter aprobado, y la aprobación es inmutable y la firma la sesión (F6-08).';

notify pgrst, 'reload schema';
commit;
