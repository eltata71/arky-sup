# Motor de Compilación y Revisión de Artefactos

> **Módulo:** `services/artifactCompiler/`
> **Estado:** Fase 1 — motor central + contratos + validadores + reparación +
> scoring + trazabilidad, integrado de forma observe-only en la persistencia.
> **Compatibilidad:** aditivo y sin regresiones — el pipeline determinístico
> de diagramas, el scoring documental, el quality gate de exportación, la
> persistencia con rollback y la observabilidad existentes no cambian.

---

## 1. Qué es

El **Artifact Compiler** es una etapa formal que se ejecuta entre la
generación/normalización de un artefacto y su persistencia. Su trabajo es
**gobernar** el artefacto: resolver el contrato que debe cumplir, validarlo,
aplicar reparaciones seguras, calcular un score unificado, evaluar su
exportabilidad y producir una traza de compilación auditable.

No reemplaza nada de lo que ya existe: **delega** en los servicios de calidad
ya construidos y los orquesta bajo un contrato único por familia de artefacto.

```
Usuario → IA genera → ArtifactEnvelope (normalización)
        → Artefacto candidato
        → ░░ ArtifactCompiler ░░  ← nueva etapa formal
        → Persistencia (createArtifact / createArtifactVersion)
```

---

## 2. Arquitectura del módulo

```
services/artifactCompiler/
├── ArtifactCompiler.ts            # Orquestador — compileArtifact()
├── ArtifactCompilerTypes.ts       # Sistema de tipos del motor
├── ArtifactContract.ts            # Interfaz de contrato + helpers
├── ArtifactContractRegistry.ts    # Resolución tipo → contrato
├── ArtifactCompilationTrace.ts    # Grabador de traza de compilación
├── profiles/
│   └── contractDefinitions.ts     # Los 16 contratos formales
├── validators/
│   ├── sectionValidator.ts        # Análisis estructural determinístico
│   └── contractValidator.ts       # Validación contra contrato
├── repair/
│   └── documentRepair.ts          # Reparación segura no destructiva
├── scoring/
│   └── unifiedScore.ts            # Score unificado + ladder de tiers
└── index.ts                       # Superficie pública
```

### Garantías del orquestador

- **Nunca lanza excepciones.** Cualquier fallo interno produce un resultado
  `failed` seguro con el artefacto original intacto → la UI nunca queda en
  pantalla en blanco.
- **Nunca muta el artefacto de entrada.** Las reparaciones producen un objeto
  nuevo; sin reparaciones, `compiled === original` (igualdad por referencia).
- **La calidad de diagramas sigue siendo del pipeline determinístico.** Los
  contratos diagramáticos delegan en el quality gate de diagramas existente.

---

## 3. Contratos (`ArtifactContract`)

Un contrato es la especificación declarativa que una familia de artefactos
debe cumplir para considerarse de clase mundial. Define secciones esperadas,
reglas estructurales, mínimos de contenido, umbrales de score y exportabilidad.

Existen **16 contratos** registrados:

| Contrato | Tipos | Representación |
|---|---|---|
| `contract.document.markdown` | `markdown` | document |
| `contract.hybrid.text-diagram` | `hybrid-text-diagram` | hybrid |
| `contract.presentation.executive` | `presentation-executive` | document |
| `contract.presentation.technical` | `presentation-technical` | document |
| `contract.sdd.brd` | `sdd-brd` | document |
| `contract.sdd.use-case` | `sdd-use-case` | document |
| `contract.sdd.user-story` | `sdd-user-story` | document |
| `contract.sdd.domain-model` | `sdd-domain-model` | document |
| `contract.sdd.event-storming` | `sdd-event-storming` | document |
| `contract.sdd.glossary` | `sdd-glossary` | document |
| `contract.sdd.nfr` | `sdd-nfr` | document |
| `contract.sdd.bdd` | `sdd-bdd` | document |
| `contract.sdd.traceability` | `sdd-traceability` | document |
| `contract.diagram.mermaid` | `mermaid-*` (patrón) | diagram |
| `contract.diagram.react-flow` | `react-flow-graph` | diagram |
| `contract.document.yaml` | `yaml` | document |

