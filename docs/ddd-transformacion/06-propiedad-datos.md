# Matriz de propiedad — tablas, RPC y datos

20 tablas en el esquema `api`, 50 funciones. Todos los privilegios de tabla
están revocados; `authenticated` sólo ejecuta RPC. La pregunta que esta matriz
responde es **quién es dueño de cada dato**, que es distinta de quién lo lee.

Columna **Naturaleza**: `autoritativo` (la verdad vive aquí) ·
`proyección` (reconstruible desde datos autoritativos) ·
`espejo` (copia derivada que se conserva por comodidad y **nunca decide**).

---

## Contexto: Iniciativas y Portafolio

| Tabla | RPC | Naturaleza | Consumidores |
|---|---|---|---|
| `business_initiatives` | `list_business_initiatives`, `save_business_initiative`, `delete_business_initiative` | autoritativo | `services/businessInitiatives`, `services/portfolioGraph`, `InitiativeContext` |

**Sin dueño declarado:** las referencias entrantes. `architecture_projects.initiative_ids`
apunta aquí y **ninguna restricción las liga** (H08).

## Contexto: Proyectos de Arquitectura

| Tabla | RPC | Naturaleza | Consumidores |
|---|---|---|---|
| `architecture_projects` | `list_project_aggregates`, `load_project_aggregate`, `save_project_aggregate`, `delete_project_aggregate` | autoritativo | `services/architectureProjects`, `AppContext`, `services/portfolioGraph` |
| `architecture_projects.artifact_count` / `.artifact_index` | (dentro de `save_project_aggregate`) | **proyección** — recalculada por la RPC en cada escritura | `ProjectHub`, dashboards |
| `project_chat_history` | `load_chat_history`, `save_chat_history` | autoritativo | `services/chat` |
| `agent_actions` | `list_agent_actions`, `append_agent_action` | autoritativo, append-only | `services/agent`, `officeRunTrace` |
| `architecture_knowledge_graphs` | `load_knowledge_graph`, `save_knowledge_graph` | **proyección** — derivada de los artefactos, con `sourceSignature` | `services/architectureKnowledgeGraph`, `services/publicationPipeline` |

**Propiedad disputada (H05).** `project_artifacts` es escrita *sólo* por
`save_project_aggregate`, que pertenece al contexto Proyectos. Los artefactos
son del contexto Entregables. Hoy **Entregables no tiene ruta de escritura
propia**; escribe a través del agregado de Proyectos. Es el objeto de F4-02.

## Contexto: Entregables y Publicación

| Tabla | RPC | Naturaleza | Consumidores |
|---|---|---|---|
| `project_artifacts` | (sólo vía `save_project_aggregate` / `delete_project_aggregate`) | autoritativo | `services/artifacts`, `ArtifactCanvas` |
| `artifact_comments` | `list_artifact_comments`, `save_artifact_comment`, `delete_artifact_comment` | autoritativo | `services/review` |
| `artifact_review_decisions` | `list_artifact_review_decisions`, `record_artifact_review_decision` | autoritativo, **inmutable** (`on conflict do nothing`) | `services/review` |

## Contexto: Encargos y Gobernanza

| Tabla | RPC | Naturaleza | Consumidores |
|---|---|---|---|
| `office_engagements` | `load_engagements`, `save_engagement`, `delete_engagement` ×2 firmas | autoritativo | `services/architectureOffice`, `OfficeContext` |
| `office_engagements.data->'arbDecisions'` | (dentro de `save_engagement`) | **espejo** de `office_arb_decisions` | `EngagementRoom` |
| `office_arb_decisions` | `record_arb_decision` | autoritativo, **inmutable** | `ArbDecisionPanel` |
| `agent_profiles` | `list_agent_profiles`, `save_agent_profile`, `delete_agent_profile` | autoritativo | `services/architectureOffice`, `useAgentProfiles` |

> **El espejo decide hoy, y no debería.** `arbDecisions` dentro del documento se
> escribe en la primera de las dos escrituras de H01. Si la segunda falla, la
> pantalla lee el espejo y muestra una decisión que el registro inmutable no
> tiene. Regla a aplicar en F2-01: **el espejo se reconstruye al leer desde el
> registro, nunca al revés** — es la misma regla que el portafolio ya aplica a
> los códigos `NEG-…`.

## Contexto: Identidad y Acceso

| Tabla | RPC | Naturaleza | Consumidores |
|---|---|---|---|
| `user_profiles` | `load_own_profile`, `list_user_profiles`, `provision_user_profile`, `set_user_role`, `set_user_status`, `delete_user_profile`, `update_own_display_name` | autoritativo | `services/identity`, `AuthContext` |
| `user_settings` | `save_user_settings` | autoritativo | `services/settings` |
| `private.role_permissions` | (leída por `private.has_permission`) | autoritativo — **la matriz de permisos** | RLS y toda RPC |
| `private.authorization_audit` | (escrita por las RPC de rol) | autoritativo, append-only | auditoría |

El correo **no se copia**: se lee de `auth.users`. Dueño único de la identidad.

## Contexto: Aprendizaje

| Tabla | RPC | Naturaleza |
|---|---|---|
| `lms_courses` | `list_courses`, `save_course`, `delete_course` | autoritativo |
| `lms_progress` | `load_progress`, `save_progress` | autoritativo |
| `lms_context` | `load_context`, `save_context` | autoritativo |
| `lms_notes` | `list_notes`, `save_note`, `delete_note` | autoritativo |

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
| Proyecto ↔ sus artefactos | **inmediata** | una transacción; el índice y el contador se derivan en la misma escritura |
| Encargo ↔ decisión ARB | **debe ser inmediata, hoy no lo es** | H01 — dos escrituras |
| Proyecto ↔ iniciativa citada | **debe ser inmediata, hoy no lo es** | H08 — sin restricción |
| Grafo de conocimiento | **eventual** | proyección; hoy sin recuperación durable (H11) |
| `artifact_index` / `artifact_count` | inmediata por construcción | se calculan dentro de la RPC |
| Espejo `NEG-…` de códigos de iniciativa | eventual, y **no decide** | los ids ganan siempre |

## Archivo, borrado y retención — estado

| Dato | Borrado | Archivado | Retención |
|---|---|---|---|
| Iniciativa | duro, sin comprobar referencias (H08) | **no existe** | sin política |
| Proyecto | `delete_project_aggregate` | no existe | sin política |
| Encargo | `delete_engagement` (dos firmas, H09) | estado `cancelled` | sin política |
| Decisión ARB | **imposible** — sin `update` ni `delete` | — | permanente por diseño |
| Auditoría de autorización | append-only | — | permanente |
| Artefacto | vía el agregado | versiones | sin política |

> **Decisión pendiente (negocio).** No hay ninguna política de archivado ni de
> retención escrita. Un encargo cancelado y uno de hace tres años pesan igual.
> Se registra como pendiente, no como supuesto.
