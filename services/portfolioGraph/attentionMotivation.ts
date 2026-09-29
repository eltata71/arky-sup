/**
 * Why an attention exists, as generation reads it (plan de diagramas, 6.5).
 *
 * The rule of which initiatives an attention answers is the portfolio's (ids
 * first, codes only as migration). It ran inside a hook, so the paths that
 * generate without a screen — the Office's runner — could not ask it. This is
 * that rule as a function; the hook wraps it for React.
 */
import type { ArtifactBusinessMotivation } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import { describeInitiativeMotivation, type BusinessInitiative } from '../businessInitiatives/domain';
import { resolvePortfolioGraph } from './portfolioResolver';

export function initiativesServedBy(project: Project, initiatives: readonly BusinessInitiative[]): BusinessInitiative[] {
  const graph = resolvePortfolioGraph(initiatives, [project], [], { reportOrphanAttentions: false });
  const node = graph.attentions.find((entry) => entry.id === project.id);
  if (!node) return [];
  const byId = new Map(initiatives.map((entry) => [entry.id, entry]));
  return node.initiativeIds
    .map((id) => byId.get(id))
    .filter((entry): entry is BusinessInitiative => entry !== undefined);
}

export const describeAttentionMotivation = (
  project: Project,
  initiatives: readonly BusinessInitiative[],
): ArtifactBusinessMotivation[] => initiativesServedBy(project, initiatives).map(describeInitiativeMotivation);
