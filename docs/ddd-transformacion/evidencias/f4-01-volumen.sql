-- F4-01: ejecutar como lectura sobre la base objetivo y guardar la salida.
-- No expone nombres, contenido, ids ni propietarios. Requiere SELECT sobre
-- api.architecture_projects y api.project_artifacts (por ejemplo, en SQL Editor).
-- pg_column_size mide el tamaño almacenado; octet_length(data::text), una
-- aproximación al cuerpo JSON que viaja en la RPC, sin cabeceras HTTP.
with per_project as (
  select p.id,
         p.artifact_count as indexed_count,
         count(a.id)::integer as actual_count,
         coalesce(sum(pg_column_size(a.data)), 0)::bigint as artifact_storage_bytes,
         coalesce(sum(octet_length(a.data::text)), 0)::bigint as artifact_json_bytes,
         pg_column_size(p.data)::bigint as project_storage_bytes,
         octet_length(p.data::text)::bigint as project_json_bytes
  from api.architecture_projects p
  left join api.project_artifacts a on a.project_id = p.id
  group by p.id, p.artifact_count, p.data
), buckets as (
  select case
           when actual_count = 0 then '0'
           when actual_count <= 5 then '1-5'
           when actual_count <= 20 then '6-20'
           when actual_count <= 100 then '21-100'
           else '101+'
         end as artifact_bucket,
         count(*) as projects,
         max(actual_count) as max_artifacts,
         max(project_json_bytes + artifact_json_bytes) as max_full_save_json_bytes
  from per_project
  group by 1
)
select count(*) as projects,
       coalesce(sum(actual_count), 0) as artifacts,
       coalesce(max(actual_count), 0) as max_artifacts_per_project,
       coalesce(percentile_cont(0.5) within group (order by actual_count), 0) as p50_artifacts,
       coalesce(percentile_cont(0.95) within group (order by actual_count), 0) as p95_artifacts,
       coalesce(max(project_json_bytes + artifact_json_bytes), 0) as max_full_save_json_bytes,
       coalesce(percentile_cont(0.5) within group (order by project_json_bytes + artifact_json_bytes), 0) as p50_full_save_json_bytes,
       coalesce(percentile_cont(0.95) within group (order by project_json_bytes + artifact_json_bytes), 0) as p95_full_save_json_bytes,
       coalesce(sum(artifact_storage_bytes), 0) as artifact_storage_bytes,
       count(*) filter (where indexed_count <> actual_count) as inconsistent_counts,
       (select coalesce(jsonb_agg(to_jsonb(b) order by b.artifact_bucket), '[]'::jsonb)
        from buckets b) as artifact_buckets
from per_project;
