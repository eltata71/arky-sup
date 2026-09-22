/**
 * The Proyecto de Arquitectura context — the middle level of the hierarchy
 * `lib/eaTerminology.ts` names, and until now the only one without a module.
 *
 * Enter through here. The aggregate is built by `createArchitectureProject`
 * and by nothing else: that is what makes "an attention always belongs to an
 * initiative" a rule the compiler and a test can hold, instead of a sentence
 * in a document and a React component.
 */
export type {
  ArtifactSummary,
  AttentionContribution,
  AttentionContributionState,
  AttentionMilestone,
  AttentionMilestoneStatus,
  AttentionPriority,
  AttentionRisk,
  AttentionRiskLevel,
  AttentionStatus,
  Project,
  ProjectAttentionTracking,
  ProjectRoot,
} from './ArchitectureProjectTypes';

/**
 * El seguimiento de la atención, como reglas y no como pantallas.
 *
 * «Este proyecto está en riesgo» y «este proyecto ha avanzado un 40 %» son
 * afirmaciones del dominio: se comprueban sin renderizar nada y las lee tanto
 * el propio proyecto como la iniciativa que hereda sus riesgos.
 */
export {
  attentionDaysRemaining,
  attentionHealth,
  attentionProgress,
  contributionsToInitiative,
  describeAttentionDelivery,
  isClosedAttention,
  summarizeAttentionMilestones,
  summarizeAttentionRisks,
  CLOSED_ATTENTION_STATUSES,
  SEVERE_ATTENTION_RISK_LEVELS,
  type AttentionDeliveryReport,
  type AttentionHealth,
  type AttentionMilestoneSummary,
  type AttentionProgress,
} from './attentionTracking';
export {
  createArchitectureProject,
  newProjectView,
  type ArchitectureProjectRejection,
  type CreateArchitectureProjectInput,
  type CreateArchitectureProjectResult,
} from './architectureProjectFactory';
export {
  architectureProjectRepository,
  type ArchitectureProjectRepository,
} from './ArchitectureProjectRepository';

/**
 * Lo que `services/artifacts` necesita de este agregado.
 *
 * Desde ADR-106 el Artefacto es raíz de su propio agregado y se escribe con sus
 * comandos, así que la costura se estrechó: leer el proyecto (`getProject`) e
 * invalidar su caché (`forgetProject`), porque el documento del proyecto lleva
 * el índice y el contador que el servidor recalcula al escribir un artefacto.
 * `persistProjectAggregate` ya no sale de aquí: sólo lo usa la creación.
 */
export {
  toArtifactSummary,
  type PersistedProjectDocument,
  type ProjectDocument,
} from './projectDocumentMapper';
export { clearProjectCache, forgetProject } from './projectCache';
export { getProject } from './projectReads';
