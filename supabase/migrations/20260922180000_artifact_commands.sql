-- F4-03 — El Artefacto se escribe con sus propios comandos (ADR-106).
--
-- Hasta aquí la única ruta de escritura era `api.save_project_aggregate`:
-- editar un artefacto enviaba y reescribía los N del proyecto, comparaba la
-- revisión **del proyecto** —así que dos ediciones de artefactos distintos
-- chocaban— y borraba cualquier artefacto que no viajara en la lista. F4-01 lo
-- midió; ADR-106 decidió que el Artefacto es raíz de su propio agregado.
--
-- Esta migración:
--
--   1. Extrae la validación de forma de un artefacto a `private`, para que la
--      ruta vieja y los comandos nuevos tengan **una** definición.
--   2. Añade un índice único `(project_id, version_group_id, version)`: A-02
--      («el versionado es monótono dentro de un grupo») deja de vivir sólo en
--      TypeScript.
--   3. Hace del contador y el índice del proyecto una **proyección** que
--      recalcula el servidor desde las filas, sin tocar la revisión del
--      proyecto: lo que cambió no es nada que el usuario del proyecto editara.
--   4. Crea `save_project` (sólo la raíz) y los comandos de artefacto:
--      `create_artifact`, `create_artifact_version`, `update_artifact`,
--      `delete_artifact` y `revise_artifacts` (varias versiones y borrados en
--      una transacción, por intención del usuario — ADR-106 §4).
--   5. Devuelve la revisión en las lecturas. **Defecto vivo que esto corrige**:
--      ni `load_project_aggregate` ni `list_project_aggregates` la incluían,
--      así que tras recargar el cliente creía que era 0 y la primera edición de
--      un proyecto existente recibía un `P0001` falso.
--   6. Pone una guarda en `save_project_aggregate` para proyectos existentes:
--      si la lista de artefactos difiere de la almacenada, rechaza con `P0001`
--      en vez de reescribir. **No es aditiva respecto a un cliente viejo**, y a
--      propósito: una pestaña abierta con el código anterior podría, si no,
--      borrar o pisar en silencio artefactos que la nueva escribió con sus
--      comandos. Un conflicto que pide recargar es la degradación correcta;
--      una pérdida silenciosa no. Aplicada sobre la base de la PoC con 0
--      proyectos (F4-01), la ventana no afecta a ningún dato.
--
-- La revisión de un artefacto viaja con el artefacto (el patrón de F2-10): la
-- lectura la superpone como `revision` y la escritura la quita del documento,
-- de modo que `data` nunca guarda una revisión que pueda quedarse vieja.

begin;

-- ───────────────────────────────────────────── 1. forma de un artefacto
create function private.artifact_shape_is_valid(p_artifact jsonb)
returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_artifact) = 'object'
    and btrim(coalesce(p_artifact ->> 'id', '')) <> ''
    and p_artifact ->> 'id' = btrim(p_artifact ->> 'id')
    and btrim(coalesce(p_artifact ->> 'name', '')) <> ''
    and coalesce(p_artifact ->> 'type', '') = any (array[
      'markdown', 'yaml', 'hybrid-text-diagram',
      'mermaid-c4-context', 'mermaid-c4-container', 'mermaid-c4-component',
      'mermaid-c4-deployment', 'mermaid-erd', 'mermaid-sequence', 'mermaid-graph',
      'mermaid-state', 'mermaid-gantt', 'react-flow-graph',
      'presentation-executive', 'presentation-technical', 'presentation-overview',
      'presentation-summary', 'sdd-brd', 'sdd-use-case', 'sdd-user-story',
      'sdd-domain-model', 'sdd-event-storming', 'sdd-glossary', 'sdd-nfr',
      'sdd-bdd', 'sdd-traceability'
    ])
    and btrim(coalesce(p_artifact ->> 'versionGroupId', '')) <> ''
    and jsonb_typeof(p_artifact -> 'version') = 'number'
    and (p_artifact ->> 'version')::numeric >= 1
    and btrim(coalesce(p_artifact ->> 'createdAt', '')) <> ''
    and btrim(coalesce(p_artifact ->> 'phase', '')) <> ''
    and coalesce(p_artifact ->> 'architecturalView', '') = any (array[
      'Vista de Contexto y Negocio', 'Vista Lógica y de Diseño', 'Vista de Datos',
      'Vista de Proceso e Interacción', 'Vista Física y de Despliegue',
      'Vista de Gestión y Soporte', 'Vista de Calidad y Validación', 'Vista SDD'
    ])
    and btrim(coalesce(p_artifact ->> 'content', '')) <> ''
    and btrim(coalesce(p_artifact ->> 'objective', '')) <> ''
    and coalesce(p_artifact ->> 'representation', '') in ('diagram', 'document', 'hybrid')
    and jsonb_typeof(p_artifact -> 'keyConcepts') = 'array'
    and not exists (
      select 1 from jsonb_array_elements(p_artifact -> 'keyConcepts') as concept
      where jsonb_typeof(concept) is distinct from 'object'
        or btrim(coalesce(concept ->> 'term', '')) = ''
        or btrim(coalesce(concept ->> 'definition', '')) = ''
    );
