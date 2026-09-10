/**
 * Search across the four levels, over the resolved graph.
 *
 * Searching the raw collections would give a flat list of names with no way to
 * tell an artifact called "Visión" in one attention from the same name in
 * another. Searching the graph gives every hit its **path**, so the result
 * reads as a location rather than a name, and selecting one is unambiguous.
 *
 * Matching is accent- and case-insensitive because the content is Spanish and
 * nobody types "Modernización" with the accent in a search box.
 */

import { foldOfficeText } from '../architectureOffice/officeShared';
import type {
  PortfolioGraph,
  PortfolioLevel,
  PortfolioNode,
  PortfolioPath,
} from './PortfolioGraphTypes';
import { pathTo } from './portfolioResolver';

export interface PortfolioSearchHit {
  node: PortfolioNode;
  level: PortfolioLevel;
  id: string;
  name: string;
  /** Where it sits, outermost first — `Iniciativa › Atención › Entregable`. */
  path: PortfolioPath;
  /** Breadcrumb of ancestor names, for the result row. */
  trail: string[];
  /** Why it matched, so the reader is never surprised by a hit. */
  matchedOn: 'name' | 'code' | 'content';
  /** Lower is better. */
  score: number;
}

export interface PortfolioSearchOptions {
  /** Restrict to these levels. Defaults to all four. */
  levels?: readonly PortfolioLevel[];
  limit?: number;
}

/**
 * Ranks by how *early* the match starts, then by level.
 *
 * An exact prefix beats a mid-string hit, and an outer level beats an inner
 * one on a tie: when "siniestros" matches both an initiative and an artifact
 * inside it, the initiative is the more useful answer because it contains the
 * other.
 */
const LEVEL_RANK: Readonly<Record<PortfolioLevel, number>> = Object.freeze({
  initiative: 0,
  attention: 1,
  deliverable: 2,
  artifact: 3,
});

const scoreOf = (haystack: string, needle: string, level: PortfolioLevel): number | null => {
  const index = haystack.indexOf(needle);
  if (index < 0) return null;
  return index * 10 + LEVEL_RANK[level];
};

/**
 * The ancestor names, outermost first. The node's own name is the row's title,
 * so it is left out — a trail that ends in the thing it describes reads as a
 * stutter.
 */
const trailOf = (path: PortfolioPath, selfId: string): string[] =>
  [path.initiative, path.attention, path.deliverable, path.artifact]
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .filter((node) => node.id !== selfId)
    .map((node) => node.name);

export const searchPortfolio = (
  graph: PortfolioGraph,
  query: string,
  options: PortfolioSearchOptions = {},
): PortfolioSearchHit[] => {
  const needle = foldOfficeText(query.trim());
  if (needle.length < 2) return [];

  const levels = new Set<PortfolioLevel>(
    options.levels ?? ['initiative', 'attention', 'deliverable', 'artifact'],
  );
  const limit = options.limit ?? 20;
  const hits: PortfolioSearchHit[] = [];

  const consider = (
    node: PortfolioNode,
    candidates: { text: string; matchedOn: PortfolioSearchHit['matchedOn'] }[],
  ): void => {
    if (!levels.has(node.level)) return;
    let best: { score: number; matchedOn: PortfolioSearchHit['matchedOn'] } | null = null;
    for (const candidate of candidates) {
      if (!candidate.text) continue;
      const score = scoreOf(foldOfficeText(candidate.text), needle, node.level);
      if (score === null) continue;
      if (!best || score < best.score) best = { score, matchedOn: candidate.matchedOn };
    }
    if (!best) return;
    const path = pathTo(graph, node.id);
    hits.push({
      node,
      level: node.level,
      id: node.id,
      name: node.name,
      path,
      trail: trailOf(path, node.id),
      matchedOn: best.matchedOn,
      score: best.score,
    });
  };

  for (const node of graph.initiatives) {
    consider(node, [
      { text: node.name, matchedOn: 'name' },
      { text: node.initiative.code, matchedOn: 'code' },
      { text: node.initiative.driver, matchedOn: 'content' },
      { text: node.initiative.need, matchedOn: 'content' },
    ]);
  }

  for (const node of graph.attentions) {
    consider(node, [
      { text: node.name, matchedOn: 'name' },
      { text: node.project.description, matchedOn: 'content' },
    ]);
  }

  for (const node of graph.deliverables) {
    consider(node, [
      { text: node.name, matchedOn: 'name' },
      { text: node.engagement.brief, matchedOn: 'content' },
    ]);
  }

  for (const node of graph.artifacts) {
    consider(node, [{ text: node.name, matchedOn: 'name' }]);
  }

  return hits.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)).slice(0, limit);
};

/**
 * Everything directly related to a node, in both directions.
 *
 * The explorer walks down; this also walks *up* and sideways, which is what
 * makes "what else does this initiative touch?" answerable from an artifact.
 */
export const relatedTo = (graph: PortfolioGraph, nodeId: string): PortfolioNode[] => {
  const node = graph.byId.get(nodeId);
  if (!node) return [];

  switch (node.level) {
    case 'initiative':
      return node.attentions;
    case 'attention':
      return [
        ...graph.initiatives.filter((initiative) => node.initiativeIds.includes(initiative.id)),
        ...node.deliverables,
      ];
    case 'deliverable': {
      const attention = graph.attentions.find((candidate) => candidate.id === node.attentionId);
      return [...(attention ? [attention] : []), ...node.artifacts];
    }
    case 'artifact': {
      const deliverable = node.deliverableId
        ? graph.deliverables.find((candidate) => candidate.id === node.deliverableId)
        : undefined;
      const attention = graph.attentions.find((candidate) => candidate.id === node.attentionId);
      return [...(deliverable ? [deliverable] : []), ...(attention ? [attention] : [])];
    }
    default:
      return [];
  }
};
