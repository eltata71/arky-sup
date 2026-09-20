-- Dos guardas que existían a medias, y por la misma razón en ambos casos: una
-- guarda nueva se añadió al lado de la vieja en vez de reemplazarla.
--
-- 1. `api.delete_engagement(text, text)` — la firma **de dos argumentos**, creada
--    en 20260912170000 y concedida a `authenticated`, sigue viva. La migración
--    20260912181347 añadió `api.delete_engagement(text, text, bigint)` con la
--    comparación de revisión, pero `create or replace function` con una lista de
--    argumentos distinta **crea una sobrecarga**, no reemplaza nada. Y ninguna
--    migración de este repositorio contiene un solo `drop function`.
--
--    El resultado es que la guarda optimista que aquella migración añadió es
--    opcional: un cliente que llame a la firma de dos argumentos por PostgREST
--    borra un encargo sin comparar revisión, que es exactamente el borrado desde
--    una vista obsoleta que se quiso impedir. Una guarda que se evita llamando a
--    la puerta de al lado no es una guarda.
--
-- 2. La referencia proyecto → iniciativa se valida **al escribir el proyecto** y
--    no al borrar la iniciativa. `api.delete_business_initiative` borra sin mirar
--    quién la cita, mientras `api.save_project_aggregate` exige que exista:
--
--        raise exception 'El proyecto referencia una iniciativa inexistente o ajena'
--          using errcode = '42501';
--
--    Las dos mitades juntas no dejan una referencia colgante inofensiva: dejan un
--    proyecto **imposible de guardar**, que falla con un 42501 y se lee en
--    pantalla como «permiso insuficiente». Un fallo de integridad referencial
--    disfrazado de fallo de autorización manda a quien lo investiga al sitio
--    equivocado, y es de los caros de diagnosticar.
--
--    La regla del dominio dice que el nivel padre es obligatorio y que una
--    atención sin iniciativa es el `orphan-attention` que el grafo reporta.
--    Borrar el padre por detrás era la forma que quedaba de crear uno.
--
-- Las dos mitades de (2) van en la misma migración a propósito: comprobar sin
-- bloquear deja una ventana entre la comprobación y la escritura, y cerrarla
-- exige tocar los dos lados. `for key share` en quien referencia y el bloqueo
-- implícito del `delete` en quien es referenciado son exactamente el mecanismo
-- de una clave foránea real, escrito a mano porque el enlace vive dentro de una
-- columna de array y no de una restricción declarativa.
--
-- Aditiva: las migraciones anteriores ya están aplicadas.
begin;

-- ───────────────────────────────────────────── 1. la sobrecarga sin revisión
-- El único llamante del repositorio (`SupabaseOfficeEngagementRepository`) pasa
-- siempre tres argumentos, así que esto no retira ninguna ruta en uso: retira la
-- que nadie usa y cualquiera puede llamar.
revoke all on function api.delete_engagement(text, text) from public, anon, authenticated, service_role;
drop function if exists api.delete_engagement(text, text);

