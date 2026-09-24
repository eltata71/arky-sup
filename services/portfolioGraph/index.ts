/**
 * The portfolio as a keyed graph — the single place that knows how the four
 * levels relate to one another.
 *
 * Import from this barrel; the split between types, resolution and search is
 * an implementation detail.
 */
export * from './PortfolioGraphTypes';
export {
  resolvePortfolioGraph,
  pathTo,
  codesForInitiativeIds,
} from './portfolioResolver';
export type { ResolveOptions } from './portfolioResolver';
export {
  initiativeLinksFor,
  resolveAttentionInitiativeLinks,
  withoutInitiativeCode,
} from './attentionInitiativeLinks';
export type {
  AttentionInitiativeLinkSource,
  AttentionInitiativeLinkState,
  InitiativeLinks,
} from './attentionInitiativeLinks';
export { searchPortfolio, relatedTo } from './portfolioSearch';
export type { PortfolioSearchHit, PortfolioSearchOptions } from './portfolioSearch';
