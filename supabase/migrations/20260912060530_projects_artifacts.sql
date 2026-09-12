-- F5.5 / Corte 3 — Proyecto de arquitectura y artefactos como agregado compuesto.
--
-- Un proyecto no se activa sin sus artefactos: cada mutación de éstos debe dejar
-- consistentes el hijo, artifact_count y artifact_index. Los identificadores de
-- proyecto/iniciativa/artefacto se preservan como texto durante la transición.
begin;

create table api.architecture_projects (
  id text primary key check (btrim(id) <> ''),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  initiative_ids text[] not null check (cardinality(initiative_ids) > 0),
  data jsonb not null,
  artifact_count integer not null default 0 check (artifact_count >= 0),
  artifact_index jsonb not null default '[]'::jsonb check (jsonb_typeof(artifact_index) = 'array'),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint architecture_projects_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint architecture_projects_data_matches_identity check (
    data ->> 'id' = id and data ->> 'userId' = owner_id::text
  )
);
comment on table api.architecture_projects is
  'Raíz del agregado Proyecto/Atención. Se activa junto con project_artifacts y artifact_index.';
create index architecture_projects_owner_updated_idx on api.architecture_projects (owner_id, updated_at desc);
create index architecture_projects_initiatives_idx on api.architecture_projects using gin (initiative_ids);

create table api.project_artifacts (
  id text primary key check (btrim(id) <> ''),
  project_id text not null references api.architecture_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_artifacts_data_matches_identity check (data ->> 'id' = id)
);
comment on table api.project_artifacts is
  'Entidades artefacto del agregado de proyecto. La RPC compuesta mantiene contador e índice del padre.';
create index project_artifacts_project_idx on api.project_artifacts (project_id, updated_at desc);

alter table api.architecture_projects enable row level security;
alter table api.project_artifacts enable row level security;