$$;
comment on function private.artifact_shape_is_valid(jsonb) is
  'El contrato mínimo de un artefacto. Una sola definición para la ruta compuesta y los comandos.';

create function private.assert_artifact_writable(p_artifact jsonb)
returns void
language plpgsql immutable set search_path = '' as $$
begin
  -- `coalesce`: una forma que ni siquiera es un objeto devuelve NULL en alguna
  -- comparación, y NULL no es «válido».
  if not coalesce(private.artifact_shape_is_valid(p_artifact), false) then
    raise exception 'Un artefacto del proyecto no tiene una forma válida' using errcode = '22023';
  end if;
  if jsonb_path_exists(p_artifact, '$.**.apiKey') then
    raise exception 'El agregado no puede contener apiKey' using errcode = '22023';
  end if;
end;
$$;

-- ─────────────────────────────── 2. versionado monótono por grupo (A-02)
alter table api.project_artifacts
  add column version_group_id text generated always as (data ->> 'versionGroupId') stored,
  add column version numeric generated always as ((data ->> 'version')::numeric) stored;

do $$
begin
  -- Falla cerrado: un índice único sobre datos duplicados no se crea, y la
  -- migración entera se aborta nombrando el problema en vez de dejarlo a medias.
  if exists (
    select 1 from api.project_artifacts
    group by project_id, version_group_id, version having count(*) > 1
  ) then
    raise exception 'Hay artefactos con la misma versión dentro de un grupo: reconcilíalos antes de aplicar F4-03';
  end if;
end;
$$;
create unique index project_artifacts_version_unique
  on api.project_artifacts (project_id, version_group_id, version);

-- ─────────────────────────────────── 3. el índice es una proyección
create function private.refresh_project_artifact_index(p_project_id text)
returns void
language plpgsql set search_path = '' as $$
begin
  -- Misma forma que calcula `save_project_aggregate`, pero desde las **filas**:
  -- el índice no puede discrepar de lo que hay, porque se deriva de ello.
  update api.architecture_projects project
  set artifact_count = rows.total,
      artifact_index = rows.idx,
      updated_at = now()
  from (
    select count(*)::integer as total,
           coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', data ->> 'id', 'name', data ->> 'name', 'type', data ->> 'type',
             'versionGroupId', data ->> 'versionGroupId', 'version', data -> 'version',
             'architecturalView', data -> 'architecturalView', 'phase', data -> 'phase',
             'createdAt', data -> 'createdAt', 'updatedAt', data -> 'updatedAt'
           )) order by data ->> 'id'), '[]'::jsonb) as idx
    from api.project_artifacts where project_id = p_project_id
  ) as rows
  where project.id = p_project_id;
end;
$$;

