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
 * Un artefacto vive dentro del Proyecto —en su tabla hija, en su
 * `artifactCount`, en su índice— así que escribirlo es escribir el agregado.
 * `persistProjectAggregate` es esa costura, y es deliberadamente estrecha: la
 * caché de proyectos se invalida con `forgetProject` y no exponiendo el `Map`.
 */
export { toArtifactSummary, type ProjectDocument } from './projectDocumentMapper';
export { clearProjectCache, forgetProject } from './projectCache';
export { getProject } from './projectReads';
export { persistProjectAggregate } from './projectWrites';
export { forgetProjectRevisions, knownProjectRevision } from './SupabaseProjectRepository';
