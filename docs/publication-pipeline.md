# Pipeline de Publicación Profesional

> Tercera recomendación world-class para Arky Pro. Convierte artefactos
> validados y trazables en **entregables profesionales, accesibles, gobernados
> y auditables**, listos para comité, arquitectura empresarial, proveedores,
> auditoría, implementación y operación.

Este documento es la referencia conceptual y técnica del módulo
`services/publicationPipeline/`.

---

## 1. Objetivo

Las dos recomendaciones previas dejan a Arky generando artefactos de alta
calidad:

1. **Motor de Compilación y Revisión** (`services/artifactCompiler/`) — valida,
   repara, califica y gobierna la calidad de cada artefacto.
2. **Architecture Knowledge Graph** (`services/architectureKnowledgeGraph/`) —
   asegura consistencia y trazabilidad entre artefactos, entidades,
   requerimientos, riesgos y decisiones.

El **Pipeline de Publicación** es la capa que sigue: no reemplaza nada, *lee*
ambos motores y transforma los artefactos en **paquetes publicables**. Un
paquete es un entregable con perfil editorial, control de calidad, accesibilidad,
trazabilidad, aprobación formal, versionado, manifiesto y exportación profesional.

El módulo es **aditivo y compatible hacia atrás**: nunca muta tipos legacy y los
paquetes se persisten en `Project.publicationPackages` como bloque opcional.
Todo punto de entrada es **total** — nunca lanza excepciones, degrada con
seguridad para que la UI jamás muestre una pantalla en blanco.

---

## 2. Modelo conceptual

```
Artefactos validados ─▶ Paquete de publicación ─▶ Entregable profesional
   (compiler + AKG)          (perfil + estado)        (manifiesto + export)
```

| Concepto | Descripción |
|---|---|
| **Perfil** (`PublicationProfile`) | Contrato de una clase de entregable: audiencia, propósito, secciones requeridas, cobertura de artefactos, umbral de calidad, nivel de accesibilidad, formatos, banderas de gobierno. |
| **Plantilla** (`PublicationTemplate`) | Estructura editorial ordenada (portada, TOC, control de versiones, secciones, apéndices, pie). Desacoplada del UI. |
| **Paquete** (`PublicationPackage`) | Conjunto versionado de referencias a artefactos, con estado, calidad, accesibilidad, trazabilidad, manifiesto y auditoría. |
| **Preflight** | 27 verificaciones deterministas que deciden si un artefacto o paquete está listo. |
| **Readiness** | Composición de preflight + accesibilidad + calidad + trazabilidad + cobertura + exportación + aprobación en un veredicto. |
| **Manifiesto** | Registro auditable e infalsificable de qué contiene un paquete publicado. |
| **Reporte** | Documento Markdown legible derivado del readiness. |

### Estructura del módulo

```
services/publicationPipeline/
├── PublicationPipelineTypes.ts        # Modelo canónico tipado + helpers puros
├── PublicationObservability.ts        # Eventos del pipeline (Task 16)
├── PublicationBrandingService.ts      # Branding sin secretos
├── PublicationTemplateRegistry.ts     # 6 perfiles + plantillas editoriales
├── PublicationRuntimeValidation.ts    # Validación runtime (Task 17)
├── PublicationQualityBridge.ts        # Puente a compiler + AKG (Tasks 13/14)
├── PublicationAccessibilityService.ts # Validación de accesibilidad (Task 7)
├── PublicationPreflightService.ts     # 27 verificaciones de preflight (Task 4)
├── PublicationAuditTrailService.ts    # Auditoría append-only (Task 8/19)
├── PublicationApprovalService.ts      # Flujo de aprobación gobernado (Task 8)
├── PublicationVersionService.ts       # Versionado y detección de drift (Task 9)
├── PublicationReadinessService.ts     # Readiness + reporte (Tasks 3/12)
├── PublicationManifestService.ts      # Manifiesto auditable (Task 3/19)
├── PublicationPackageService.ts       # CRUD y orden editorial (Task 10)
├── PublicationExportOrchestrator.ts   # Orquestación de exportación (Task 11)
├── PublicationPersistenceAdapter.ts   # Persistencia aditiva (Task 18)
├── PublicationPipelineService.ts      # Fachada de composición
└── index.ts                           # Barrel público
```

UI: `components/publication/` (Centro de Publicación y paneles).

---

## 3. Perfiles de publicación

Seis perfiles iniciales (`PublicationTemplateRegistry.ts`):

| Perfil | Audiencia | Propósito | Aprobación | Trazabilidad |
|---|---|---|---|---|
| Executive Architecture Brief | `executive` | `executive-briefing` | Sí | No |
| Technical Architecture Package | `technical` | `architecture-review` | Sí | Sí |
| Solution Design Document Package | `technical` | `technical-design` | Sí | Sí |
| Vendor Evaluation Package | `vendor` | `vendor-evaluation` | Sí | No |
| Audit Evidence Package | `audit` | `audit-evidence` | Sí | Sí |
| Implementation Handoff Package | `implementation-team` | `implementation-handoff` | No | Sí |

Cada perfil declara `requiredSections`, `artifactRequirements` (con semántica
"cualquiera de N tipos"), `qualityThreshold`, `accessibilityLevel`,
`exportFormats` y banderas de gobierno. Resolución: `getPublicationProfile`,
`resolvePublicationProfile` (con fallback), `getProfileByAudience`.

---

## 4. Paquetes

`PublicationPackageService.ts` crea paquetes desde una selección manual o desde
una sugerencia por perfil (`suggestPackageArtifacts`), ordena los artefactos en
flujo editorial (`orderArtifactRefsEditorially`) y mantiene las referencias
consistentes. Ver `docs/publication-packages.md`.

