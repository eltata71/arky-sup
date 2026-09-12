-- Correcciones de integridad del corte F5.5 ya aplicado.
-- La migración previa permanece inmutable porque ya forma parte del historial remoto.
begin;

alter table api.architecture_projects
  add constraint architecture_projects_data_has_no_api_key
  check (not jsonb_path_exists(data, '$.**.apiKey'));
alter table api.project_artifacts
  add constraint project_artifacts_data_has_no_api_key
  check (not jsonb_path_exists(data, '$.**.apiKey'));

create or replace function api.save_project_aggregate(
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
  normalized_project jsonb;
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

  if jsonb_typeof(p_project) is distinct from 'object'
    or jsonb_typeof(p_artifacts) is distinct from 'array'
    or project_key = '' or p_project ->> 'id' <> project_key
    or project_name = '' or p_project ->> 'userId' is distinct from actor::text then
    raise exception 'El agregado de proyecto no tiene una forma válida' using errcode = '22023';
  end if;
  if p_expected_revision < 0 then
    raise exception 'La revisión esperada no puede ser negativa' using errcode = '22023';
  end if;
  if jsonb_path_exists(p_project, '$.**.apiKey') or jsonb_path_exists(p_artifacts, '$.**.apiKey') then
    raise exception 'El agregado no puede contener apiKey' using errcode = '22023';
  end if;
  if jsonb_typeof(p_project -> 'initiativeIds') is distinct from 'array' then
    raise exception 'El proyecto requiere al menos una iniciativa' using errcode = '22023';
  end if;

  select array_agg(distinct btrim(value) order by btrim(value)) into project_initiatives
  from jsonb_array_elements_text(p_project -> 'initiativeIds') as value
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

  -- Todos los hijos se validan antes de tocar padre, índice o contador.
  for artifact in select value from jsonb_array_elements(p_artifacts) as value loop
    artifact_id := btrim(coalesce(artifact ->> 'id', ''));
    if jsonb_typeof(artifact) is distinct from 'object'
      or artifact_id = '' or artifact ->> 'id' <> artifact_id
      or btrim(coalesce(artifact ->> 'name', '')) = ''
      or btrim(coalesce(artifact ->> 'type', '')) = ''
      or btrim(coalesce(artifact ->> 'versionGroupId', '')) = ''
      or jsonb_typeof(artifact -> 'version') is distinct from 'number'
      or btrim(coalesce(artifact ->> 'createdAt', '')) = ''
      or btrim(coalesce(artifact ->> 'phase', '')) = ''
      or btrim(coalesce(artifact ->> 'architecturalView', '')) = ''
      or btrim(coalesce(artifact ->> 'content', '')) = ''
      or btrim(coalesce(artifact ->> 'objective', '')) = ''
      or coalesce(artifact ->> 'representation', '') not in ('diagram', 'document', 'hybrid')
      or jsonb_typeof(artifact -> 'keyConcepts') is distinct from 'array' then
      raise exception 'Un artefacto del proyecto no tiene una forma válida' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(artifact -> 'keyConcepts') as concept
      where jsonb_typeof(concept) is distinct from 'object'
        or btrim(coalesce(concept ->> 'term', '')) = ''
        or btrim(coalesce(concept ->> 'definition', '')) = ''
    ) then
      raise exception 'Un artefacto del proyecto no tiene una forma válida' using errcode = '22023';
    end if;
  end loop;
  select count(*)::integer into expected_count from jsonb_array_elements(p_artifacts);
  if expected_count <> (
    select count(distinct btrim(value ->> 'id'))::integer from jsonb_array_elements(p_artifacts) as value
  ) then
    raise exception 'Los identificadores de artefacto deben ser únicos' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', value ->> 'id', 'name', value ->> 'name', 'type', value ->> 'type',
    'versionGroupId', value ->> 'versionGroupId', 'version', value -> 'version',
    'architecturalView', value -> 'architecturalView', 'phase', value -> 'phase',
    'createdAt', value -> 'createdAt', 'updatedAt', value -> 'updatedAt'
  )) order by value ->> 'id'), '[]'::jsonb) into artifact_index
  from jsonb_array_elements(p_artifacts) as value;
  normalized_project := jsonb_set(
    p_project - 'artifacts' - 'artifactIndex' - 'artifactCount',
    '{initiativeIds}', to_jsonb(project_initiatives), true
  );

  insert into api.architecture_projects as target (
    id, owner_id, name, initiative_ids, data, artifact_count, artifact_index, revision
  ) values (
    project_key, actor, project_name, project_initiatives,
    normalized_project, expected_count, artifact_index, 1
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

notify pgrst, 'reload schema';
commit;
