/**
 * Business initiatives — the top of the hierarchy.
 *
 * Import from this barrel rather than reaching into the modules: the split
 * between types, persistence and metrics is an implementation detail.
 */
export * from './BusinessInitiativeTypes';
export * from './initiativeMetrics';
/**
 * Lo que los proyectos mueven en la iniciativa, consolidado. Declara su propio
 * puerto: la iniciativa no conoce el módulo de proyectos, sólo la forma del
 * parte que espera de cada uno.
 */
export * from './initiativeDelivery';
export {
  buildInitiative,
  deleteInitiative,
  listInitiatives,
  normalizeInitiative,
  saveInitiative,
  newInitiativeId,
  newOutcomeId,
  newKpiId,
  newRiskId,
  newStakeholderId,
  newDocumentId,
  newMilestoneId,
} from './BusinessInitiativeRepository';
export type { CreateInitiativeInput } from './BusinessInitiativeRepository';
export {
  createSupabaseBusinessInitiativeRepository,
  type SupabaseBusinessInitiativeRepository,
  type SupabaseBusinessInitiativesClientLike,
} from './SupabaseBusinessInitiativeRepository';

/**
 * La puerta del agregado. `buildInitiative` sigue exportado porque el
 * repositorio lo usa al normalizar lo que lee, pero para *crear* una
 * iniciativa nueva se entra por aquí: es donde viven las reglas que deciden si
 * puede existir.
 */
export {
  createBusinessInitiative,
  type BusinessInitiativeRejection,
  type CreateBusinessInitiativeParams,
  type CreateBusinessInitiativeResult,
} from './businessInitiativeFactory';
