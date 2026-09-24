/**
 * The attentions list, as `ProjectsPage` reads it (F5-02): the Office's
 * portfolio portrait and, for every attention, the initiatives it serves.
 *
 * The page resolved both itself — the portfolio graph from
 * `services/portfolioGraph` and the portrait from `services/architectureOffice`
 * — beside the AI layer it uses to create attentions, which made it a screen
 * reaching three service modules. The relation is read from the resolved graph,
 * never from the code mirror on the project: ids win, and a legacy record that
 * only carries codes has already been migrated in memory by the resolver.
 */
import { useCallback, useMemo } from 'react';
import type { Project } from '../services/architectureProjects';
import type { BusinessInitiative } from '../services/businessInitiatives';
import { resolvePortfolioGraph } from '../services/portfolioGraph';
import {
  buildOfficePortfolio,
  type OfficeEngagement,
  type OfficePortfolio,
} from '../services/architectureOffice';
import type { AttentionInitiativeRef } from '../components/attentions';

export interface AttentionPortfolio {
  readonly portfolio: OfficePortfolio;
  /** The initiatives an attention serves, resolved by key. */
  initiativesFor(projectId: string): AttentionInitiativeRef[];
  /** Initiatives served by at least one attention. */
  readonly servedInitiatives: number;
  /** Attentions linked to no initiative. */
  readonly unlinkedCount: number;
}

export const useAttentionPortfolio = (
  initiatives: readonly BusinessInitiative[],
  projects: readonly Project[],
  engagements: readonly OfficeEngagement[],
): AttentionPortfolio => {
  const graph = useMemo(
    () => resolvePortfolioGraph(initiatives, projects, engagements),
    [initiatives, projects, engagements],
  );
  const portfolio = useMemo(
    () => buildOfficePortfolio(projects, engagements, { initiatives }),
    [projects, engagements, initiatives],
  );
  const initiativesByAttention = useMemo(() => {
    const byId = new Map(graph.initiatives.map((node) => [node.id, node]));
    const map = new Map<string, AttentionInitiativeRef[]>();
    for (const attention of graph.attentions) {
      map.set(attention.id, attention.initiativeIds
        .map((id) => byId.get(id))
        .filter((node): node is NonNullable<typeof node> => Boolean(node))
        .map((node) => ({ id: node.id, code: node.initiative.code, title: node.initiative.title })));
    }
    return map;
  }, [graph]);
  const initiativesFor = useCallback(
    (projectId: string): AttentionInitiativeRef[] => initiativesByAttention.get(projectId) ?? [],
    [initiativesByAttention],
  );
  return useMemo(() => ({
    portfolio,
    initiativesFor,
    servedInitiatives: graph.initiatives.filter((node) => node.attentions.length > 0).length,
    unlinkedCount: graph.unlinkedAttentions.length,
  }), [portfolio, initiativesFor, graph]);
};
