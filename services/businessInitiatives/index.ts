/**
 * Business initiatives — the top of the hierarchy, and the pilot context of the
 * DDD transformation (F3-05).
 *
 * Two folders and one door:
 *
 *  - `domain/` — the rules: the aggregate's shape, its identities and
 *    revision, how a stored record is read, the factory that decides whether an
 *    initiative may exist, the named operations (`applyInitiativeCommand`) that
 *    replaced `update(partial)`, and the rollups. Pure; tested without mocks.
 *  - `infrastructure/` — the persistence: the Supabase adapter and the
 *    repository with its local mirror.
 *
 * Consumers enter through this file. What it publishes from `infrastructure/`
 * is the repository's three operations, which the context calls; the adapter
 * factory stays inside, because nothing outside the module has a reason to
 * build one.
 */
export * from './domain';
export {
  clearInitiativeCache,
  deleteInitiative,
  listInitiatives,
  saveInitiative,
} from './infrastructure/BusinessInitiativeRepository';