-- Bloquea la raíz para serializar escrituras concurrentes del índice, y
-- comprueba de paso que el proyecto existe y es del actor. `for no key update`
-- no estorba a quien sólo lee ni a las claves foráneas que la citan.
create function private.lock_owned_project(p_project_id text, p_actor uuid)
returns void
language plpgsql set search_path = '' as $$
declare
  owner uuid;
begin
  select owner_id into owner from api.architecture_projects
  where id = p_project_id for no key update;
  if not found then
    raise exception 'El proyecto no existe' using errcode = 'P0002';
  end if;
  if owner <> p_actor then
    raise exception 'El proyecto no pertenece a la sesión actual' using errcode = '42501';
  end if;
end;
$$;

create function private.assert_project_writer()
returns uuid
language plpgsql set search_path = '' as $$
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
  return actor;
end;
$$;

-- Inserta una versión nueva comprobando A-02. Supone la raíz ya bloqueada.
create function private.insert_artifact(p_project_id text, p_actor uuid, p_artifact jsonb, p_new_group boolean)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  document jsonb := p_artifact - 'revision';
  latest numeric;
  inserted api.project_artifacts;
begin
  perform private.assert_artifact_writable(document);
  select max(version) into latest from api.project_artifacts
  where project_id = p_project_id and version_group_id = document ->> 'versionGroupId';
  if p_new_group and latest is not null then
    raise exception 'El grupo de versiones ya existe: crea una versión nueva' using errcode = '23505';
  end if;
  if not p_new_group and latest is null then
    raise exception 'El grupo de versiones no existe en el proyecto' using errcode = 'P0002';
  end if;
  if (document ->> 'version')::numeric <> coalesce(latest, 0) + 1 then
    raise exception 'La versión ya no es la siguiente de su grupo: recarga antes de guardar' using errcode = 'P0001';
  end if;
  insert into api.project_artifacts as target (id, project_id, owner_id, data, revision)
  values (document ->> 'id', p_project_id, p_actor, document, 1)
  on conflict (id) do nothing
  returning target.* into inserted;
  if not found then
    raise exception 'El id de artefacto ya existe' using errcode = '23505';
  end if;
  return inserted.data || jsonb_build_object('revision', inserted.revision);
end;
$$;

-- ───────────────────────────────────────────── 4. los comandos
create function api.save_project(p_project jsonb, p_expected_revision bigint)
returns api.architecture_projects
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.assert_project_writer();
  saved api.architecture_projects;
  project_key text := btrim(coalesce(p_project ->> 'id', ''));
  project_name text := btrim(coalesce(p_project ->> 'name', ''));
  project_initiatives text[];
  locked_initiatives text[];
  normalized_project jsonb;
begin
  if jsonb_typeof(p_project) is distinct from 'object'
    or project_key = '' or p_project ->> 'id' <> project_key
    or project_name = '' or p_project ->> 'userId' is distinct from actor::text then
    raise exception 'El agregado de proyecto no tiene una forma válida' using errcode = '22023';
  end if;
  if p_expected_revision < 0 then
    raise exception 'La revisión esperada no puede ser negativa' using errcode = '22023';
  end if;
  if jsonb_path_exists(p_project, '$.**.apiKey') then
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
  -- Mismo bloqueo `for key share` que la ruta compuesta, por la misma razón
  -- (ver 20260920120000): comprobar y luego escribir sin él deja una ventana
  -- en la que la iniciativa se borra.
  select coalesce(array_agg(locked.id), '{}') into locked_initiatives
  from (
    select initiative.id from api.business_initiatives initiative
    where initiative.id = any (project_initiatives) and initiative.owner_id = actor
    for key share
  ) as locked;
  if cardinality(locked_initiatives) <> cardinality(project_initiatives) then
    raise exception 'El proyecto referencia una iniciativa inexistente o ajena' using errcode = '42501';
  end if;

  normalized_project := jsonb_set(
    p_project - 'artifacts' - 'artifactIndex' - 'artifactCount' - 'revision',
    '{initiativeIds}', to_jsonb(project_initiatives), true
  );
  insert into api.architecture_projects as target (
    id, owner_id, name, initiative_ids, data, artifact_count, artifact_index, revision
  ) values (
    project_key, actor, project_name, project_initiatives, normalized_project, 0, '[]'::jsonb, 1
  )
  on conflict (id) do update
    set name = excluded.name,
        initiative_ids = excluded.initiative_ids,
        data = excluded.data,
        revision = target.revision + 1,
        updated_at = now()
    where target.owner_id = actor and target.revision = p_expected_revision
  returning target.* into saved;
  if not found then
    raise exception 'Conflicto de proyecto: recarga antes de guardar' using errcode = 'P0001';
  end if;
  return saved;
