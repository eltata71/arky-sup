# Paquetes de Publicación

> Agrupación de artefactos en entregables. Módulos:
> `PublicationPackageService.ts`, `PublicationTemplateRegistry.ts`,
> `PublicationReadinessService.ts`, `PublicationExportOrchestrator.ts`.

---

## 1. Qué es un paquete

Un `PublicationPackage` agrupa referencias a artefactos en un entregable con un
perfil de publicación, estado de gobierno, versión, calidad, accesibilidad,
trazabilidad, manifiesto y auditoría. Se persiste de forma aditiva en
`Project.publicationPackages`.

El paquete guarda **referencias congeladas** (`PublicationArtifactRef`): id,
versionGroupId, número de versión y snapshot de tier/score del compilador. Así
el paquete refleja un estado versionado, no "lo que el proyecto parezca ahora".

---

## 2. Creación

`createPublicationPackage(input, artifacts)`:

- desde una **selección manual** de ids de artefactos, o
- desde una **sugerencia por perfil** (`suggestPackageArtifacts`) cuando no se
  da selección — elige el artefacto de mayor calidad por cada requisito del
  perfil.

Los artefactos se resuelven siempre a su **última versión** dentro del grupo y
se ordenan en flujo editorial (`orderArtifactRefsEditorially`): documentos de
contexto primero, luego diagramas C4, modelos de datos, secuencias, especifica-
ciones SDD, glosario y matriz de trazabilidad al final.

---

## 3. Cobertura del perfil

Cada perfil declara `artifactRequirements` con semántica "cualquiera de N
tipos". `computeCoverage(profile, artifacts)` evalúa cada requisito y produce un
`PublicationCoverageResult` (`satisfied`, `matchedArtifactIds`, `message`). Un
requisito **obligatorio** no satisfecho genera un bloqueador
`profile-requirement-unmet` en el readiness.

Tipos de paquete soportados por los seis perfiles iniciales: artefacto
individual, conjunto de artefactos, paquete ejecutivo, paquete técnico, paquete
SDD, paquete de evaluación de proveedor, paquete de auditoría y paquete de
entrega a implementación.

---

## 4. Readiness del paquete

`evaluatePackageReadiness({ pkg, profile, artifacts, graph })` compone en un solo
`PublicationReadinessReport`:

- **preflight** del paquete (27 verificaciones);
- **accesibilidad** (nivel del perfil);
- **calidad** (puntajes del compilador agregados);
- **trazabilidad** (cobertura de requerimientos/riesgos y del grafo);
- **cobertura** del perfil;
- **exportación** (formatos disponibles vs. requeridos);
- **aprobación** (estado vs. exigencia del perfil).

El score global es ponderado (preflight 35 %, calidad 30 %, accesibilidad 20 %,
trazabilidad 15 %). El veredicto es `passed`, `warning` o `blocked`.

---

## 5. Manifiesto y reporte

- `generatePublicationManifest` produce el registro auditable del paquete.
- `buildPublicationReport` renderiza un reporte Markdown legible con veredicto,
  bloqueadores, advertencias, acciones, artefactos, cobertura, trazabilidad,
  formatos, aprobación, auditoría y recomendaciones.

---

## 6. Exportación coordinada

`PublicationExportOrchestrator.runPublicationExportBatch` ejecuta un lote de
trabajos (`PublicationExportJob`). Cada trabajo es un artefacto real (con
preflight) o un documento sintético de publicación (manifiesto, reporte, resumen
ejecutivo, evidencia de calidad/trazabilidad). Reutiliza los adaptadores de
`services/export/` — no los duplica. Devuelve outcomes por trabajo y entradas de
archivo para el manifiesto.

En esta fase la exportación es **individual coordinada** más manifiesto y
reporte. La base para un ZIP/documento maestro consolidado ya está modelada
(`PublicationExportJob`, `PublicationExportBatchResult`).

---

## 7. UI — Centro de Publicación

`components/publication/PublicationCenter.tsx` es el punto de entrada. Se abre
desde el encabezado del `ProjectHub` ("Publicación"). Permite: ver/crear
paquetes, evaluar readiness, ver preflight detallado, revisar accesibilidad,
conducir el flujo de aprobación, generar/inspeccionar el manifiesto, exportar y
recalcular. Accesible, con modo oscuro y usable en iPad.
