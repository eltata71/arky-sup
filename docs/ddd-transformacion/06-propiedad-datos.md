# Matriz de propiedad — tablas, RPC y datos

**20 tablas** en el esquema `api` y **58 funciones**, contadas sobre las
migraciones (cada `create function` menos su `drop function`), revisado el
2026-09-25 (F6-06). Todos los privilegios de tabla están revocados;
`authenticated` sólo ejecuta RPC. La pregunta que esta matriz responde es
**quién es dueño de cada dato**, que es distinta de quién lo lee.

La versión anterior era la foto de la línea base: citaba la RPC compuesta
retirada en F4-06, la segunda firma de `delete_engagement` retirada en la
fase 2, y no conocía diez RPC ni la tabla de la bitácora. La columna
**Desde** dice qué fase cambió cada fila.

Columna **Naturaleza**: `autoritativo` (la verdad vive aquí) ·
`proyección` (reconstruible desde datos autoritativos) ·
`espejo` (copia derivada que se conserva por comodidad y **nunca decide**).

---

## Contexto: Iniciativas y Portafolio

| Tabla | RPC | Naturaleza | Consumidores | Desde |
|---|---|---|---|---|
| `business_initiatives` | `list_business_initiatives`, `save_business_initiative` (asigna el código al crear), `delete_business_initiative` (se niega si un proyecto la cita) | autoritativo | `services/businessInitiatives`, `services/portfolioGraph`, `InitiativeContext` | fase 2 (H08), F6-04 (código) |

Las referencias entrantes (`architecture_projects.initiative_ids`) ya tienen
dueño: `delete_business_initiative` comprueba que ningún proyecto del actor
cita la iniciativa antes de borrarla (H08, contrato
`engagement_overload_and_initiative_references`).

## Contexto: Proyectos de Arquitectura

| Tabla | RPC | Naturaleza | Consumidores | Desde |
|---|---|---|---|---|
| `architecture_projects` | `list_project_aggregates`, `load_project_aggregate`, `save_project` (la **única** escritura de la raíz), `delete_project_aggregate` | autoritativo | `services/architectureProjects`, `AppContext`, `services/portfolioGraph` | F4-06 |
| `architecture_projects.artifact_count` / `.artifact_index` | recalculados por cada comando de artefacto | **proyección** — desde las filas, en la misma transacción | `ProjectHub`, dashboards | F4-03 |
| `project_chat_history` | `load_chat_history`, `save_chat_history` | autoritativo — **sin revisión**: reescribe la lista entera (invariante T-06, ❌) | `services/chat` | — |
| `agent_actions` | `list_agent_actions`, `append_agent_action` | autoritativo, append-only | `services/agent`, `officeRunTrace` | — |
| `architecture_knowledge_graphs` | `load_knowledge_graph`, `save_knowledge_graph`, `save_graph_projection` | **proyección** — derivada de los artefactos | `services/architectureKnowledgeGraph`, `services/publicationPipeline` | F5-05 |
| `projection_outbox` | `list_pending_projections`, `save_graph_projection`, `fail_projection` — la escribe **un disparador** de `project_artifacts`, nunca el cliente | autoritativo — **el trabajo de proyección pendiente** (ADR-107) | `services/architectureProjects/graphProjection`, `useArchitectureGraphSync` | F5-04 |

## Contexto: Entregables y Publicación

| Tabla | RPC | Naturaleza | Consumidores | Desde |
|---|---|---|---|---|
| `project_artifacts` | `create_artifact`, `create_artifact_version`, `update_artifact`, `delete_artifact`, `revise_artifacts` | autoritativo — **el Artefacto es raíz de su propio agregado**, con su revisión (ADR-106) | `services/artifacts`, `ArtifactCanvas` | F4-03 |
| `artifact_comments` | `list_artifact_comments`, `save_artifact_comment`, `delete_artifact_comment` | autoritativo | `services/review` | — |
| `artifact_review_decisions` | `list_artifact_review_decisions`, `record_artifact_review_decision` | autoritativo, **inmutable** (`on conflict do nothing`) | `services/review` | — |

La propiedad disputada de la línea base (H05) —Entregables escribía sus
artefactos a través del agregado de Proyectos— **se resolvió en F4 (ADR-106)**:
cada comando escribe un artefacto y ninguno recibe la lista del proyecto.

## Contexto: Encargos y Gobernanza

