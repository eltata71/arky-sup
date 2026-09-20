# Mapa de contextos

Siete contextos de negocio y seis capacidades técnicas. La pregunta que decide
si algo es contexto o capacidad: **¿tiene reglas propias que el negocio
reconocería?** Un diagrama bien enrutado no es una regla de negocio; un charter
sin aprobar que no se puede ejecutar, sí.

---

## Contextos de negocio

| # | Contexto | Módulos hoy | Agregados |
|---|---|---|---|
| 1 | **Iniciativas y Portafolio** | `services/businessInitiatives`, `services/portfolioGraph` | `BusinessInitiative` |
| 2 | **Proyectos de Arquitectura** | `services/architectureProjects` | `Project` |
| 3 | **Encargos y Gobernanza** | `services/architectureOffice` | `OfficeEngagement`, `OfficeArbDecision` |
| 4 | **Entregables y Publicación** | `services/artifacts`, `services/artifactCompiler`, `services/review`, `services/publicationPipeline`, `services/quality` | `Artifact`, `PublicationPackage` |
| 5 | **Conocimiento Arquitectónico** | `services/architectureKnowledgeGraph`, `services/contextGraph` | `ArchitectureGraph` (proyección) |
| 6 | **Aprendizaje** | `services/learning` | `Course`, `UserProgress` |
| 7 | **Identidad y Acceso** | `services/identity`, `services/settings`, `lib/authz` | `UserProfile` |

## Capacidades técnicas

`services/ai` · `services/diagram` · `services/export` · `services/persistence` +
`services/adapters` + `services/ports` · `services/observability` ·
`services/lucid`, `services/memory`, `services/chat`, `services/presentation`.

> **`services/agent` está mal clasificado y se corrige en F5-02.** Declara el
> puerto `AgentPersonaBriefing` y no conoce la Oficina —ése es el patrón bueno—
> pero clasifica intención, planifica y ejecuta acciones de dominio. Es la capa
> de aplicación de Encargos disfrazada de capacidad técnica.

---

## Relaciones proveedor / consumidor

La dirección la fija una pregunta: **¿quién puede cambiar sin avisar al otro?**
El proveedor (*upstream*) puede; el consumidor (*downstream*) se adapta.

```
Identidad y Acceso ──────────────────► todos           (proveedor de todos)
        │
Iniciativas ──────► Proyectos ──────► Encargos ──────► Entregables
     ▲ puerto           ▲ puerto          │                  │
     └───────────────── │                 ▼                  ▼
                        └──────── Conocimiento ◄─────────────┘
                                        (proyección, sólo lectura aguas arriba)
Aprendizaje ── independiente
```

| Proveedor → Consumidor | Patrón | Estado |
|---|---|---|
| Identidad → todos | *conformist* sobre `lib/authz` | ✅ |
| Iniciativas → Proyectos | referencia por id, resuelta en `portfolioGraph` | ✅ |
| Proyectos → Iniciativas | **puerto invertido** (`InitiativeDeliveryPort` / `describeAttentionDelivery`) | ✅ **el patrón a replicar** |
| Encargos → Proyectos | `OfficeEngagement.projectId` | ✅ |
| Encargos → Entregables | el runner produce artefactos por `executeAgentAction` | ⚠️ escribe vía el agregado de Proyectos (H05) |
| Entregables → Conocimiento | los artefactos alimentan el grafo | ⚠️ sin outbox (H11) |
| Conocimiento → Publicación | 7 imports profundos | ⚠️ |
| Encargos → Agente | **puerto invertido** (`AgentPersonaBriefing`) | ✅ |
| Portafolio → Oficina | **puerto invertido** (`InitiativeSignalPort`) | ✅ |
| Todos → IA | *conformist* sobre las fachadas de `generation/` | ❌ roto por `geminiService` (H12) |

## Contratos publicados y regla de compatibilidad

Un contrato publicado es lo que un `index.ts` exporta. Hoy **264 imports
profundos** dicen que la regla no se cumple: el contrato real es todo el módulo.

**Regla a aplicar desde F3-05:**

1. Un `index.ts` publica **tipos, comandos, consultas y funciones puras**. Nunca
   una instancia de repositorio, un adaptador, una caché ni un motor.
2. Un cambio que quita o estrecha algo publicado es **incompatible** y necesita
   ADR. Añadir es compatible.
3. Quien necesita algo no publicado abre una petición al contexto dueño; no
   entra por debajo. El presupuesto de imports profundos es la deuda de esa
   regla, y sólo baja.

## Núcleo compartido — deliberadamente pequeño

Hoy: `types.ts` (339 líneas), `lib/eaTerminology.ts`, `lib/artifacts/`,
`lib/ai/modelCatalog.ts`, `lib/authz/`.

**Criterio de admisión (ADR-103):** entra sólo un contrato **sin comportamiento**
que necesitan **tres o más** contextos. Dos contextos que comparten un tipo no
justifican un núcleo: justifican un puerto en el que lo necesita.

## Consistencia inmediata vs eventual

| Frontera | Consistencia | Razón |
|---|---|---|
| Dentro de un agregado | inmediata, una transacción | es la definición de agregado |
| Encargo ↔ decisión ARB | **inmediata** — es una sola decisión de gobierno | H01 la rompe |
| Proyecto ↔ iniciativa | **inmediata** en la referencia | H08 la rompe |
| Artefacto ↔ grafo de conocimiento | eventual | es una proyección |
| Artefacto ↔ paquete de publicación | eventual | el paquete es una foto fechada |
| Cualquier cosa ↔ LMS | ninguna | contextos independientes |
