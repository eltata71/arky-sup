/**
 * The export subsystem — registry, adapters and the two entry points.
 *
 * `services/export` had 23 files and no barrel, so every caller picked its own
 * door: `publicationPipeline` entered through four different files and
 * `services/quality` through two. That is not a module with a public API, it
 * is a directory. This file is the API; `modules.json` declares it and
 * `check:module-boundaries` keeps new code from going around it.
 *
 * The adapters are deliberately absent. They are chosen by `exportRegistry`
 * from an `ExportFormat`; a caller that names one directly has bypassed the
 * decision the registry exists to make.
 */
export * from './exportTypes';
export * from './exportService';
export * from './exportRegistry';
export * from './exportValidation';
export * from './downloadService';
export * from './publicationExportRenderer';
export * from './fileNameSanitizer';
export * from './exportTrace';
/**
 * La cara del módulo hacia un artefacto concreto.
 *
 * `artifactExportValidation` era `services/artifactValidationService.ts`, un
 * fichero suelto en la raíz de `services/` que no hacía otra cosa que
 * renombrar lo que este módulo ya publicaba. Vivía fuera porque lo llamaban el
 * canvas y dos hooks, no porque fuera de nadie más.
 *
 * `artifactExportPayload` (antes `services/artifactExportService.ts`) viene
 * con él por vecindad, y con una advertencia: **hoy no lo importa ningún
 * fichero de producción**, sólo una prueba. Se mueve en lugar de borrarse
 * porque quitar código es una decisión aparte de ordenar carpetas.
 */
export * from './artifactExportValidation';
export * from './artifactExportPayload';
