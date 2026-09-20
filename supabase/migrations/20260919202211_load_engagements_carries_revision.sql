-- `api.load_engagements` devuelve la fila, no sólo el documento.
--
-- ## El desajuste
--
-- `api.save_engagement` devuelve `api.office_engagements`, así que PostgREST
-- entrega `{ id, project_id, owner_id, data, revision, … }`.
-- `api.load_engagements` devolvía `jsonb_agg(e.data || …)`: **los documentos a
-- secas, sin su revisión**. Las dos las lee el mismo `asRemoteRecord` del
-- repositorio, que exige `revision` entero y ≥ 1 y descarta la fila si falta.
--
-- El resultado: toda lectura de encargos lanzaba «La respuesta remota de
-- encargos contiene una fila inválida», y la sala del encargo se quedaba sin
-- nada que pintar. No es un problema del E2E —ahí se vio— sino de cualquiera
-- que abriera la Oficina.
--
-- ## Por qué la revisión importa más que el síntoma
--
-- `revision` es la concurrencia optimista de este agregado: el repositorio la
-- guarda al leer y la manda de vuelta como `p_expected_revision` al guardar.
-- Sin ella, el mapa de revisiones queda vacío tras una carga y el primer
-- guardado va con `0`, que es decir «no compruebes nada». Devolver el documento
-- sin su revisión no era una omisión cosmética: desarmaba la protección contra
-- dos pestañas escribiendo el mismo encargo.
--
-- El espejo de decisiones ARB se sigue reemplazando al leer —las reales viven
-- en el registro inmutable—, sólo que ahora dentro de `data`, que es donde el
-- lector lo busca.
create or replace function api.load_engagements(p_project_id text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  project_key text := btrim(coalesce(p_project_id, ''));
  payload jsonb;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('portfolio:read') then
    raise exception 'Permiso insuficiente: portfolio:read' using errcode = '42501';
  end if;
  perform private.assert_session_active();
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'revision', e.revision,
      'data', e.data || jsonb_build_object(
        'arbDecisions',
        coalesce((select jsonb_agg(d.data order by d.created_at) from api.office_arb_decisions d
                  where d.owner_id = actor and d.project_id = project_key
                    and d.engagement_id = e.id), '[]'::jsonb)
      )
    ) order by e.updated_at desc), '[]'::jsonb)
  into payload
  from api.office_engagements e
  where e.owner_id = actor and e.project_id = project_key;
  return payload;
end;
$$;

comment on function api.load_engagements(text) is
  'Encargos del proyecto como filas {revision, data}, con el espejo de decisiones ARB '
  'reemplazado por el registro inmutable. La revisión viaja porque es la concurrencia '
  'optimista del agregado: sin ella el siguiente guardado no compara contra nada.';
