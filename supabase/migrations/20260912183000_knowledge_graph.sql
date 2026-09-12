-- F5 / Corte 5 — Grafo de conocimiento arquitectónico (AKG).
--
-- Un proyecto tiene exactamente un grafo; es derivado y reconciliado desde
-- proyectos y artefactos, así que no exige la raíz del proyecto migrada: el
-- enlace es textual con auth.uid() como frontera. La ruta real de Firestore es
-- projects/{id}/aggregates/architectureGraph; aquí es una fila por proyecto.
begin;

create table api.architecture_knowledge_graphs (
  project_id text primary key check (btrim(project_id) <> ''),
  owner_id uuid not null references auth.users(id) on delete restrict,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint architecture_knowledge_graphs_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint architecture_knowledge_graphs_no_api_key check (not jsonb_path_exists(data, '$.**.apiKey'))
);
comment on table api.architecture_knowledge_graphs is
  'Grafo de conocimiento arquitectónico canónico de un proyecto: una fila por proyecto, reconstruible desde proyectos y artefactos.';
create index architecture_knowledge_graphs_owner_idx on api.architecture_knowledge_graphs (owner_id, updated_at desc);

alter table api.architecture_knowledge_graphs enable row level security;

create function api.save_knowledge_graph(
  p_project_id text,
  p_graph jsonb,
  p_expected_revision bigint
)
returns api.architecture_knowledge_graphs
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved api.architecture_knowledge_graphs;
  project_key text := btrim(coalesce(p_project_id, ''));
  graph_key text := btrim(coalesce(p_graph ->> 'projectId', ''));
  entity jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('project:write') then
    raise exception 'Permiso insuficiente: project:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if project_key = '' or graph_key = '' or project_key <> graph_key
    or jsonb_typeof(p_graph) is distinct from 'object'
    or jsonb_typeof(p_graph -> 'entities') is distinct from 'array'
    or jsonb_typeof(p_graph -> 'relations') is distinct from 'array'
    or btrim(coalesce(p_graph ->> 'buildId', '')) = ''
    or jsonb_typeof(p_graph -> 'quality') is distinct from 'object'
    or jsonb_typeof(p_graph -> 'statistics') is distinct from 'object' then
    raise exception 'El grafo no tiene una forma válida' using errcode = '22023';
  end if;
  if jsonb_path_exists(p_graph, '$.**.apiKey') then
    raise exception 'El grafo no puede contener apiKey' using errcode = '22023';
  end if;

  -- Cada entidad y relación declaran proyecto e identidad: el grafo es
  -- evidencia, no prosa. Un nodo sin id, nombre/tipo (entidad) o
  -- extremos/tipo (relación) no entra.
  for entity in
    select value from jsonb_array_elements(p_graph -> 'entities')
  loop
    if jsonb_typeof(entity) is distinct from 'object'
      or btrim(coalesce(entity ->> 'id', '')) = ''
      or btrim(coalesce(entity ->> 'name', '')) = ''
      or btrim(coalesce(entity ->> 'type', '')) = ''
      or jsonb_typeof(entity -> 'sourceRefs') is distinct from 'array' then
      raise exception 'Una entidad del grafo no tiene una forma válida' using errcode = '22023';
    end if;
  end loop;
  for entity in
    select value from jsonb_array_elements(p_graph -> 'relations')
  loop
    if jsonb_typeof(entity) is distinct from 'object'
      or btrim(coalesce(entity ->> 'id', '')) = ''
      or btrim(coalesce(entity ->> 'sourceEntityId', '')) = ''
      or btrim(coalesce(entity ->> 'targetEntityId', '')) = ''
      or btrim(coalesce(entity ->> 'type', '')) = ''
      or jsonb_typeof(entity -> 'sourceRefs') is distinct from 'array' then
      raise exception 'Una relación del grafo no tiene una forma válida' using errcode = '22023';
    end if;
  end loop;

  insert into api.architecture_knowledge_graphs as target (project_id, owner_id, data, revision)
  values (project_key, actor, p_graph, 1)
  on conflict (project_id) do update
    set data = excluded.data,
        revision = target.revision + 1,
        updated_at = now()
    where target.owner_id = actor and target.revision = p_expected_revision
  returning target.* into saved;
  if not found then
    raise exception 'Conflicto de grafo: recarga antes de guardar' using errcode = 'P0001';
  end if;
  return saved;
end;
$$;

create function api.load_knowledge_graph(p_project_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  row api.architecture_knowledge_graphs;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select * into row from api.architecture_knowledge_graphs
  where project_id = btrim(coalesce(p_project_id, '')) and owner_id = actor;
  if not found then
    raise exception 'El grafo no existe' using errcode = 'P0002';
  end if;
  return row.data || jsonb_build_object('revision', row.revision, 'updatedAt', row.updated_at);
end;
$$;

revoke all on table api.architecture_knowledge_graphs from public, anon, authenticated, service_role;
revoke all on function api.save_knowledge_graph(text, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function api.load_knowledge_graph(text) from public, anon, authenticated, service_role;
grant execute on function api.save_knowledge_graph(text, jsonb, bigint) to authenticated;
grant execute on function api.load_knowledge_graph(text) to authenticated;

notify pgrst, 'reload schema';
commit;