La resolución (`resolveContract`) es determinística y nunca falla: tipo
explícito → patrón glob → fallback documental/diagramático según la forma del
tipo. Esto garantiza que tipos futuros sigan compilando con seguridad.

---

## 4. Validadores

### Documentales y SDD (`contractValidator.ts`)

Para artefactos documentales y SDD el motor ejecuta validación estricta:

- Contenido vacío → hallazgo **crítico** (`CONTRACT_EMPTY`).
- Contenido por debajo del mínimo → `CONTRACT_THIN_CONTENT`.
- Título H1 y encabezados ausentes → `CONTRACT_NO_TITLE` / `CONTRACT_NO_HEADINGS`.
- Secciones obligatorias del contrato ausentes → `CONTRACT_MISSING_SECTION`.
- Secciones con encabezado pero sin contenido → `CONTRACT_EMPTY_SECTION`.
- Marcadores `TBD/TODO/FIXME/PENDIENTE` → `CONTRACT_HARD_PLACEHOLDER`.
- Listas mal formadas y encabezados duplicados → hallazgos estructurales.
- Tablas esperadas ausentes → `CONTRACT_MISSING_TABLE`.
- Gherkin ausente (BDD) → `CONTRACT_MISSING_GHERKIN`.
- Matriz de trazabilidad sin tabla → `CONTRACT_MISSING_TRACEABILITY`.

Cada familia SDD declara sus secciones obligatorias (ver
`contractDefinitions.ts`): por ejemplo `sdd-brd` exige objetivo de negocio,
alcance, stakeholders, requerimientos funcionales y no funcionales, reglas de
negocio, supuestos, riesgos y criterios de aceptación.

### Diagramáticos

Los contratos diagramáticos sólo verifican que exista contenido renderizable;
**la calidad del diagrama se delega íntegramente** al quality gate existente
(`services/diagram/qualityGate.ts` vía `buildArtifactQualityReport`). No se
duplica lógica de scoring de diagramas.

---

## 5. Reparación automática segura (`documentRepair.ts`)

Las reparaciones son **deterministas y no destructivas**: sólo agregan o
normalizan, nunca reemplazan ni borran contenido del usuario.

| Reparación | Acción |
|---|---|
| `repair.title` | Agrega un H1 con el nombre del artefacto si falta. |
| `repair.sections` | Agrega secciones obligatorias faltantes con marcadores `_Pendiente de completar_` (sólo si `allowSectionScaffolding`). |
| `repair.placeholders` | Normaliza `TBD/TODO/FIXME` a marcadores controlados. |
| `repair.lists` | Corrige viñetas de lista mal formadas. |
| `repair.dedupe-headings` | Elimina encabezados duplicados vacíos. |

- Los diagramas **nunca** se reparan aquí (lo hace su propio pipeline).
- El contenido vacío **nunca** se repara (se marca `blocked`).
- Toda reparación queda registrada en la traza de compilación.

---

## 6. Scoring unificado y tiers

`computeUnifiedScore` consolida las señales existentes en 10 dimensiones
canónicas: estructura, completitud, claridad, trazabilidad, consistencia,
calidad ejecutiva, calidad técnica, exportabilidad, ausencia de errores
críticos y cumplimiento del contrato.

Reutiliza:

- `documentQualityService` para documentos,
- `diagramQualityService` / quality gate para diagramas,
- `artifactQualityGateService` para exportabilidad,

vía `buildArtifactQualityReport`, y añade la sub-dimensión de **cumplimiento
del contrato** calculada a partir de los hallazgos de validación.

**Ladder de tiers (umbrales fijos):**

| Tier | Rango |
|---|---|
| `world-class` | 90–100 |
| `ready` | 80–89 |
| `usable-with-warnings` | 70–79 |
| `needs-improvement` | 50–69 |
| `blocked` | < 50 o con error crítico |

---

## 7. Estados de compilación

| Estado | Significado |
|---|---|
| `passed` | Contrato satisfecho, sin reparaciones, tier ≥ ready, sin hallazgos altos. |
| `repaired` | Se aplicaron reparaciones seguras no destructivas. |
| `warning` | Usable pero con hallazgos no bloqueantes. |
| `blocked` | Vacío/corrupto/crítico o score < 50 — no debe persistirse como válido. |
| `failed` | El compilador falló de forma controlada; artefacto intacto. |

---

