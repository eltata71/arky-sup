/**
 * Public surface of the Architecture Office.
 *
 * Per `CLAUDE.md`, a subsystem's barrel is what callers import from rather than
 * reaching into individual modules. Keep this in step when adding a module.
 *
 * Design and rationale: `docs/oficina-arquitectura.md`.
 */

// Personas, standards and shared helpers
export * from './domain';
/**
 * La mitad configurable de una persona: su ficha. Se publica junto al registro
 * porque nadie debería poder leer uno sin el otro — una pantalla que pinta
 * `OFFICE_AGENT_PERSONAS` sin resolver las fichas muestra la configuración por
 * defecto y contradice lo que el usuario acaba de guardar.
 */
export * from './infrastructure/OfficeAgentProfileRepository';

// Domain model

// Planning and execution
export * from './application/OfficeEngagementRunner';
export * from './infrastructure/OfficeRunnerAdapters';

// Persistence
export * from './infrastructure/OfficeEngagementRepository';
export * from './infrastructure/SupabaseOfficeEngagementRepository';

// Governance

// Observability
export * from './application/officeRunTrace';
export * from './infrastructure/officeTelemetry';

/**
 * El retrato del portafolio: el resumen por estado, la cola de decisiones, la
 * serie de actividad y la carga de cada especialista.
 *
 * Sale por la puerta del módulo y no por su ruta porque lo leen tres pantallas
 * y un hook. Entrar por el fichero desde cuatro sitios distintos es exactamente
 * el acoplamiento que `index.ts` existe para evitar, y aquí no hay motivo de
 * empaquetado que lo justifique: todo lo que lo consume es código diferido.
 */

/**
 * Servicios de aplicación: lo que una pantalla *decide*, fuera de la pantalla.
 * `captureAssistance` compone la asistencia de captura de un solo agente;
 * `assistantConsultation` compone la consulta al equipo completo; y
 * `platformGuidance` compone lo que la guía de uso sabe del producto —incluido
 * el reparto real de agentes, que por eso no puede desfasarse de este registro.
 */
export * from './application/captureAssistance';
export * from './application/copilotTurn';
// F5-02: la consulta al equipo y el alcance de cada nivel. Ya estaba en el
// cierre del barril —`captureAssistance` la importa—; publicarla es lo que deja
// a las pantallas entrar por la puerta en lugar de por la ruta.
export * from './application/assistantConsultation';
export type { CoordinationScope, CoordinationScopeLevel } from './application/officeCoordination';
export * from './application/officeCapabilities';
export * from './application/platformGuidance';
export * from './application/portfolioCommandCenter';
export * from './application/projectConversation';

// Legacy chat-triggered orchestration. Superseded by the engagement engine
// above; still reachable from the project copilot via "@Lucía coordina…".
export * from './application/officeOrchestration';

// `normalizeBusinessProjectIds` is the office's own normalisation of the
// `NEG-YYYY-NNN` codes, and the persistence layer needs it on every read.
export { normalizeBusinessProjectIds } from './domain/officeShared';