---

## 5. Preflight

`PublicationPreflightService.ts` corre 27 verificaciones: artefactos vacíos /
corruptos / con compilación fallida / con bajo puntaje / con issues críticos,
diagramas con esqueleto / nodos huérfanos / pocas relaciones, documentos sin
objetivo / alcance / riesgos / decisiones, SDD sin secciones, matrices vacías,
diccionarios sin campos, trazabilidad insuficiente, inconsistencias del grafo,
requerimientos sin cobertura, riesgos sin mitigación, decisiones sin impacto,
artefactos sin versión / estado de revisión / aprobación, exportadores no
disponibles, formatos incompatibles, accesibilidad y estructura editorial.

Devuelve `passed`, `blocked`, `warnings`, `score`, `requiredActions`,
`optionalActions`, `canPublish`, `canExport`, `requiresApproval`,
`requiresHumanReview`.

---

## 6. Accesibilidad

`PublicationAccessibilityService.ts` valida jerarquía de encabezados, texto
alternativo de diagramas, tablas con encabezados, estructura navegable, títulos
legibles y contenido exportable. Produce score, issues, recomendaciones y un
veredicto bloqueante según el nivel del perfil. Ver
`docs/publication-accessibility.md`.

---

## 7. Aprobación, versionado y auditoría

Ver `docs/publication-governance.md`.

---

## 8. Manifiesto

`PublicationManifestService.ts` genera un `PublicationManifest`: registro
auditable con artefactos, versiones, puntajes de calidad y accesibilidad,
cobertura de trazabilidad y del grafo, archivos exportados, datos de aprobación
y resumen de auditoría. **No contiene secretos**: `assertManifestIsSafe` recorre
el manifiesto y reporta cualquier clave sensible (API keys, tokens, contraseñas).

---

## 9. Integración con el Artifact Compiler (Task 14)

`PublicationQualityBridge.resolveArtifactCompilation` reutiliza el snapshot
persistido `artifact.compilation` cuando existe y solo recompila (modo
observe-only, sin reparaciones) cuando falta. El preflight bloquea o advierte
según `compilerStatus`, `compilerTier`, `compilerScore` y `compilerIssues`.

---

## 10. Integración con el Architecture Knowledge Graph (Task 13)

`PublicationQualityBridge.buildTraceabilityResult` usa
`analyzeArchitectureTraceability`, `analyzeArchitectureConsistency`,
`getRequirementsWithoutCoverage`, `getRisksWithoutMitigation` y
`getDecisionsWithoutImpact`. La cobertura del grafo se calcula por artefacto con
`getEntitiesInArtifact`. Las inconsistencias críticas del grafo se inyectan como
bloqueadores del preflight cuando el perfil exige trazabilidad.

---

## 11. Exportación

`PublicationExportOrchestrator.ts` **reutiliza** los adaptadores de
`services/export/` (DOCX, PDF, HTML, Markdown, JSON, XLSX, CSV, PNG, SVG,
Mermaid, diagram-json) — nunca los duplica. Exporta artefactos reales (con
preflight) y documentos sintéticos de publicación (manifiesto, reporte, resumen
ejecutivo, evidencia de calidad y de trazabilidad) envolviendo su Markdown en un
artefacto desechable. No bloquea una exportación documental por fallas
diagramáticas ni viceversa.

---

## 12. Persistencia (Task 18)

`PublicationPersistenceAdapter.ts` persiste los paquetes de forma aditiva en el
campo `Project.publicationPackages` del documento del proyecto. La lectura corre
validación runtime (paquetes corruptos descartados, válidos preservados). Está
preparado para migrar a una subcolección Firestore sin tocar a los llamadores
(`getPublicationSubcollectionPath`). La escritura pasa por el camino estándar de
`updateProject` en `AppContext`, así que el rollback optimista y el control de
concurrencia se mantienen sin cambios.

---

## 13. Observabilidad (Task 16)

`PublicationObservability.ts` emite eventos a través de `observabilityService`:
`publication.preflight.*`, `publication.package.*`, `publication.export.*`,
`publication.accessibility.checked`, `publication.approval.changed`,
`publication.manifest.generated`, `publication.version.created`,
`publication.package.outdated`, `publication.override.used`. Los fallos siempre
son visibles para el usuario.

---

## 14. Limitaciones

- La exportación consolidada (un ZIP maestro o un DOCX/PDF maestro único) no
  está incluida: hoy se exporta artefacto por artefacto de forma coordinada más
  manifiesto y reporte. La base extensible ya existe (`PublicationExportJob`,
  `runPublicationExportBatch`).
- Las plantillas editoriales describen bloques ordenados pero no aún un layout
  corporativo configurable por organización.
- El branding es mínimo (organización, confidencialidad, color, pie); no hay
  todavía un editor de marca corporativa.
- La aprobación es de un solo nivel; no hay flujos multi-aprobador ni firma
  digital formal.
- La persistencia usa un campo en el documento del proyecto; proyectos con
  muchísimos paquetes podrían migrar a subcolección (adapter ya preparado).

---

## 15. Deuda remanente y plan futuro

Ver `docs/technical-debt-audit.md` (sección Publicación). Próxima fase de
madurez empresarial:

1. **Publicación consolidada**: ZIP maestro y DOCX/PDF maestro único.
2. **Plantillas corporativas configurables** por organización.
3. **Colaboración multiusuario avanzada** sobre paquetes (revisión concurrente).
4. **Firma y aprobación formal avanzada**: multi-aprobador, firma digital,
   evidencia criptográfica.
5. **Subcolección Firestore** para paquetes en proyectos de gran escala.
