-- F5-04 — Outbox transaccional para la proyección del grafo de conocimiento.
--
-- H11: el grafo de conocimiento es una proyección derivada de los artefactos, y
-- su única ruta de actualización era un `setTimeout` de 2,5 s en el navegador.
-- Cerrar la pestaña dentro de esa ventana perdía la reconstrucción, **nada
-- registraba que quedó pendiente**, y ninguna ruta la recuperaba al volver.
--
-- Esta migración hace del trabajo pendiente un **hecho de la base de datos**:
--
--   1. `api.projection_outbox` — una fila por (proyecto, proyección). Un
--      contador `generation` sube con cada cambio de la fuente; la proyección
--      está al día cuando `processed_generation` lo alcanza. Muchas ediciones
--      seguidas se agrupan en un solo pendiente, no en N.
--   2. Un disparador sobre `api.project_artifacts` que encola **en la misma
--      transacción** que escribe el artefacto: si la escritura se confirma, el
--      pendiente existe; si se revierte, tampoco existe. Encola sólo si el
--      proyecto ya tiene grafo — la regla del cliente, que nunca inicia un
--      grafo como efecto colateral de abrir un proyecto antiguo.
--   3. `list_pending_projections` — lo que falta, con intentos y último error:
--      el pendiente es observable.
--   4. `save_graph_projection` — guarda el grafo **y** marca su generación como
--      procesada en una sola transacción. Una generación ya procesada no se
--      vuelve a escribir (reprocesar no duplica) y una anterior a la procesada
--      tampoco (un evento viejo no pisa una proyección más nueva).
--   5. `fail_projection` — anota el intento fallido sin tocar el grafo.
--
-- Compatibilidad. Aditiva respecto a la aplicación en ejecución: ninguna RPC
-- existente cambia, y el disparador sólo inserta en una tabla nueva. Un cliente
-- anterior sigue funcionando y deja pendientes que el nuevo recuperará.
--
-- Reversión. `drop trigger project_artifacts_enqueue_graph_projection on
-- api.project_artifacts;`, `drop trigger architecture_knowledge_graphs_forget_projection
-- on api.architecture_knowledge_graphs;` y `drop table api.projection_outbox
-- cascade;` más las cinco funciones. No hay datos que migrar de vuelta: la tabla sólo contiene
-- trabajo pendiente, que se puede reconstruir recalculando el grafo.

begin;

-- ───────────────────────────────────────────── 1. la bitácora de pendientes
create table api.projection_outbox (
  project_id text not null check (btrim(project_id) <> ''),
  projection text not null check (projection in ('knowledge-graph')),
  owner_id uuid not null references auth.users(id) on delete cascade,
  generation bigint not null default 1 check (generation >= 0),
  processed_generation bigint not null default 0 check (processed_generation >= 0),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  primary key (project_id, projection),
  constraint projection_outbox_processed_not_ahead check (processed_generation <= generation)
);
comment on table api.projection_outbox is
  'Trabajo de proyección pendiente (F5-04): una fila por proyecto y proyección; pendiente mientras generation > processed_generation.';
create index projection_outbox_pending_idx on api.projection_outbox (owner_id, requested_at)
  where generation > processed_generation;

alter table api.projection_outbox enable row level security;

-- ───────────────────────────────────────────── 2. encolar en la transacción
create function private.enqueue_graph_projection()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  source_project text;
  source_owner uuid;
begin
  if tg_op = 'DELETE' then
    source_project := old.project_id;
    source_owner := old.owner_id;
  else
    source_project := new.project_id;
    source_owner := new.owner_id;
  end if;
  -- Sólo proyectos que ya tienen grafo: iniciar uno es una decisión, no un
  -- efecto colateral de escribir un artefacto.
  if not exists (
    select 1 from api.architecture_knowledge_graphs graph
    where graph.project_id = source_project and graph.owner_id = source_owner
  ) then
    return null;
  end if;
  insert into api.projection_outbox as target (project_id, projection, owner_id, generation, processed_generation)
  values (source_project, 'knowledge-graph', source_owner, 1, 0)
  on conflict (project_id, projection) do update
    set generation = target.generation + 1,
        requested_at = now();
  return null;
end;
$$;

create trigger project_artifacts_enqueue_graph_projection
  after insert or update or delete on api.project_artifacts
  for each row execute function private.enqueue_graph_projection();

-- Sin grafo no hay proyección que mantener: borrar el grafo —también al
-- borrar el proyecto, que lo quita antes que la raíz— borra su pendiente, en
-- vez de dejar uno huérfano que nadie podría procesar.
create function private.forget_graph_projection()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from api.projection_outbox
  where project_id = old.project_id and projection = 'knowledge-graph' and owner_id = old.owner_id;
  return null;
