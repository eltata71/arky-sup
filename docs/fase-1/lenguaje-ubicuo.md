# F1.1 — Lenguaje ubicuo (Ubiquitous Language) acordado

Base: `lib/eaTerminology.ts`, `docs/oficina-arquitectura.md`, `services/architectureOffice/OfficeTypes.ts`.
Documento vivo — cada término tiene dueño y versión.

## Jerarquía canónica (4 niveles)

| Nivel | Término canónico (singular) | Plural | Corto | Definición breve | Nota de disciplina |
| --- | --- | --- | --- | --- | --- |
| 1 | Iniciativa de Negocio | Iniciativas de Negocio | Iniciativa | La necesidad del negocio que motiva el trabajo de arquitectura: su driver, sus objetivos y los resultados que espera. | Capa de motivación: driver, objetivos y resultados esperados. |
| 2 | Proyecto de Arquitectura | Proyectos de Arquitectura | Proyecto | La respuesta de la Oficina a una iniciativa: el espacio donde se diseña la arquitectura y se producen sus artefactos. | Respuesta arquitectónica a un driver de negocio. |
| 3 | Solicitud de Entregable | Solicitudes de Entregables | Entregable | Una pieza de trabajo gobernada: con responsable, revisor distinto, quality gates y decisión del comité. | Unidad de trabajo gobernada de la Oficina. |
| 4 | Artefacto | Artefactos | Artefacto | El documento o diagrama concreto que produce y revisa un entregable. | Producto de trabajo arquitectónico. |

**Regla de uso**: en UI, `singular`/`plural` para títulos y primera mención; `short`/`shortPlural` para rail, chips, breadcrumbs, filas densas. Nunca mezclar.

## Términos transversales

| Término | Definición | Dueño |
| --- | --- | --- |
| Encargo | Sinónimo operativo de `OfficeEngagement` (nivel 3 + ejecución). Ver `docs/oficina-arquitectura.md`. | Oficina de Arquitectura |
| Atención | Nombre interno heredado del código para nivel 2 (`Project`, `attentionTracking`). **No usar en UI**. | Equipo técnico |
| Charter | `OfficeCharter`: objetivos, alcance, restricciones, marcos regulatorios, entregables, participantes, coordinador, consolidador, procedencia (`deterministic`/`ai-refined`). | Oficina de Arquitectura |
| Quality Gate | Criterio determinista o evaluado por modelo que un entregable debe superar antes de consolidarse. 6 gates definidos. | Oficina de Arquitectura |
| ARB | Architecture Review Board: comité humano que decide `delivered`/`changes-requested`/`rejected` sobre un encargo. | Gobernanza |
| Persona | Especialista de la Oficina con `id`, `domains`, `capabilities`, `producesArtifactTypes`, `reviewsArtifactTypes`, `orchestrationRole`. 13 definidas. | Oficina de Arquitectura |
| DAG | Grafo acíclico dirigido de tareas (`OfficeTask`) que el ejecutor recorre. | Oficina de Arquitectura |
| Task | Unidad ejecutable: `produce-artifact`, `review-artifact`, `consolidate`, `report`. Estado: `pending`→`ready`→`in-progress`→`awaiting-review`→`changes-requested`/`completed`/`failed`/`skipped`/`cancelled`. | Oficina de Arquitectura |
| Deliverable (del charter) | `OfficeCharterDeliverable`: plantilla, tipo de artefacto, responsable, revisor, racional, dependencias. | Oficina de Arquitectura |
| Invariante clave | "Una atención siempre pertenece a una iniciativa". Se aplica en `createArchitectureProject` y `firestore.rules`, no en UI. | Arquitectura |
| `NEG-YYYY-NNN` | `BusinessInitiativeCode`: objeto de valor normalizado (`toInitiativeCode`). | Negocio |
| `eng-*`, `task-*`, `audit-*`, `arb-*` | Prefijos de ID generados por `newPrefixedId`. | Técnico |

## Glosario de roles (de `lib/authz/permissions.ts`)

| Rol | Alcance | Auto-asignable |
| --- | --- | --- |
| viewer | Lee portafolio, consume formación. No escribe. | No |
| architect | Autor de iniciativas, atenciones, entregables, artefactos. | No (provisionado) |
| reviewer | Architect + aprueba charters, decide en ARB, publica. | No |
| trainer | Autor del Centro de Formación y lee analíticas. | No |
| admin | Todo lo anterior + gestiona usuarios (no concede privilegio). | No |
| superadmin | Todo, incluyendo conceder `admin` y `superadmin`. | No |

## Cambios acordados respecto al código actual

1. **Eliminar "atención" de cualquier superficie visible**: ya documentado en `eaTerminology.ts:136-149`.
2. **"Entregable" en UI = Solicitud de Entregable (nivel 3)**, nunca "charter item" ni "tarea".
3. **Códigos de iniciativa** siempre via `toInitiativeCode`/`formatInitiativeCode`/`nextInitiativeCode`.
4. **Separación productor/revisor** es invariante del planner (`reviewerId !== assigneeId`).

## Próximos pasos F1

- F1.2: Mapa de contextos delimitados y contratos.
- F1.3: Agregados, invariantes, eventos.
- F1.4: Modelo de autorización por permiso y alcance.
- F1.5: Modelo PostgreSQL.
- F1.6: ADRs.