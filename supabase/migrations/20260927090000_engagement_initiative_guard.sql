-- F6 · Revisión de deuda técnica — E-01 (R-04) y R-13, aprobadas por el
-- propietario el 2026-09-27.
--
-- ## E-01: un encargo nace vinculado a una iniciativa, y lo sabe el servidor
--
-- La fábrica TypeScript (`createOfficeEngagement`) rechaza un encargo sin
-- iniciativa —por id o por código `NEG-AAAA-NNN`—, pero `api.save_engagement`
-- sólo exigía título, brief y proyecto. Un cliente manipulado podía crear un
-- encargo huérfano de su iniciativa, que es exactamente lo que la jerarquía
-- (iniciativa → proyecto → entregable) existe para impedir.
--
-- Dos reglas, las mismas que la fábrica, ni más ni menos:
--
--   1. Un encargo **nuevo** trae al menos un vínculo: un id no vacío en
--      `initiativeIds` o un código con forma `NEG-AAAA-NNN` en
--      `businessProjectIds`. La fábrica acepta los dos porque un proyecto
--      guardado por una versión antigua sólo tiene el código.
--   2. Un encargo **que ya tenía** vínculo no puede quedarse sin él. Es la misma
--      regla que P-02 aplica al proyecto sobre cambio, no sólo al crear.
--
-- Lo que no hace, a propósito: comprobar que la iniciativa existe o es del
-- actor. La fábrica tampoco lo hace; una referencia que no resuelve se
-- **informa** en el grafo del portafolio (`LinkIssue`), nunca se descarta ni se
-- rechaza en silencio.
--
-- Compatibilidad: la aplicación ya envía el vínculo en cada creación. Un encargo
-- guardado antes de esta regla sin vínculo se sigue pudiendo guardar: la regla 2
-- sólo mira lo que ya había.
--
-- ## R-13: `api.record_arb_decision` se elimina
--
-- F2-01 la dejó como compatibilidad mientras `api.decide_engagement` pasaba a
-- ser la única puerta de la decisión del comité, y F2-09 le revocó la ejecución
-- a todos los roles. Era código muerto en la base: inalcanzable, pero no
-- borrado, y una migración posterior que la concediera la resucitaría con la
-- escritura en dos pasos que F2-01 retiró. Se retira como `save_project_aggregate`
-- (F4-06): `revoke` y `drop`, con `retiredRpcs.test.ts` y un `hasnt_function`.
--
-- ## Reversión
--
--   - E-01: `create or replace function api.save_engagement(...)` con la
--     definición de `20260926090000_charter_approval_guard.sql`, y
--     `drop function private.assert_engagement_initiative_link(jsonb, jsonb)`.
--   - R-13: re-aplicar la definición de `api.record_arb_decision(jsonb)` de
--     `20260912170000_office_engagements.sql` **sin** concederla. Sólo hace falta
--     si un cliente anterior a F2-01 vuelve a desplegarse, y ese cliente ya
--     fallaba con la concesión revocada.
begin;

-- ───────────────────────────────────────────── E-01
create function private.assert_engagement_initiative_link(
  p_previous jsonb,
  p_next jsonb
)
returns void
language plpgsql immutable set search_path = '' as $$
declare
  next_links int;
  previous_links int;
begin
  next_links := private.engagement_initiative_link_count(p_next);
  if p_previous is null then
    if next_links = 0 then
      raise exception 'Un encargo nace vinculado a una iniciativa' using errcode = '22023';
    end if;
    return;
  end if;
  previous_links := private.engagement_initiative_link_count(p_previous);
  if previous_links > 0 and next_links = 0 then
    raise exception 'Un encargo no puede quedarse sin iniciativa' using errcode = '22023';
  end if;
end;
$$;

-- Cuenta los vínculos que la fábrica aceptaría: ids no vacíos y códigos con la
-- forma del objeto de valor (`toInitiativeCode` normaliza antes de validar).
create function private.engagement_initiative_link_count(p_engagement jsonb)
returns int
language sql immutable set search_path = '' as $$
  select
    (select count(*)::int
       from jsonb_array_elements(
         case when jsonb_typeof(p_engagement -> 'initiativeIds') = 'array'
              then p_engagement -> 'initiativeIds' else '[]'::jsonb end) as item(value)
      where jsonb_typeof(item.value) = 'string' and btrim(item.value #>> '{}') <> '')
  + (select count(*)::int
       from jsonb_array_elements(
         case when jsonb_typeof(p_engagement -> 'businessProjectIds') = 'array'
              then p_engagement -> 'businessProjectIds' else '[]'::jsonb end) as item(value)
      where jsonb_typeof(item.value) = 'string'
        and upper(btrim(item.value #>> '{}')) ~ '^NEG-[0-9]{4}-[0-9]{3}$');
$$;

revoke all on function private.assert_engagement_initiative_link(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.engagement_initiative_link_count(jsonb)
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
    perform private.assert_engagement_initiative_link(current_row.data, p_engagement);
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
  perform private.assert_engagement_initiative_link(null, p_engagement);
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
  'Guarda un encargo con revisión optimista y transiciones legales; nace vinculado a una iniciativa y no la pierde (E-01), ejecutar exige un charter aprobado, y la aprobación es inmutable y la firma la sesión (F6-08).';

-- ───────────────────────────────────────────── R-13
-- Sin `revoke` previo: la concesión ya se retiró en F2-09 (con `if exists`, porque
-- no toda base la tenía), y `drop` se lleva lo que quedara.
drop function if exists api.record_arb_decision(jsonb);

notify pgrst, 'reload schema';
commit;
