/**
 * Public surface of the Architecture Office.
 *
 * Per `CLAUDE.md`, a subsystem's barrel is what callers import from rather than
 * reaching into individual modules. Keep this in step when adding a module.
 *
 * Design and rationale: `docs/oficina-arquitectura.md`.
 */

// Personas, standards and shared helpers
export * from './officeAgentPersonas';
/**
 * La mitad configurable de una persona: su ficha. Se publica junto al registro
 * porque nadie debería poder leer uno sin el otro — una pantalla que pinta
 * `OFFICE_AGENT_PERSONAS` sin resolver las fichas muestra la configuración por
 * defecto y contradice lo que el usuario acaba de guardar.
 */
export * from './agentDefinition';
export * from './agentHandoff';
export * from './agentRegistry';
export * from './officeAgentProfile';
export * from './OfficeAgentProfileRepository';
export * from './officeArchitectureKnowledge';
export * from './officeShared';

// Domain model
export * from './OfficeTypes';

// Planning and execution
export * from './OfficeAgentRouter';
export * from './OfficeEngagementPlanner';
export * from './OfficeEngagementRunner';
export * from './OfficeRunnerAdapters';

// Persistence
export * from './OfficeEngagementRepository';
export * from './SupabaseOfficeEngagementRepository';

// Governance
export * from './officeArtifactValidators';
export * from './officeQualityGates';
export * from './OfficeArbService';
export * from './officePublicationBridge';

// Observability
export * from './officeRunTrace';
export * from './officeTelemetry';

/**
 * El retrato del portafolio: el resumen por estado, la cola de decisiones, la
 * serie de actividad y la carga de cada especialista.
 *
 * Sale por la puerta del módulo y no por su ruta porque lo leen tres pantallas
 * y un hook. Entrar por el fichero desde cuatro sitios distintos es exactamente
 * el acoplamiento que `index.ts` existe para evitar, y aquí no hay motivo de
 * empaquetado que lo justifique: todo lo que lo consume es código diferido.
 */
export * from './officePortfolio';

/**
 * Servicios de aplicación: lo que una pantalla *decide*, fuera de la pantalla.
 * `captureAssistance` compone la asistencia de captura de un solo agente;
 * `assistantConsultation` compone la consulta al equipo completo; y
 * `platformGuidance` compone lo que la guía de uso sabe del producto —incluido
 * el reparto real de agentes, que por eso no puede desfasarse de este registro.
 */
export * from './application/captureAssistance';
export * from './application/platformGuidance';
export * from './application/portfolioCommandCenter';

// Legacy chat-triggered orchestration. Superseded by the engagement engine
// above; still reachable from the project copilot via "@Lucía coordina…".
export * from './officeOrchestration';

// `normalizeBusinessProjectIds` is the office's own normalisation of the
// `NEG-YYYY-NNN` codes, and the persistence layer needs it on every read.
export { normalizeBusinessProjectIds } from './officeShared';
