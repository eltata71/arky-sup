# F4-01 — volumen y conflictos del agregado Proyecto–Artefacto

**Fecha:** 2026-09-22 · **Estado:** medición completada sobre el proyecto Supabase vinculado; sin carga de proyectos para estimar una tasa de conflictos.

## Resultado verificable en el código

| Medida | Resultado | Fuente |
|---|---|---|
| Cuerpos enviados al editar un artefacto | `N` de `N`, aun cuando cambia uno | `artifactPersistence.ts`: `mutateArtifacts` carga el proyecto y entrega la lista completa a `persistProjectAggregate`; `SupabaseProjectRepository.save` pasa `p_artifacts` sin recorte. |
| Filas de artefacto actualizadas por una edición | `N` de `N` | Última definición de `api.save_project_aggregate`, migración `20260920120000_engagement_overload_and_initiative_references.sql`: bucle `for artifact` con `insert ... on conflict do update` sin comparación del contenido. |
| Raíces actualizadas por una edición | 1 proyecto, con revisión incrementada | Misma RPC: `on conflict (id) do update ... revision = target.revision + 1`. |
| Contención entre dos ediciones de artefactos distintos | Una gana; la segunda, si lleva la revisión anterior, recibe `P0001` | Misma RPC: `where target.revision = p_expected_revision`; `projects_artifacts.test.sql` prueba el rechazo de revisión obsoleta. |
| Riesgo de lista incompleta | Los artefactos omitidos se borran | Misma RPC: `delete from api.project_artifacts ... not exists (...)`. |

`N` es el número de artefactos del proyecto al guardar. Para una edición de un
artefacto, la amplificación de filas hijas es exactamente `N:1`. El tamaño del
envío es el JSON del proyecto más la suma del JSON de todos sus artefactos; no
incluye cabeceras ni la serialización adicional de PostgREST. Estas son
propiedades del contrato actual, no medidas de tráfico observado.

## Volumen real y tasa de conflictos

`supabase db query --linked --file
docs/ddd-transformacion/evidencias/f4-01-volumen.sql` se ejecutó contra el
proyecto vinculado. Resultado: **0 proyectos, 0 artefactos, 0 inconsistencias**.
Los percentiles y máximos devueltos como cero son valores de presentación para
una población vacía: no significan que una escritura real pese cero bytes.
La consulta no devuelve ids ni contenido. Una segunda consulta confirmó los
recuentos directos de ambas tablas (0 y 0) y que `pg_stat_statements` está
instalado.

**Tasa de conflictos: no estimable**, no cero. No hay proyectos actuales ni una
serie de `P0001` por operación con denominador de intentos. La presencia de
`pg_stat_statements` no proporciona por sí sola una tasa de errores de la RPC.
Si aparece carga real, contar en el mismo periodo `P0001` de
`save_project_aggregate` y todos sus intentos, distinguiendo escrituras de
proyecto y de artefacto. El test de revisión obsoleta demuestra el
comportamiento, **no** una frecuencia observada.

## Consecuencia para D-4 / F4-02

El contrato impone una sola revisión para todos los artefactos, aunque sus
contenidos no compartan una invariante evidente. La consistencia de contador e
índice sí exige una actualización atómica, pero no por sí sola reescribir cada
cuerpo. F4-02 deberá decidir con las invariantes y la amplificación estructural,
y declarar explícitamente que no existe evidencia de volumen o conflictos bajo
carga. La decisión podrá revisarse cuando haya datos de uso.

## Comandos y límites

Inspección: `rg` sobre servicios, migraciones y pruebas; `sed` de
`artifactPersistence.ts`, `SupabaseProjectRepository.ts`, la migración vigente y
`projects_artifacts.test.sql`; `git diff --check` pasó. La primera ejecución de
`npm run quality` agotó un límite de 180 s en `tsc`; la segunda completó todos
los gates estáticos fuera del sandbox (el sandbox impedía `spawnSync /bin/sh`)
y agotó un límite total de 600 s durante cobertura. Cobertura y build se
ejecutaron entonces por separado, completando el mismo conjunto de gates:

- `npm run quality:static`: tipos, tipos estrictos, ESLint, `any` (23/23),
  scripts, tamaño y fronteras en verde.
- `npm run test:coverage`: 456 archivos y 4 419 pruebas pasadas; 65,51 % de
  statements.
- `npm run build:placeholders`, `npm run check:bundle-secrets` y
  `npm run check:bundle-budget`: en verde; carga inicial 308,6/340,0 KB gzip.

**Riesgo ajeno a F4-01:** el build advierte que `artifactGenerationService`
reexportado por `services/ai/index.ts` crea dependencias circulares entre
chunks. El build terminó y el presupuesto pasó, pero esta advertencia debe
evaluarse en el trabajo de fronteras/IA; F4-01 no cambia ese código.

La CLI 2.117.0 ejecutó la consulta remota con `--linked`, además de una sonda
`select 1` y la comprobación de recuentos directos. No se modificó el esquema
ni se consultaron datos de usuarios.