-- ──────────────────────── 2a. quien referencia bloquea lo referenciado
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
  locked_initiatives text[];
  normalized_project jsonb;
  artifact jsonb;
  artifact_id text;
  artifact_index jsonb;
  expected_count integer;
  artifact_types constant text[] := array[
    'markdown', 'yaml', 'hybrid-text-diagram',
    'mermaid-c4-context', 'mermaid-c4-container', 'mermaid-c4-component',
    'mermaid-c4-deployment', 'mermaid-erd', 'mermaid-sequence', 'mermaid-graph',
    'mermaid-state', 'mermaid-gantt', 'react-flow-graph',
    'presentation-executive', 'presentation-technical', 'presentation-overview',
    'presentation-summary', 'sdd-brd', 'sdd-use-case', 'sdd-user-story',
    'sdd-domain-model', 'sdd-event-storming', 'sdd-glossary', 'sdd-nfr',
    'sdd-bdd', 'sdd-traceability'
  ];
  architectural_views constant text[] := array[
    'Vista de Contexto y Negocio', 'Vista Lógica y de Diseño', 'Vista de Datos',
    'Vista de Proceso e Interacción', 'Vista Física y de Despliegue',
    'Vista de Gestión y Soporte', 'Vista de Calidad y Validación', 'Vista SDD'
  ];
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
  -- La referencia se **bloquea**, no sólo se comprueba.
  --
  -- `for key share` es el modo que usa una clave foránea real: impide que la
  -- iniciativa se borre mientras esta transacción vive, y no estorba a ninguna
  -- otra escritura sobre ella. Sin él, comprobar y luego insertar son dos pasos
  -- con una ventana entre medias: `delete_business_initiative` puede ver que
  -- nadie la cita, este `insert` puede ver que existe, y ambas confirmar. El
  -- resultado es un proyecto que apunta a una iniciativa borrada — y, como esta
  -- misma comprobación corre en cada guardado, un proyecto que ya no se puede
  -- guardar nunca más.
  --
  -- El bloqueo va dentro de una subconsulta porque una cláusula de bloqueo no
  -- puede convivir con una agregación en el mismo nivel de consulta.
  select coalesce(array_agg(locked.id), '{}') into locked_initiatives
  from (
    select initiative.id
    from api.business_initiatives initiative
    where initiative.id = any (project_initiatives) and initiative.owner_id = actor
    for key share
  ) as locked;
  if cardinality(locked_initiatives) <> cardinality(project_initiatives) then
    raise exception 'El proyecto referencia una iniciativa inexistente o ajena' using errcode = '42501';
  end if;

  for artifact in select value from jsonb_array_elements(p_artifacts) as value loop
    artifact_id := btrim(coalesce(artifact ->> 'id', ''));
    if jsonb_typeof(artifact) is distinct from 'object'
      or artifact_id = '' or artifact ->> 'id' <> artifact_id
      or btrim(coalesce(artifact ->> 'name', '')) = ''
      or not (coalesce(artifact ->> 'type', '') = any(artifact_types))
      or btrim(coalesce(artifact ->> 'versionGroupId', '')) = ''
      or jsonb_typeof(artifact -> 'version') is distinct from 'number'
      or (artifact ->> 'version')::numeric < 1
      or btrim(coalesce(artifact ->> 'createdAt', '')) = ''
      or btrim(coalesce(artifact ->> 'phase', '')) = ''
      or not (coalesce(artifact ->> 'architecturalView', '') = any(architectural_views))
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

comment on function api.save_project_aggregate(jsonb, jsonb, bigint) is
  'Guarda raíz, artefactos, contador e índice en una transacción, con revisión optimista y bloqueo `for key share` sobre las iniciativas citadas.';

-- ──────────────────────── 2b. una iniciativa citada no se borra en silencio
create or replace function api.delete_business_initiative(p_id text, p_expected_revision bigint)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  initiative_key text := btrim(coalesce(p_id, ''));
  citing_projects text[];
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('initiative:write') then
    raise exception 'Permiso insuficiente: initiative:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();

  -- El bloqueo va **antes** del recuento, y ése es el orden que lo hace
  -- correcto. `for update` choca con el `for key share` que toma quien guarda
  -- un proyecto, así que un guardado en vuelo o termina antes de que aquí se
  -- cuente —y entonces se cuenta— o espera a que esta transacción decida —y
  -- entonces vuelve a comprobar que la iniciativa existe, y ya no existe.
  perform 1 from api.business_initiatives
  where id = initiative_key and owner_id = actor
  for update;

  select array_agg(project.name order by project.name) into citing_projects
  from api.architecture_projects project
  where project.owner_id = actor
    and initiative_key = any (project.initiative_ids);

  if coalesce(cardinality(citing_projects), 0) > 0 then
    -- Se nombran los proyectos, y como mucho cinco: el mensaje llega a alguien
    -- que tiene que ir a desvincularlos, y una lista de cuarenta nombres es tan
    -- inútil como ninguno. `23503` —violación de clave foránea— es lo que esto
    -- es; `classifySupabaseError` ya lo lee como `validation-error`, que es
    -- también lo que es: el dato no vale para la operación. No es un permiso
    -- denegado ni un conflicto de revisión.
    raise exception 'La iniciativa la citan % proyecto(s): %. Desvincúlalos antes de borrarla.',
      cardinality(citing_projects),
      array_to_string(citing_projects[1:5], ', ')
        || case when cardinality(citing_projects) > 5 then ', …' else '' end
      using errcode = '23503';
  end if;

  delete from api.business_initiatives
  where id = initiative_key and owner_id = actor and revision = p_expected_revision;
  if not found then
    raise exception 'Conflicto de iniciativa: recarga antes de borrar' using errcode = 'P0001';
  end if;
end;
$$;
comment on function api.delete_business_initiative(text, bigint) is
  'Borra una iniciativa propia sólo con la revisión vigente y sólo si ningún proyecto la cita.';

notify pgrst, 'reload schema';
commit;
