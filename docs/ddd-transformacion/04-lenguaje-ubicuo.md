# Lenguaje ubicuo

`lib/eaTerminology.ts` es la fuente de los nombres **de cara al usuario**, y lo
cumple. Este documento resuelve la otra mitad: los nombres **en el código**,
donde sí hay colisiones.

## Los cuatro niveles

| Nivel | Nombre de usuario (es) | Tipo en el código | Tabla | Contexto dueño |
|---|---|---|---|---|
| 1 | Iniciativa de Negocio | `BusinessInitiative` | `api.business_initiatives` | Iniciativas y Portafolio |
| 2 | Proyecto de Arquitectura (*Atención*) | `Project` | `api.architecture_projects` | Proyectos de Arquitectura |
| 3 | Solicitud de Entregable | `OfficeEngagement` | `api.office_engagements` | Encargos y Gobernanza |
| 4 | Artefacto | `Artifact` | `api.project_artifacts` | Entregables y Publicación |

## La colisión «Project / Attention / Proyecto / Atención»

**Cuatro palabras para el nivel 2, y una quinta para otra cosa.** Medido:
`Attention`/`attention` aparece **565 veces en 62 ficheros**.

| Palabra | Dónde | Qué nombra |
|---|---|---|
| `Project` | `types.ts`, `services/architectureProjects`, `api.architecture_projects` | el nivel 2 |
| `Proyecto de Arquitectura` | UI, `eaTerminology.singular` | el nivel 2 |
| `Atención` / `Attention` | `AttentionInitiativeGate`, `attentionTracking`, `AttentionContribution`, `useCreateAttention`, `AttentionDetailsPanel` | el nivel 2 |
| `linkedBusinessProjects` / `businessProjectIds` | `Project`, `OfficeEngagement` | códigos `NEG-…` del nivel **1** |
| `project` en `OfficeEngagement.projectId` | Encargos | el nivel 2 |

La quinta es la peligrosa: **`businessProjects` nombra iniciativas**, no
proyectos. Un lector que abre `OfficeEngagement.businessProjectIds` esperando
proyectos encuentra códigos de iniciativa.

### Decisión (ADR-100)

1. **El nombre canónico en el código del nivel 2 es `Project`.** Es el nombre
   del tipo, de la tabla y del módulo, y renombrarlo tocaría 565 sitios sin
   cambiar una sola regla. El encargo prohíbe expresamente confundir mover con
   desacoplar.
2. **`Attention` queda como sinónimo *congelado*.** Se permite en lo que ya
   existe; **prohibido en código nuevo**. El día que un símbolo `Attention`
   cambie por otra razón, se renombra de paso.
3. **`businessProject*` se renombra**, porque no es un sinónimo sino un nombre
   equivocado: `initiativeCodes` / `linkedInitiativeCodes`. Es un cambio con
   migración (el campo está persistido) y entra en F3-05, con el contexto
   piloto. Hasta entonces, el espejo documenta en su propio tipo que contiene
   códigos `NEG-YYYY-NNN` de **iniciativa**.
4. **«Entregable» nombra el nivel 3 y nada más** — ya vigente en
   `eaTerminology.ts`, se mantiene.

## Vocabulario de gobernanza

| Término | Significado exacto | Dónde vive |
|---|---|---|
| **Charter** | el alcance que un revisor firma antes de ejecutar | `OfficeCharter` |
| **Charter aprobado** | `charter.approvedAt !== undefined` | `isCharterApproved` |
| **Run** | un intento de ejecución; un encargo **se reanuda**, no se reinicia | `currentRunId` |
| **Gate** | evaluación determinista de calidad con evidencia | `gateAssessment` |
| **ARB** | el comité que decide; su registro es inmutable | `api.office_arb_decisions` |
| **Veredicto** | `approved \| changes-requested \| rejected` | `OfficeArbVerdict` |
| **Revisión** (`revision`) | contador optimista de la fila, **no** la revisión de un artefacto | columna `revision` |

> **Colisión registrada, sin resolver todavía.** «Revisión» significa dos cosas:
> el contador de concurrencia (`revision bigint`) y el acto de revisar un
> artefacto (`services/review`, `OfficeTask.review`). En español no se distinguen.
> Propuesta: llamar **«versión de fila»** al contador en toda superficie de
> usuario y dejar «revisión» para el acto. Decisión pendiente — F3-05.

## Lo que deliberadamente **no** se renombra

- `services/architectureProjects` → el módulo ya habla el idioma del nivel 2.
- `OfficeEngagement` → «encargo» y «solicitud de entregable» conviven; el primero
  es el término interno del motor y el segundo el de usuario. Es una traducción,
  no una ambigüedad.