| Tabla | RPC | Naturaleza | Consumidores | Desde |
|---|---|---|---|---|
| `office_engagements` | `load_engagements`, `save_engagement` (con transiciones legales; no puede entregar), `delete_engagement` (una sola firma, con revisión) | autoritativo | `services/architectureOffice`, `OfficeContext` | fase 2 (H02, H09) |
| `office_engagements.data->'arbDecisions'` | reconstruido **por el servidor** desde el registro, dentro de `decide_engagement` | **espejo** que no decide | `EngagementRoom` | fase 2 (H01) |
| `office_arb_decisions` | `decide_engagement` (decisión + transición en una transacción; el autor no firma lo suyo), `record_arb_decision`, `load_arb_engagements` (la bandeja del comité) | autoritativo, **inmutable** | `ArbDecisionPanel`, `OfficeContext` | fase 2 (ADR-101, ADR-102) |
| `agent_profiles` | `list_agent_profiles`, `save_agent_profile`, `delete_agent_profile` | autoritativo, por usuario | `services/architectureOffice` (`agents.ts`), `useAgentProfiles` | — |

## Contexto: Identidad y Acceso

| Tabla | RPC | Naturaleza | Consumidores | Desde |
|---|---|---|---|---|
| `user_profiles` | `load_own_profile`, `list_user_profiles`, `provision_user_profile`, `set_user_role`, `set_user_status`, `delete_user_profile`, `update_own_display_name` | autoritativo | `services/identity`, `AuthContext` | — |
| `user_settings` | `save_user_settings` (con revisión) | autoritativo | `services/settings` | F6-03 |
| `private.role_permissions` | leída por `private.has_permission` y expuesta por `current_permissions` | autoritativo — **la matriz de permisos** | RLS, toda RPC y `lib/authz` | — |
| `private.authorization_audit` | escrita por las RPC de rol | autoritativo, append-only | auditoría | — |

El correo **no se copia**: se lee de `auth.users`. Dueño único de la identidad.

## Contexto: Aprendizaje

| Tabla | RPC | Naturaleza |
|---|---|---|
| `lms_courses` | `list_courses`, `save_course` (con revisión, F6-03), `delete_course` | autoritativo |
| `lms_progress` | `load_progress`, `save_progress` | autoritativo, por usuario |
| `lms_context` | `load_context`, `save_context` | autoritativo, por usuario |
| `lms_notes` | `list_notes`, `save_note`, `delete_note` | autoritativo, por usuario |

## Capacidades técnicas

| Tabla | RPC | Naturaleza |
|---|---|---|
| `file_objects` + 2 cubos privados | `register_file_object`, `mark_file_object_ready`, `mark_file_object_deleted` | autoritativo |
| `platform_reference_parameters` | `load_platform_reference_parameters`, `save_platform_reference_parameters` | autoritativo |
| `platform_probes` | — | diagnóstico |

---

## Consistencia: qué es inmediata y qué admite retraso

| Dato | Consistencia | Por qué |
|---|---|---|
| Artefacto ↔ índice y contador del proyecto | **inmediata** | se recalculan en la transacción del comando |
| Encargo ↔ decisión ARB | **inmediata** | `decide_engagement`, una transacción (antes H01) |
| Proyecto ↔ iniciativa citada | **inmediata** | la RPC de borrado se niega (antes H08) |
| Grafo de conocimiento | **eventual y durable** | el pendiente se escribe en la transacción del artefacto y se procesa al arrancar (antes H11, sin recuperación) |
| Espejo `NEG-…` de códigos de iniciativa | eventual, y **no decide** | los ids ganan siempre |

## Archivo, borrado y retención — estado

| Dato | Borrado | Archivado | Retención |
|---|---|---|---|
| Iniciativa | con revisión, y se niega si un proyecto la cita | **no existe** | sin política |
| Proyecto | `delete_project_aggregate`, con revisión (contrato de conflicto desde F6-05) | no existe | sin política |
| Encargo | `delete_engagement`, una firma con revisión | estado `cancelled` | sin política |
| Decisión ARB | **imposible** — sin `update` ni `delete` | — | permanente por diseño |
| Auditoría de autorización | append-only | — | permanente |
| Artefacto | `delete_artifact`, con su revisión | versiones | sin política |

> **Decisión pendiente (negocio), D-2.** No hay ninguna política de archivado
> ni de retención escrita. Un encargo cancelado y uno de hace tres años pesan
> igual. Bloquea F6-08. Se registra como pendiente, no como supuesto.
