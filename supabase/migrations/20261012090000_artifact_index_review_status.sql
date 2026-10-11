-- 14.4 · El índice de artefactos lleva la etapa de revisión.
--
-- El tablero cuenta en qué etapa del ciclo de vida está cada artefacto
-- (borrador, en revisión, aprobado, publicado). De un proyecto sin abrir sólo
-- tenía el índice, que no llevaba `reviewStatus`: esos artefactos se contaban
-- «sin medir». El índice es una proyección que se recalcula desde las filas,
-- así que basta con añadir el campo ahí y recalcular los existentes.
--
-- Un artefacto sin `reviewStatus` propio es un borrador: la proyección lo
-- escribe como 'draft'. Una entrada de índice SIN la clave es de antes de esta
-- migración y el cliente la sigue leyendo como «sin medir».
--
-- Reversión: recrear la función con la definición de
-- `20260922180000_artifact_commands.sql`; la clave sobrante se ignora.
begin;

create or replace function private.refresh_project_artifact_index(p_project_id text)
returns void
language plpgsql set search_path = '' as $$
begin
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
             'reviewStatus', coalesce(nullif(data ->> 'reviewStatus', ''), 'draft'),
             'createdAt', data -> 'createdAt', 'updatedAt', data -> 'updatedAt'
           )) order by data ->> 'id'), '[]'::jsonb) as idx
    from api.project_artifacts where project_id = p_project_id
  ) as rows
  where project.id = p_project_id;
end;
$$;

-- Recalcula los índices ya guardados. No toca `revision`: el índice no es del
-- proyecto, es una proyección (misma regla que `refresh` en cada comando).
do $$
declare
  pid text;
begin
  for pid in select id from api.architecture_projects loop
    perform private.refresh_project_artifact_index(pid);
  end loop;
end;
$$;

commit;
