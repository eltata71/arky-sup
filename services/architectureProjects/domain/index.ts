/**
 * El dominio de Proyectos de Arquitectura: reglas puras, sin E/S, sin React
 * (F6-03, segundo corte).
 *
 * Aquí viven la forma del agregado (`ProjectRoot`) y su modelo de lectura
 * (`Project`), la fábrica que decide si un proyecto puede existir, la lectura
 * de lo almacenado —el documento y su validación en tiempo de ejecución— y el
 * seguimiento de la atención. `infrastructure/` tiene el adaptador de Supabase,
 * la caché y el repositorio; `application/`, la recuperación de la proyección
 * del grafo, que orquesta puertos.
 *
 * `__tests__/architecture/contextDomainPurity.test.ts` sigue el cierre de
 * imports de valor de esta carpeta y falla si alcanza persistencia,
 * adaptadores, observabilidad, React o una pantalla. Es el patrón del contexto
 * piloto (Iniciativas, F3-05), con una diferencia medida: este dominio lee
 * tipos de otros contextos (el grafo, la publicación, la memoria) y dos
 * funciones puras de ellos, porque el modelo de lectura del proyecto los
 * contiene. Lo que la prueba prohíbe es la E/S, no el vocabulario compartido.
 */
export * from './ArchitectureProjectTypes';
export * from './architectureProjectFactory';
export * from './attentionTracking';
export * from './projectDocumentMapper';
export * from './projectRuntimeValidation';
export * from './projectCommands';
