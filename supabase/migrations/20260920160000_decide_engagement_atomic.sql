-- La decisión del ARB pasa a ser **una** operación.
--
-- Decidir sobre un encargo eran dos escrituras desde el navegador: una movía el
-- estado (`save_engagement`) y otra escribía el registro inmutable
-- (`record_arb_decision`). Entre las dos no había transacción, así que los dos
-- estados intermedios eran posibles, y el peor de ellos no perdía el dato: lo
-- inventaba. El documento del encargo lleva un espejo `arbDecisions` para leer
-- rápido, y la primera escritura ya lo guardaba — de modo que si la segunda
-- fallaba, la pantalla mostraba una decisión firmada que el registro a prueba
-- de manipulación, el único que una auditoría acepta, no tenía.
--
-- El cliente ya escribe en el orden honesto (registro primero, transición
-- después), pero eso sólo mejora el estado intermedio: no lo elimina. Sólo una
-- transacción lo elimina, y una transacción entre dos tablas no se puede
-- escribir desde el navegador. Ver ADR-102.
--
-- **Quién calcula qué.** El cliente manda el documento ya transicionado, igual
-- que hace con `save_engagement`: las reglas del dominio —qué veredicto lleva a
-- qué estado, qué dice la entrada de auditoría— viven en TypeScript y
-- duplicarlas aquí crearía dos definiciones de la misma regla, que es el
-- defecto D-4 otra vez. Lo que el servidor hace es **comprobar**: que el estado
-- previo admite decisión, que el estado nuevo es el que ese veredicto exige,
-- que quien firma es quien dice ser, y que la revisión es la vigente. Y una
-- cosa que no comprueba sino que impone: el espejo `arbDecisions` lo reconstruye
-- él desde el registro, para que un cliente no pueda escribir un espejo que
-- diga algo distinto del rastro inmutable.
--
-- Lo que esta migración **no** arregla: la separación autor/aprobador. Sigue
-- siendo estructuralmente imposible mientras `owner_id` sea a la vez el autor y
-- la frontera de autorización — ADR-101, a la espera de una decisión de negocio.
-- Se deja escrito aquí para que nadie lea esta RPC y crea que la cubre.
--
-- Aditiva. `save_engagement` y `record_arb_decision` siguen existiendo: la
-- primera es la ruta de escritura ordinaria del encargo y la segunda, tras esto,
-- sólo queda como compatibilidad hacia atrás durante el despliegue. Su retirada
-- es una migración posterior, cuando ningún cliente desplegado la llame.
begin;

-- La decisión recuerda **sobre qué versión** se firmó.
--
-- El veredicto llegaba como texto del cliente y nada lo ataba a la evidencia
-- que el revisor tenía delante. Con esto, una firma sobre una versión que ya
-- había cambiado es detectable después, que es lo mínimo que una auditoría
-- necesita para poder decir «esto se aprobó viendo aquello».
alter table api.office_arb_decisions
  add column if not exists decided_revision bigint;
comment on column api.office_arb_decisions.decided_revision is
  'Revisión del encargo que el comité tenía delante al firmar. Nula en las decisiones anteriores a 20260920160000.';

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
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  -- Una decisión del comité exige el permiso del comité. `project:write` no
  -- basta y ésa es la razón de que esta RPC exista aparte de `save_engagement`.
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
  -- Quien firma es la sesión, no quien lo diga el documento.
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
  if jsonb_path_exists(p_engagement, '$.**.apiKey') or jsonb_path_exists(p_decision, '$.**.apiKey') then
    raise exception 'La decisión no puede contener apiKey' using errcode = '22023';
  end if;

  -- La fila se bloquea antes de comprobar nada sobre ella: sin esto, dos
  -- decisiones simultáneas leen el mismo `awaiting-arb` y ambas pasan la guarda.
  select * into current_row
  from api.office_engagements
  where id = engagement_key and project_id = project_key and owner_id = actor
  for update;
  if not found then
    raise exception 'El encargo no existe o es ajeno' using errcode = 'P0002';
  end if;
  if current_row.revision <> p_expected_revision then
    raise exception 'Conflicto de encargo: recarga antes de guardar' using errcode = 'P0001';
  end if;

  -- El estado previo lo lee el servidor de la fila, nunca del documento que
  -- llega: un cliente que pudiera declarar su propio estado previo podría
  -- decidir sobre un encargo que nunca llegó al comité.
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

  -- El registro inmutable primero. `on conflict do nothing` lo hace idempotente:
  -- un reintento tras un fallo de red no firma dos veces, que es lo que permite
  -- decirle a quien lo ve «vuelve a intentarlo» sin letra pequeña.
  insert into api.office_arb_decisions
    (id, engagement_id, project_id, owner_id, data, decided_revision)
  values
    (decision_key, engagement_key, project_key, current_row.owner_id, p_decision, current_row.revision)
  on conflict (id) do nothing;

  -- El espejo lo reconstruye el servidor desde el registro, no lo copia del
  -- documento que llega. Un espejo que el cliente pueda escribir es un espejo
  -- que puede decir algo distinto del rastro inmutable, y la pantalla lee el
  -- espejo.
  select coalesce(jsonb_agg(d.data order by d.created_at), '[]'::jsonb) into mirror
  from api.office_arb_decisions d
  where d.engagement_id = engagement_key and d.owner_id = current_row.owner_id;

  update api.office_engagements
  set data = jsonb_set(p_engagement, '{arbDecisions}', mirror, true),
      revision = revision + 1,
      updated_at = now()
  where id = engagement_key and project_id = project_key and owner_id = actor
    and revision = p_expected_revision
  returning * into saved;
  if not found then
    raise exception 'Conflicto de encargo: recarga antes de guardar' using errcode = 'P0001';
  end if;
  return saved;
end;
$$;
comment on function api.decide_engagement(text, jsonb, bigint, jsonb) is
  'Firma la decisión del ARB y transiciona el encargo en una sola transacción, con la revisión evaluada.';

revoke all on function api.decide_engagement(text, jsonb, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function api.decide_engagement(text, jsonb, bigint, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
