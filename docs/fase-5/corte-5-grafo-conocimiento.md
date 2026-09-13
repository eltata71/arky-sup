# Fase 5 — Corte vertical 5: grafo de conocimiento arquitectónico (AKG)

**Rama:** `feature/fase5-piloto-configuracion`
**Proyecto remoto:** ArkyDB-US (`btbhkmckrazoayaoorys`, `us-east-1`)
**Migración:** `20260912183000_knowledge_graph.sql` — aplicada.
**Estado:** persistencia, autorización, contrato SQL, ETL y repositorio completos; **no activado** y sin carga de datos de la PoC.

## Unidad del corte

El grafo de conocimiento arquitectónico es el modelo canónico y duradero del
conocimiento de un proyecto. En Firestore vive como campo del documento del
proyecto (`Project.architectureKnowledgeGraph`) y en Supabase pasa a ser una
fila propia (`api.architecture_knowledge_graphs`, una por proyecto), porque el
grafo crece con cada artefacto y no debe viajar dentro del documento raíz.

El grafo es **derivado y reconstruible**: la lectura ausente no es un error del
adaptador, es la señal de reconstruir. Por eso el corte no exige la raíz del
proyecto migrada — el enlace es textual (`project_id`) con `auth.uid()` como
frontera, igual que los cortes 3 y 4.

## Esquema y superficie autorizada

| Componente | Responsabilidad |
| --- | --- |
| `api.architecture_knowledge_graphs` | una fila por proyecto: propietario, documento JSON del grafo, revisión |
| `api.save_knowledge_graph(project_id, graph, expected_revision)` | `project:write` + sesión activa; valida forma base (entidades/relaciones/quality/statistics), identidad de cada nodo/relación, coherencia `projectId`, sin `apiKey`; revisión optimista |
| `api.load_knowledge_graph(project_id)` | `portfolio:read` + sesión; devuelve el grafo propio con revisión, o `P0002` si no existe |

RLS activa y sin privilegios directos para `authenticated` ni `service_role`.
La RPC rechaza entidades sin `id`/`name`/`type`/`sourceRefs` y relaciones sin
extremos o tipo: el grafo es evidencia trazable, no prosa. La semántica completa
(extracción, deduplicación, consistencia, trazabilidad) sigue siendo del dominio
TypeScript; la RPC defiende identidad y frontera.

## ETL

El grafo viaja inline dentro del documento del proyecto exportado. El ETL del
corte 3 (`projects_artifacts_etl.py`) ahora lo separa del documento raíz:
acepta un `architectureKnowledgeGraph` bien formado (proyecto coincidente,
`entities` lista) y lo emite como campo aparte `knowledge_graph` del registro,
de modo que la carga lo persista vía `api.save_knowledge_graph`; un grafo de
otro proyecto o mal formado rechaza el agregado.

No se ejecutó exportación ni carga real: el mapa de identidades sigue sin
provisionar, igual que en los cortes 1–4.

## Validación ejecutada

| Control | Resultado |
| --- | --- |
| Contratos SQL PG 16, dos reconstrucciones | grafo **13/13**; encargos **21/21**; proyectos/artefactos **23/23**; iniciativas **17/17**; identidad/autorización **51/51**; fundación **41/41**; preferencias **14/14** |
| Análisis `plpgsql_check` | sin hallazgos en ambas reconstrucciones |
| Sonda PostgreSQL 17 remota, transacción revertida | **4/4**: guardado/lectura propia, revisión obsoleta (`P0001`), otro usuario (`P0002`), entidad sin identidad (`22023`) |
| Tipos de base | regenerados desde ArkyDB-US con la tabla y RPCs del corte |
| Repositorio Supabase del grafo | **4/4** pruebas Vitest (`supabaseKnowledgeGraphRepository.test.ts`) |
| ETL de los cinco cortes | **20/20** pruebas Python correctas |

## Activación y reversión

La activación requiere el prerrequisito común de los cortes 1–4: identidad
Supabase conectada al `AuthContext` de la cohorte piloto y mapa de
identidades. El repositorio queda disponible como adaptador; el routing se
conecta en la activación del piloto. La reversión es retirar la bandera de
cohorte; el grafo sigue reconstruible desde Firebase hasta entonces.

## Siguiente corte

**Aprendizaje** — el último de la F5, técnicamente aislado y dependiente de
identidad.