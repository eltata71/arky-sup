-- Guardas de gobernanza del registro ARB y paridad de borrado con iniciativas.
--
-- 1. La transición a 'delivered' exige arb:decide, igual que firestore.rules
--    (allow update con status='delivered' sólo a isAdmin/canDecideArb). Con esto
--    un cliente con sólo project:write no puede firmar la entrega por PostgREST
--    saltándose el comité y su registro inmutable.
-- 2. api.delete_engagement pasa a exigir revisión optimista, como
--    delete_business_initiative: un borrado desde una vista obsoleta no elimina
--    una edición concurrente.
begin;

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
  engagement_key text := btrim(coalesce(p_engagement ->> 'id', ''));
  project_key text := btrim(coalesce(p_project_id, ''));
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
  if coalesce(p_engagement ->> 'status', '') not in
    ('intake', 'planning', 'awaiting-charter', 'in-progress', 'awaiting-arb', 'delivered', 'blocked', 'cancelled') then
    raise exception 'El estado del encargo no es válido' using errcode = '22023';
  end if;

  -- El comité manda: un encargo ajeno o propio sólo llega a 'delivered' con
  -- arb:decide. La lectura previa va dentro de la guarda de conflicto; un
  -- encargo nuevo no puede nacer entregado.
  if coalesce(p_engagement ->> 'status', '') = 'delivered' then
    if not private.has_permission('arb:decide') then
      raise exception 'Permiso insuficiente: arb:decide' using errcode = '42501';
    end if;
    select data ->> 'status' into previous_status
    from api.office_engagements
    where id = engagement_key and owner_id = actor and project_id = project_key;
    if previous_status is not null and previous_status = 'delivered' then
      raise exception 'El encargo ya está entregado' using errcode = '22023';
    end if;
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

create or replace function api.delete_engagement(p_project_id text, p_engagement_id text, p_expected_revision bigint)
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
    and owner_id = actor
    and revision = p_expected_revision;
  if not found then
    raise exception 'Conflicto de encargo: recarga antes de borrar' using errcode = 'P0001';
  end if;
end;
$$;

-- La firma cambió a tres argumentos: la concesión específica a authenticated
-- de la firma anterior ya no cubre esta, y PUBLIC sólo hereda el revoke previo.
revoke all on function api.delete_engagement(text, text, bigint) from public, anon, authenticated, service_role;
grant execute on function api.delete_engagement(text, text, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;