-- F6-04 — El servidor asigna el código de una iniciativa nueva.
--
-- Lo encontró el recorrido E2E de F6-04: dos altas simultáneas de iniciativa
-- chocaban con `duplicate key value violates unique constraint
-- "business_initiatives_code_key"`, y la persona veía ese mensaje en inglés.
--
-- La causa es más ancha que la concurrencia. `code` es único en **toda** la
-- base, pero el cliente calcula el siguiente `NEG-AAAA-NNN` a partir de
-- `list_business_initiatives`, que sólo devuelve las del propio usuario. Un
-- segundo usuario de la organización calculaba siempre `NEG-AAAA-001`, chocaba
-- con el del primero, y como su lista seguía vacía volvía a calcular lo mismo:
-- **no podía crear ninguna iniciativa**.
--
-- El servidor, que ve todas las filas, pasa a ser la autoridad al crear: si el
-- código propuesto está libre se respeta —el caso normal, y el que el asistente
-- de alta anuncia—; si no, asigna el siguiente libre del mismo año, bajo un
-- candado de transacción. El documento guardado (`data`) lleva el código
-- asignado, así que el cliente, que adopta lo que el servidor confirma, lo
-- muestra sin cambio alguno en él.
--
-- Compatibilidad: misma firma y mismos privilegios (`create or replace` los
-- conserva); sólo cambia qué ocurre donde antes había un error. Una
-- actualización de una iniciativa existente no reasigna nada.
--
-- Reversión: volver a crear la función con la definición de
-- `20260912060520_business_initiatives.sql`.

begin;

create or replace function api.save_business_initiative(p_initiative jsonb, p_expected_revision bigint)
returns api.business_initiatives
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved api.business_initiatives;
  initiative_id text := btrim(coalesce(p_initiative ->> 'id', ''));
  initiative_code text := btrim(coalesce(p_initiative ->> 'code', ''));
  initiative_title text := btrim(coalesce(p_initiative ->> 'title', ''));
  initiative_need text := btrim(coalesce(p_initiative ->> 'need', ''));
  initiative_status text := coalesce(p_initiative ->> 'status', '');
  initiative_priority text := coalesce(p_initiative ->> 'priority', '');
  initiative_horizon text := coalesce(p_initiative ->> 'horizon', '');
  initiative_risk_level text := coalesce(p_initiative ->> 'riskLevel', '');
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('initiative:write') then
    raise exception 'Permiso insuficiente: initiative:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_initiative) <> 'object' or initiative_id = '' or initiative_code !~ '^NEG-[0-9]{4}-[0-9]{3}$'
    or initiative_title = '' or initiative_need = '' then
    raise exception 'La iniciativa no tiene una forma válida' using errcode = '22023';
  end if;
  if p_initiative ->> 'userId' is distinct from actor::text then
    raise exception 'La iniciativa no pertenece a la sesión actual' using errcode = '42501';
  end if;
  if p_expected_revision < 0 then
    raise exception 'La revisión esperada no puede ser negativa' using errcode = '22023';
  end if;

  -- F6-04: el código lo asigna el servidor al crear. El cliente lo calcula de
  -- *sus* iniciativas, pero el código es único en toda la base: un segundo
  -- usuario calculaba siempre NEG-AAAA-001, chocaba con el del primero, y como
  -- su lista seguía vacía no podía crear ninguna. Dos altas simultáneas del
  -- mismo usuario chocaban igual. El propuesto se respeta si está libre, que es
  -- el caso normal y el que la pantalla anuncia; si no, se toma el siguiente
  -- libre del mismo año. El candado serializa la asignación, no la tabla.
  if not exists (select 1 from api.business_initiatives where id = initiative_id) then
    perform pg_advisory_xact_lock(hashtextextended('api.business_initiatives.code', 0));
    if exists (select 1 from api.business_initiatives where code = initiative_code) then
      initiative_code := format(
        'NEG-%s-%s',
        substring(initiative_code from 5 for 4),
        lpad((coalesce((
          select max(substring(existing.code from 10 for 3)::integer)
          from api.business_initiatives existing
          where existing.code like 'NEG-' || substring(initiative_code from 5 for 4) || '-%'
        ), 0) + 1)::text, 3, '0')
      );
      if initiative_code !~ '^NEG-[0-9]{4}-[0-9]{3}$' then
        raise exception 'No quedan códigos de iniciativa libres para ese año' using errcode = '22023';
      end if;
      p_initiative := jsonb_set(p_initiative, '{code}', to_jsonb(initiative_code));
    end if;
  end if;

  insert into api.business_initiatives as target (
    id, owner_id, code, title, need, status, priority, horizon, risk_level, data, revision
  ) values (
    initiative_id, actor, initiative_code, initiative_title, initiative_need,
    initiative_status, initiative_priority, initiative_horizon, initiative_risk_level,
    p_initiative, 1
  )
  on conflict (id) do update
    set code = excluded.code,
        title = excluded.title,
        need = excluded.need,
        status = excluded.status,
        priority = excluded.priority,
        horizon = excluded.horizon,
        risk_level = excluded.risk_level,
        data = excluded.data,
        revision = target.revision + 1,
        updated_at = now()
    where target.owner_id = actor and target.revision = p_expected_revision
  returning target.* into saved;

  if not found then
    raise exception 'Conflicto de iniciativa: recarga antes de guardar' using errcode = 'P0001';
  end if;
  return saved;
end;
$$;
comment on function api.save_business_initiative(jsonb, bigint) is
  'Guarda una iniciativa del auth.uid con permiso, sesión activa y concurrencia optimista. Al crear, asigna el código si el propuesto ya existe (F6-04).';

notify pgrst, 'reload schema';
commit;
