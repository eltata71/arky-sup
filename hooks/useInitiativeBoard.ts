/**
 * The initiatives board: the rollup and how many attentions serve each
 * initiative (F5-02).
 *
 * `InitiativesPage` resolved the portfolio graph and the rollup itself, which
 * with the assistant made it a screen reaching four service modules. The
 * counting rule is the portfolio's — attentions are counted by key, never by
 * the `NEG-YYYY-NNN` mirror, which would miss every attention linked by id
 * without the code written back — and this hook is where the screen meets it.
 */
import { useMemo } from 'react';
import type { Project } from '../services/architectureProjects';
import { resolvePortfolioGraph } from '../services/portfolioGraph';
import {
  rollupInitiatives,
  type BusinessInitiative,
  type InitiativePortfolioRollup,
} from '../services/businessInitiatives';

export interface InitiativeBoard {
  readonly rollup: InitiativePortfolioRollup;
  /** Attentions serving each initiative, by initiative id. */
  readonly attentionsById: ReadonlyMap<string, number>;
  /** Attentions linked to at least one initiative. */
  readonly attentionCount: number;
}

export const useInitiativeBoard = (
  initiatives: readonly BusinessInitiative[],
  projects: readonly Project[],
): InitiativeBoard => {
  const rollup = useMemo(() => rollupInitiatives(initiatives), [initiatives]);
  const graph = useMemo(
    () => resolvePortfolioGraph(initiatives, projects, []),
    [initiatives, projects],
  );
  return useMemo(() => {
    const attentionsById = new Map<string, number>();
    for (const node of graph.initiatives) attentionsById.set(node.id, node.attentions.length);
    return {
      rollup,
      attentionsById,
      attentionCount: graph.attentions.length - graph.unlinkedAttentions.length,
    };
  }, [graph, rollup]);
};