end;
$$;
comment on function api.save_project(jsonb, bigint) is
  'Guarda sólo la raíz del proyecto, con revisión optimista. Nunca toca artefactos, contador ni índice (ADR-106).';

create function api.create_artifact(p_project_id text, p_artifact jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.assert_project_writer();
  created jsonb;
begin
  perform private.lock_owned_project(p_project_id, actor);
  created := private.insert_artifact(p_project_id, actor, p_artifact, true);
  perform private.refresh_project_artifact_index(p_project_id);
  return created;
end;
$$;
comment on function api.create_artifact(text, jsonb) is
  'Crea un artefacto en un grupo de versiones nuevo (versión 1). Mantiene el índice del proyecto.';

create function api.create_artifact_version(p_project_id text, p_artifact jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.assert_project_writer();
  created jsonb;
begin
  perform private.lock_owned_project(p_project_id, actor);
  created := private.insert_artifact(p_project_id, actor, p_artifact, false);
  perform private.refresh_project_artifact_index(p_project_id);
  return created;
end;
$$;
comment on function api.create_artifact_version(text, jsonb) is
  'Añade la versión siguiente de un grupo existente. Una versión que ya no es la siguiente recibe P0001.';

create function api.update_artifact(p_artifact_id text, p_expected_revision bigint, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.assert_project_writer();
  project_key text;
  current_row api.project_artifacts;
  merged jsonb;
begin
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'El cambio de artefacto no tiene una forma válida' using errcode = '22023';
  end if;
  select project_id into project_key from api.project_artifacts
  where id = p_artifact_id and owner_id = actor;
  if not found then
    raise exception 'El artefacto no existe' using errcode = 'P0002';
  end if;
  -- Orden fijo de bloqueo: raíz, después hijo. Todos los comandos lo siguen,
  -- así que dos no pueden esperarse en círculo.
  perform private.lock_owned_project(project_key, actor);
  select * into current_row from api.project_artifacts
  where id = p_artifact_id and project_id = project_key for update;
  if not found then
    raise exception 'El artefacto no existe' using errcode = 'P0002';
  end if;
  if current_row.revision <> p_expected_revision then
    raise exception 'Conflicto de artefacto: recarga antes de guardar' using errcode = 'P0001';
  end if;
  -- La identidad y la posición en el grupo no se editan: cambiar de versión es
  -- crear otra, y cambiar de id sería otro artefacto.
  merged := current_row.data || (p_patch - 'id' - 'versionGroupId' - 'version' - 'revision');
  perform private.assert_artifact_writable(merged);
  update api.project_artifacts
  set data = merged, revision = revision + 1, updated_at = now()
  where id = p_artifact_id
  returning * into current_row;
  perform private.refresh_project_artifact_index(project_key);
  return current_row.data || jsonb_build_object('revision', current_row.revision);
end;
$$;
comment on function api.update_artifact(text, bigint, jsonb) is
  'Edita un artefacto con la revisión del artefacto, no la del proyecto: dos ediciones de artefactos distintos no chocan.';

create function api.delete_artifact(p_artifact_id text, p_expected_revision bigint)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.assert_project_writer();
  project_key text;
  current_revision bigint;
begin
  select project_id into project_key from api.project_artifacts
  where id = p_artifact_id and owner_id = actor;
  -- Borrar lo que ya no está es un éxito: la intención se cumplió.
  if not found then
    return;
  end if;
  perform private.lock_owned_project(project_key, actor);
  select revision into current_revision from api.project_artifacts
  where id = p_artifact_id and project_id = project_key for update;
  if not found then
    return;
  end if;
  if current_revision <> p_expected_revision then
    raise exception 'Conflicto de artefacto: recarga antes de borrar' using errcode = 'P0001';
  end if;
  delete from api.project_artifacts where id = p_artifact_id;
  perform private.refresh_project_artifact_index(project_key);
end;
$$;
comment on function api.delete_artifact(text, bigint) is
  'Borra un artefacto con su revisión. Nunca borra otro: no recibe listas.';

create function api.revise_artifacts(p_project_id text, p_changes jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.assert_project_writer();
  change jsonb;
  created jsonb := '[]'::jsonb;
  current_revision bigint;
begin
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'Los cambios de artefactos no tienen una forma válida' using errcode = '22023';
  end if;
  perform private.lock_owned_project(p_project_id, actor);
  -- Una intención del usuario, una transacción: cualquier rechazo aborta todo,
  -- así que una sugerencia de consistencia nunca queda aplicada a medias.
  for change in select value from jsonb_array_elements(p_changes) as value loop
    case change ->> 'op'
      when 'create-version' then
        created := created || jsonb_build_array(
          private.insert_artifact(p_project_id, actor, change -> 'artifact', false));
      when 'delete' then
        select revision into current_revision from api.project_artifacts
        where id = change ->> 'artifactId' and project_id = p_project_id for update;
        if found then
          if jsonb_typeof(change -> 'expectedRevision') is distinct from 'number'
            or current_revision <> (change ->> 'expectedRevision')::bigint then
            raise exception 'Conflicto de artefacto: recarga antes de guardar' using errcode = 'P0001';
          end if;
          delete from api.project_artifacts where id = change ->> 'artifactId';
        end if;
      else
        raise exception 'Operación de artefacto desconocida' using errcode = '22023';
    end case;
  end loop;
  perform private.refresh_project_artifact_index(p_project_id);
  return created;
end;
$$;
comment on function api.revise_artifacts(text, jsonb) is
  'Varias versiones nuevas y borrados en una transacción: atómico por intención del usuario, no una frontera de agregado (ADR-106 §4).';

-- ─────────────────────────── 5. la revisión viaja en las lecturas
create or replace function api.load_project_aggregate(p_id text)
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
  select coalesce(jsonb_agg(data || jsonb_build_object('revision', revision) order by id), '[]'::jsonb)
  into artifacts
  from api.project_artifacts where project_id = p_id and owner_id = actor;
  return project.data || jsonb_build_object(
    'artifacts', artifacts,
    'artifactIndex', project.artifact_index,
    'artifactCount', project.artifact_count,
    'updatedAt', project.updated_at,
    'revision', project.revision
  );
end;
$$;

create or replace function api.list_project_aggregates()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select coalesce(jsonb_agg(
    project.data || jsonb_build_object(
      'artifacts', '[]'::jsonb,
      'artifactIndex', project.artifact_index,
      'artifactCount', project.artifact_count,
      'updatedAt', project.updated_at,
      'revision', project.revision
    )
    order by project.updated_at desc
  ), '[]'::jsonb)
  into result
  from api.architecture_projects project
  where project.owner_id = actor;
  return result;
end;
$$;

-- ──────────────── 6. la ruta compuesta: una definición y una guarda
create or replace function api.save_project_aggregate(
  p_project jsonb,
  p_artifacts jsonb,
  p_expected_revision bigint
)
returns api.architecture_projects
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.assert_project_writer();
  saved api.architecture_projects;
  project_key text := btrim(coalesce(p_project ->> 'id', ''));
  incoming jsonb;
  stored jsonb;
  artifact jsonb;
  expected_count integer;
begin
  if jsonb_typeof(p_artifacts) is distinct from 'array' then
    raise exception 'El agregado de proyecto no tiene una forma válida' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(value - 'revision' order by value ->> 'id'), '[]'::jsonb)
  into incoming from jsonb_array_elements(p_artifacts) as value;

  for artifact in select value from jsonb_array_elements(incoming) as value loop
    perform private.assert_artifact_writable(artifact);
  end loop;
  select count(*)::integer into expected_count from jsonb_array_elements(incoming);
  if expected_count <> (
    select count(distinct value ->> 'id')::integer from jsonb_array_elements(incoming) as value
  ) then
    raise exception 'Los identificadores de artefacto deben ser únicos' using errcode = '22023';
  end if;

  if p_expected_revision > 0 then
    -- La guarda de la transición (cabecera, punto 6): sobre un proyecto que ya
    -- existe, esta ruta sólo puede guardar la raíz. Una lista que no coincide
    -- con lo almacenado es la de un cliente viejo, y reescribirla podría borrar
    -- o pisar lo que otro escribió con los comandos.
    select coalesce(jsonb_agg(data order by id), '[]'::jsonb) into stored
    from api.project_artifacts where project_id = project_key and owner_id = actor;
    if stored is distinct from incoming then
      raise exception 'Los artefactos se guardan con sus propios comandos: recarga la aplicación' using errcode = 'P0001';
    end if;
    return api.save_project(p_project, p_expected_revision);
  end if;

  -- Creación: la raíz y sus artefactos iniciales, en una transacción.
  saved := api.save_project(p_project, 0);
  for artifact in select value from jsonb_array_elements(incoming) as value loop
    insert into api.project_artifacts (id, project_id, owner_id, data, revision)
    values (artifact ->> 'id', project_key, actor, artifact, 1)
    on conflict (id) do nothing;
    if not found then
      raise exception 'El id de artefacto ya pertenece a otro proyecto' using errcode = '23505';
    end if;
  end loop;
  perform private.refresh_project_artifact_index(project_key);
  select * into saved from api.architecture_projects where id = project_key;
  return saved;
end;
$$;
comment on function api.save_project_aggregate(jsonb, jsonb, bigint) is
  'Ruta de transición (ADR-106 §5): crea un proyecto con sus artefactos iniciales; sobre uno existente sólo guarda la raíz y rechaza una lista distinta de la almacenada. Se retira en F4-06.';

-- ────────────────────────────────────────────────────────── privilegios
revoke all on function private.artifact_shape_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.assert_artifact_writable(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.refresh_project_artifact_index(text) from public, anon, authenticated, service_role;
revoke all on function private.lock_owned_project(text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.assert_project_writer() from public, anon, authenticated, service_role;
revoke all on function private.insert_artifact(text, uuid, jsonb, boolean) from public, anon, authenticated, service_role;

revoke all on function api.save_project(jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function api.create_artifact(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function api.create_artifact_version(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function api.update_artifact(text, bigint, jsonb) from public, anon, authenticated, service_role;
revoke all on function api.delete_artifact(text, bigint) from public, anon, authenticated, service_role;
revoke all on function api.revise_artifacts(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function api.load_project_aggregate(text) from public, anon, authenticated, service_role;
revoke all on function api.list_project_aggregates() from public, anon, authenticated, service_role;
revoke all on function api.save_project_aggregate(jsonb, jsonb, bigint) from public, anon, authenticated, service_role;

grant execute on function api.save_project(jsonb, bigint) to authenticated;
grant execute on function api.create_artifact(text, jsonb) to authenticated;
grant execute on function api.create_artifact_version(text, jsonb) to authenticated;
grant execute on function api.update_artifact(text, bigint, jsonb) to authenticated;
grant execute on function api.delete_artifact(text, bigint) to authenticated;
grant execute on function api.revise_artifacts(text, jsonb) to authenticated;
grant execute on function api.load_project_aggregate(text) to authenticated;
grant execute on function api.list_project_aggregates() to authenticated;
grant execute on function api.save_project_aggregate(jsonb, jsonb, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
