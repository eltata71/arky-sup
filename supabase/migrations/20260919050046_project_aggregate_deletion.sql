-- F9.1 — Borrar un proyecto entero, sin dejar huérfanos.
--
-- Faltaba: F5 construyó `save_project_aggregate` y `load_project_aggregate`,
-- porque un PoC sin datos nunca borró nada. Con Firestore retirado, la papelera
-- del producto necesita una puerta, y borrar solo la raíz no basta: los
-- artefactos, el historial, las acciones del agente, los comentarios y las
-- decisiones cuelgan de la raíz por clave foránea en cascada, pero los encargos
-- de Oficina y el grafo de conocimiento **no** — se crearon en cortes
-- anteriores, cuando el proyecto todavía vivía en Firebase, y guardan
-- `project_id` como texto suelto.
--
-- Se borran explícitamente aquí en vez de añadir la clave foránea que falta,
-- porque una clave foránea nueva sobre datos existentes puede fallar por una
-- fila que el PoC no tiene pero un despliegue sí. La cascada declarada y la
-- explícita quedan documentadas juntas en el valor devuelto, de modo que quien
-- llame sepa exactamente qué desapareció: un borrado que quita más de lo que
-- dice es pérdida de datos con otro nombre.
begin;

create function api.delete_project_aggregate(p_id text, p_expected_revision bigint)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  current_revision bigint;
  removed_engagements integer := 0;
  removed_graphs integer := 0;
begin
  if actor is null then
    raise exception 'Se requiere sesión' using errcode = '42501';
  end if;
  if not private.has_permission('project:write') then
    raise exception 'Permiso insuficiente: project:write' using errcode = '42501';
  end if;
  perform private.assert_session_active();

  select revision into current_revision
  from api.architecture_projects
  where id = p_id and owner_id = actor;
  if not found then
    raise exception 'El proyecto no existe o no pertenece a la sesión actual' using errcode = '42501';
  end if;
  -- Revisión 0 significa «no sé cuál era»: se acepta como borrado incondicional
  -- porque la papelera de la interfaz confirma con la persona antes de llamar,
  -- y exigir una revisión que el cliente pudo no haber leído convertiría un
  -- borrado explícito en un error que nadie sabe resolver.
  if p_expected_revision > 0 and current_revision <> p_expected_revision then
    raise exception 'Conflicto de proyecto: recarga antes de borrar' using errcode = 'P0001';
  end if;

  delete from api.office_engagements where project_id = p_id and owner_id = actor;
  get diagnostics removed_engagements = row_count;
  delete from api.architecture_knowledge_graphs where project_id = p_id and owner_id = actor;
  get diagnostics removed_graphs = row_count;
  delete from api.architecture_projects where id = p_id and owner_id = actor;

  return jsonb_build_object(
    'id', p_id,
    'engagements', removed_engagements,
    'knowledgeGraphs', removed_graphs
  );
end;
$$;
comment on function api.delete_project_aggregate(text, bigint) is
  'Borra el proyecto, su cascada declarada y los dos conjuntos sin clave foránea; informa de lo que quitó.';

revoke all on function api.delete_project_aggregate(text, bigint) from public, anon, authenticated, service_role;
grant execute on function api.delete_project_aggregate(text, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