end;
$$;

create trigger architecture_knowledge_graphs_forget_projection
  after delete on api.architecture_knowledge_graphs
  for each row execute function private.forget_graph_projection();

-- ───────────────────────────────────────────── 3. lo que falta, observable
create function api.list_pending_projections()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'projectId', outbox.project_id,
      'projection', outbox.projection,
      'generation', outbox.generation,
      'processedGeneration', outbox.processed_generation,
      'requestedAt', outbox.requested_at,
      'attempts', outbox.attempts,
      'lastError', outbox.last_error
    ) order by outbox.requested_at)
    from api.projection_outbox outbox
    where outbox.owner_id = actor and outbox.generation > outbox.processed_generation
  ), '[]'::jsonb);
end;
$$;

-- ───────────────────────────────────────────── 4. guardar y marcar, a la vez
create function api.save_graph_projection(
  p_project_id text,
  p_graph jsonb,
  p_generation bigint
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  project_key text := btrim(coalesce(p_project_id, ''));
  outbox api.projection_outbox;
  current_revision bigint;
  saved api.architecture_knowledge_graphs;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('project:write') then
    raise exception 'Permiso insuficiente: project:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if project_key = '' or p_generation is null or p_generation < 1 then
    raise exception 'La proyección no tiene una generación válida' using errcode = '22023';
  end if;

  -- El bloqueo serializa dos pestañas que procesan el mismo pendiente.
  select * into outbox from api.projection_outbox
  where project_id = project_key and projection = 'knowledge-graph' and owner_id = actor
  for update;
  if not found then
    raise exception 'No hay proyección pendiente para ese proyecto' using errcode = 'P0002';
  end if;
  if p_generation > outbox.generation then
    raise exception 'La generación no existe todavía' using errcode = '22023';
  end if;
  if p_generation <= outbox.processed_generation then
    -- Ya procesada, o anterior a lo procesado: no se escribe nada.
    return jsonb_build_object(
      'applied', false,
      'reason', case when p_generation = outbox.processed_generation then 'already-processed' else 'stale' end,
      'generation', outbox.generation,
      'processedGeneration', outbox.processed_generation,
      'pending', outbox.generation > outbox.processed_generation
    );
  end if;

  select revision into current_revision from api.architecture_knowledge_graphs
  where project_id = project_key and owner_id = actor
  for update;
  -- Misma validación y misma escritura que el guardado manual: una definición.
  saved := api.save_knowledge_graph(project_key, p_graph, coalesce(current_revision, 0));

  update api.projection_outbox
  set processed_generation = p_generation,
      processed_at = now(),
      attempts = 0,
      last_error = null
  where project_id = project_key and projection = 'knowledge-graph'
  returning * into outbox;

  return jsonb_build_object(
    'applied', true,
    'revision', saved.revision,
    'generation', outbox.generation,
    'processedGeneration', outbox.processed_generation,
    'pending', outbox.generation > outbox.processed_generation
  );
end;
$$;

-- ───────────────────────────────────────────── 5. anotar un fallo
create function api.fail_projection(
  p_project_id text,
  p_generation bigint,
  p_error text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  outbox api.projection_outbox;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('project:write') then
    raise exception 'Permiso insuficiente: project:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  update api.projection_outbox
  set attempts = attempts + 1,
      last_error = left(coalesce(nullif(btrim(p_error), ''), 'Error desconocido'), 500)
  where project_id = btrim(coalesce(p_project_id, ''))
    and projection = 'knowledge-graph'
    and owner_id = actor
    and p_generation > processed_generation
  returning * into outbox;
  if not found then
    return jsonb_build_object('recorded', false);
  end if;
  return jsonb_build_object('recorded', true, 'attempts', outbox.attempts);
end;
$$;

-- ───────────────────────────────────────────── superficie
revoke all on table api.projection_outbox from public, anon, authenticated, service_role;
revoke all on function private.enqueue_graph_projection() from public, anon, authenticated, service_role;
revoke all on function private.forget_graph_projection() from public, anon, authenticated, service_role;
revoke all on function api.list_pending_projections() from public, anon, authenticated, service_role;
revoke all on function api.save_graph_projection(text, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function api.fail_projection(text, bigint, text) from public, anon, authenticated, service_role;
grant execute on function api.list_pending_projections() to authenticated;
grant execute on function api.save_graph_projection(text, jsonb, bigint) to authenticated;
grant execute on function api.fail_projection(text, bigint, text) to authenticated;

notify pgrst, 'reload schema';
commit;