## 8. Integración

### Persistencia (Task 7)

`attachCompilerSummary` se invoca en `AppContext.createArtifact` y
`createArtifactVersion`. Es **observe-only**: ejecuta el compilador sin aplicar
reparaciones (no muta el contenido en el camino de persistencia), nunca lanza
y adjunta el resumen en `Artifact.compilation`. El comportamiento de
optimistic update y rollback no cambia.

> La reparación automática del contenido en el flujo de persistencia se deja
> como fase siguiente, porque requiere UX explícita de "revisar reparaciones"
> antes de sobrescribir lo que verá el usuario. El motor ya soporta reparación
> (`compileArtifact(artifact, { applyRepairs: true })`).

### Exportación (Task 8)

El resultado expone `exportReadiness` por familia (documento/diagrama/tabla),
derivado del quality gate de exportación existente. Una exportación documental
nunca se bloquea por un diagrama débil y viceversa.

### Observabilidad (Task 10)

`Artifact.compilation` (tipo `ArtifactCompilerSummary`) es un bloque aditivo y
retro-compatible con: `compilerContractId`, `compilerStatus`, `compilerScore`,
`compilerTier`, `compilerIssues`, `compilerRepairs`, `compilerRecommendations`,
`compiledAt`, `requiresHumanReview` y `exportReadiness`.

### UI (Task 9)

`GenerationTracePanel` muestra un bloque "Motor de compilación" con contrato,
estado, score, tier, hallazgos, reparaciones, recomendaciones, exportabilidad
y si requiere revisión humana. El bloque no depende sólo del color para la
severidad, usa etiquetas claras y respeta el modo oscuro.

---

## 9. API pública

```ts
import {
  compileArtifact,        // pase completo de compilación
  attachCompilerSummary,  // helper observe-only para persistencia
  buildCompilerSummary,   // proyecta un resultado al bloque persistible
  resolveContract,        // resuelve el contrato de un tipo
} from '@/services/artifactCompiler';

const result = compileArtifact(artifact);
// result.status, result.score, result.issues, result.repairs,
// result.recommendations, result.canRender, result.canExport,
// result.exportReadiness, result.requiresHumanReview, result.trace
```

---

## 10. Pruebas

`__tests__/artifactCompiler/` — 46 pruebas:

- `contractRegistry.test.ts` — resolución de contratos.
- `contractValidator.test.ts` — validación documental + cada familia SDD,
  artefactos vacíos, placeholders.
- `documentRepair.test.ts` — reparaciones no destructivas.
- `unifiedScore.test.ts` — scoring y tiers.
- `artifactCompiler.test.ts` — orquestador: artefactos vacíos/corruptos,
  delegación a diagramas, exportabilidad, no-pantalla-en-blanco, no
  persistencia de artefactos corruptos.

---

## 11. Criterios de aceptación cubiertos

1. ✅ Motor central de compilación de artefactos.
2. ✅ Cada artefacto creado pasa por contrato, validación, scoring y traza.
3. ✅ Los diagramas siguen usando el pipeline determinístico.
4. ✅ Documentos y SDD tienen validación específica por tipo.
5. ✅ Los errores críticos no generan pantalla en blanco (resultado `failed`).
6. ✅ Los artefactos corruptos quedan `blocked` y no exportables.
7. ✅ Reparaciones seguras, no destructivas y trazables.
8. ✅ Exportación alineada al estado de calidad del artefacto.
9. ✅ La UI muestra estado, score, hallazgos y recomendaciones.
10. ✅ Compatibilidad con artefactos existentes (campos aditivos opcionales).
11. ✅ Todos los tests pasan (1008 verdes).
12. ✅ El build de producción pasa.

---

## 12. Deuda remanente / siguiente fase

- Auto-reparación en el flujo de persistencia con UX de revisión previa.
- Integrar `compileArtifact` dentro de `geminiService` para corrección
  iterativa pre-persistencia (hoy `geminiService` concentra demasiada
  responsabilidad; la integración profunda se hará sin refactor masivo).
- Extender la UI del compilador a `ArtifactQualityPanel`,
  `ArtifactInspectorPanel`, `ArtifactStatusBadge` y `ArtifactExportModal`.
- Validadores diagramáticos contractuales más finos por dialecto Mermaid.
