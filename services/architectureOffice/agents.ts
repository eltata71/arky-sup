/**
 * The agents' cards — a small door (F6-05).
 *
 * `/agents` reads and edits the thirteen cards; it never calls a model. Through
 * the barrel it downloaded the AI layer, the agent executor and ELK anyway —
 * about 600 KB gz — because the barrel republishes the Office's orchestration,
 * and that carries top-level side effects tree-shaking cannot drop.
 *
 * Nothing here calls a model. A module that does, does not belong behind this door.
 */
export * from './domain/officeAgentProfile';
export * from './infrastructure/OfficeAgentProfileRepository';
export * from './domain/officeArchitectureKnowledge';
export { DEFAULT_MAX_SPECIALISTS } from './application/officeOrchestration';
export type { OfficeAgentId } from './domain/agentDefinition';