create function api.save_project_aggregate(
  p_project jsonb,
  p_artifacts jsonb,
  p_expected_revision bigint
)
returns api.architecture_projects
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved api.architecture_projects;
  project_key text := btrim(coalesce(p_project ->> 'id', ''));
  project_name text := btrim(coalesce(p_project ->> 'name', ''));
  project_initiatives text[];
  artifact jsonb;
  artifact_id text;
  artifact_index jsonb;
  expected_count integer;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('project:write') then
    raise exception 'Permiso insuficiente: project:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  if jsonb_typeof(p_project) <> 'object' or jsonb_typeof(p_artifacts) <> 'array'
    or project_key = '' or project_name = '' or p_project ->> 'userId' is distinct from actor::text then
    raise exception 'El agregado de proyecto no tiene una forma válida' using errcode = '22023';
  end if;
  if p_expected_revision < 0 then
    raise exception 'La revisión esperada no puede ser negativa' using errcode = '22023';
  end if;
  select array_agg(distinct value order by value) into project_initiatives
  from jsonb_array_elements_text(coalesce(p_project -> 'initiativeIds', '[]'::jsonb)) as value
  where btrim(value) <> '';
  if coalesce(cardinality(project_initiatives), 0) = 0 then
    raise exception 'El proyecto requiere al menos una iniciativa' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(project_initiatives) as initiative_id
    where not exists (
      select 1 from api.business_initiatives initiative
      where initiative.id = initiative_id and initiative.owner_id = actor
    )
  ) then
    raise exception 'El proyecto referencia una iniciativa inexistente o ajena' using errcode = '42501';
  end if;

  -- Valida antes de cualquier escritura: una entrada inválida nunca deja el
  -- padre actualizado con sólo una parte de los hijos.
  for artifact in select value from jsonb_array_elements(p_artifacts) as value loop
    artifact_id := btrim(coalesce(artifact ->> 'id', ''));
    if jsonb_typeof(artifact) <> 'object' or artifact_id = ''
      or btrim(coalesce(artifact ->> 'name', '')) = ''
      or btrim(coalesce(artifact ->> 'type', '')) = ''
      or btrim(coalesce(artifact ->> 'versionGroupId', '')) = ''
      or jsonb_typeof(artifact -> 'version') <> 'number' then
      raise exception 'Un artefacto del proyecto no tiene una forma válida' using errcode = '22023';
    end if;
  end loop;
  select count(*)::integer into expected_count from jsonb_array_elements(p_artifacts);
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', value ->> 'id', 'name', value ->> 'name', 'type', value ->> 'type',
    'versionGroupId', value ->> 'versionGroupId', 'version', value -> 'version',
    'architecturalView', value -> 'architecturalView', 'phase', value -> 'phase',
    'createdAt', value -> 'createdAt', 'updatedAt', value -> 'updatedAt'
  )) order by value ->> 'id'), '[]'::jsonb) into artifact_index
  from jsonb_array_elements(p_artifacts) as value;

  insert into api.architecture_projects as target (
    id, owner_id, name, initiative_ids, data, artifact_count, artifact_index, revision
  ) values (
    project_key, actor, project_name, project_initiatives,
    p_project - 'artifacts' - 'artifactIndex' - 'artifactCount', expected_count, artifact_index, 1
  )
  on conflict (id) do update
    set name = excluded.name,
        initiative_ids = excluded.initiative_ids,
        data = excluded.data,
        artifact_count = excluded.artifact_count,
        artifact_index = excluded.artifact_index,
        revision = target.revision + 1,
        updated_at = now()
    where target.owner_id = actor and target.revision = p_expected_revision
  returning target.* into saved;
  if not found then
    raise exception 'Conflicto de proyecto: recarga antes de guardar' using errcode = 'P0001';
  end if;

  for artifact in select value from jsonb_array_elements(p_artifacts) as value loop
    artifact_id := artifact ->> 'id';
    insert into api.project_artifacts as target (id, project_id, owner_id, data, revision)
    values (artifact_id, project_key, actor, artifact, 1)
    on conflict (id) do update
      set project_id = excluded.project_id,
          owner_id = excluded.owner_id,
          data = excluded.data,
          revision = target.revision + 1,
          updated_at = now()
      where target.project_id = project_key and target.owner_id = actor;
    if not found then
      raise exception 'El id de artefacto ya pertenece a otro proyecto' using errcode = '23505';
    end if;
  end loop;
  delete from api.project_artifacts existing
  where existing.project_id = project_key and existing.owner_id = actor
    and not exists (
      select 1 from jsonb_array_elements(p_artifacts) as current
      where current ->> 'id' = existing.id
    );
  return saved;
end;
$$;
comment on function api.save_project_aggregate(jsonb, jsonb, bigint) is
  'Guarda raíz, artefactos, contador e índice en una transacción con revisión optimista.';

create function api.load_project_aggregate(p_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  project api.architecture_projects;
  artifacts jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select * into project from api.architecture_projects where id = p_id;
  if not found then
    raise exception 'El proyecto no existe' using errcode = 'P0002';
  end if;
  if project.owner_id <> actor then
    raise exception 'El proyecto no pertenece a la sesión actual' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(data order by id), '[]'::jsonb) into artifacts
  from api.project_artifacts where project_id = p_id and owner_id = actor;
  return project.data || jsonb_build_object(
    'artifacts', artifacts,
    'artifactIndex', project.artifact_index,
    'artifactCount', project.artifact_count,
    'updatedAt', project.updated_at
  );
end;
$$;
comment on function api.load_project_aggregate(text) is
  'Hidrata un proyecto propio con sus artefactos; no expone la tabla directamente.';

revoke all on table api.architecture_projects from public, anon, authenticated, service_role;
revoke all on table api.project_artifacts from public, anon, authenticated, service_role;
revoke all on function api.save_project_aggregate(jsonb, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function api.load_project_aggregate(text) from public, anon, authenticated, service_role;
grant execute on function api.save_project_aggregate(jsonb, jsonb, bigint) to authenticated;
grant execute on function api.load_project_aggregate(text) to authenticated;

notify pgrst, 'reload schema';
commit;
