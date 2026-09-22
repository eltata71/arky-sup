/**
 * Resolves the four-level portfolio into a keyed graph.
 *
 * ## What "resolve" means here
 *
 * Every edge is followed by id. Where a record predates `initiativeIds` and
 * carries only `NEG-YYYY-NNN` codes, the resolver **migrates it lazily**: it
 * matches the codes against the registered initiatives and uses the ids it
 * finds. That migration happens in memory on every read, so nothing has to be
 * rewritten in Firestore before the app works, and a record that is later
 * saved through the picker persists the ids it was already being read with.
 *
 * ## Why broken links are reported rather than dropped
 *
 * The tempting implementation filters out references that do not resolve. That
 * makes a dashboard that always looks healthy and quietly loses work: an
 * attention whose initiative was deleted simply vanishes from the portfolio.
 * Instead every unresolved reference becomes a `LinkIssue` with the record that
 * carries it, and the node stays in the graph — under "sin iniciativa" when
 * that is the truth.
 *
 * Pure functions over plain data: no React, no Firestore, no AI.
 */

import type { ArtifactSummary } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import { isInitiativeCode, type BusinessInitiativeCode } from '../../lib/eaTerminology';
import type { BusinessInitiative } from '../businessInitiatives/BusinessInitiativeTypes';
import type { OfficeEngagement } from '../architectureOffice/OfficeTypes';
import type {
  ArtifactNode,
  AttentionNode,
  DeliverableNode,
  InitiativeNode,
  LinkIssue,
  PortfolioGraph,
  PortfolioNode,
  PortfolioPath,
} from './PortfolioGraphTypes';

/**
 * Every artifact of a project, by identity.
 *
 * Reads the loaded documents when the project has them and the compact index
 * otherwise. The distinction is `artifactsLoaded`, not `artifacts.length`:
 * a portfolio built from an unhydrated project would otherwise report an
 * organisation with no artifacts at all, which looks like a finding rather
 * than like missing data.
 */
const artifactIdentities = (project: Project): ArtifactSummary[] => {
  if (project.artifactsLoaded === false) return project.artifactIndex ?? [];
  return project.artifacts ?? [];
};

/** Latest version of each artifact — what a person means by "the artifacts". */
const latestArtifacts = (project: Project): ArtifactSummary[] => {
  const byGroup = new Map<string, ArtifactSummary>();
  for (const artifact of artifactIdentities(project)) {
    const current = byGroup.get(artifact.versionGroupId);
    if (!current || artifact.version > current.version) byGroup.set(artifact.versionGroupId, artifact);
  }
  return [...byGroup.values()];
};

export interface ResolveOptions {
  /**
   * Report an attention that answers no initiative as an issue. On by default:
   * architecture work with no stated business reason is exactly the thing a
   * portfolio review needs to see.
   */
  reportOrphanAttentions?: boolean;
}

/**
 * Resolves the initiative ids a record links to.
 *
 * `initiativeIds` wins. Codes are consulted only for what the ids do not
 * already cover, which is what makes this safe to run on every read: a record
 * that has been migrated is unaffected by whatever stale codes it still
 * carries.
 */
const resolveInitiativeIds = (
  ids: readonly string[] | undefined,
  codes: readonly string[] | undefined,
  byId: ReadonlyMap<string, BusinessInitiative>,
  byCode: ReadonlyMap<string, BusinessInitiative>,
  source: { level: LinkIssue['level']; id: string; name: string },
  issues: LinkIssue[],
): string[] => {
  const resolved = new Set<string>();

  for (const id of ids ?? []) {
    if (byId.has(id)) {
      resolved.add(id);
      continue;
    }
    issues.push({
      kind: 'dangling-initiative',
      level: source.level,
      sourceId: source.id,
      sourceName: source.name,
      reference: id,
      message: `«${source.name}» apunta a una iniciativa que ya no existe. El trabajo sigue aquí, pero sin la razón de negocio que lo justifica.`,
    });
  }

  // Codes are consulted **only** when no id resolved. A mirror that can add a
  // link the ids do not have is not a mirror, it is a second source of truth —
  // and then a stale code silently attaches work to an initiative nobody
  // linked it to. Migration is a fallback, never a merge.
  if (resolved.size > 0) return [...resolved];

  for (const code of codes ?? []) {
    if (!isInitiativeCode(code)) continue;
    const initiative = byCode.get(code);
    if (initiative) {
      // Lazy migration: the code still resolves, so the link keeps working
      // while the record has not yet been re-saved with its ids.
      resolved.add(initiative.id);
      continue;
    }
    issues.push({
      kind: 'unresolved-code',
      level: source.level,
      sourceId: source.id,
      sourceName: source.name,
      reference: code,
      message: `«${source.name}» cita el código ${code}, que no corresponde a ninguna iniciativa registrada. Regístrala o corrige el vínculo desde el selector.`,
    });
  }

  return [...resolved];
};

export const resolvePortfolioGraph = (
  initiatives: readonly BusinessInitiative[],
  projects: readonly Project[],
  engagements: readonly OfficeEngagement[],
  options: ResolveOptions = {},
): PortfolioGraph => {
  const reportOrphans = options.reportOrphanAttentions ?? true;
  const issues: LinkIssue[] = [];

  const initiativeById = new Map(initiatives.map((item) => [item.id, item]));
  const initiativeByCode = new Map(
    initiatives.filter((item) => item.code).map((item) => [item.code, item]),
  );

  // --- Level 2: attentions ------------------------------------------------
  const attentionNodes = new Map<string, AttentionNode>();
  for (const project of projects) {
    const resolvedIds = resolveInitiativeIds(
      project.initiativeIds,
      project.linkedBusinessProjects,
      initiativeById,
      initiativeByCode,
      { level: 'attention', id: project.id, name: project.name },
      issues,
    );

    const node: AttentionNode = {
      level: 'attention',
      id: project.id,
      name: project.name,
      project,
      initiativeIds: resolvedIds,
      deliverables: [],
      artifacts: [],
    };

    node.artifacts = latestArtifacts(project).map((artifact) => ({
      level: 'artifact' as const,
      id: artifact.id,
      name: artifact.name,
      artifact,
      attentionId: project.id,
    }));

    attentionNodes.set(project.id, node);
  }

  // --- Level 3: deliverables ----------------------------------------------
  const deliverableNodes: DeliverableNode[] = [];
  for (const engagement of engagements) {
    const attention = attentionNodes.get(engagement.projectId);
    if (!attention) {
      // `projectId` has always been a key, so this only happens when the
      // project was deleted out from under the deliverable. Reporting it beats
      // hiding a governed piece of work.
      issues.push({
        kind: 'dangling-attention',
        level: 'deliverable',
        sourceId: engagement.id,
        sourceName: engagement.title,
        reference: engagement.projectId,
        message: `«${engagement.title}» pertenece a una atención de arquitectura que ya no existe. No aparecerá en el portafolio hasta reasignarlo.`,
      });
      continue;
    }

    const resolvedIds = resolveInitiativeIds(
      engagement.initiativeIds,
      engagement.businessProjectIds,
      initiativeById,
      initiativeByCode,
      { level: 'deliverable', id: engagement.id, name: engagement.title },
      issues,
    );

    const node: DeliverableNode = {
      level: 'deliverable',
      id: engagement.id,
      name: engagement.title,
      engagement,
      attentionId: attention.id,
      // A deliverable that states nothing inherits its attention's initiatives:
      // it cannot serve a need its own project does not answer.
      initiativeIds: resolvedIds.length > 0 ? resolvedIds : attention.initiativeIds,
      artifacts: [],
    };

    // --- Level 4: artifacts a task actually produced -----------------------
    const producedIds = new Set(
      engagement.tasks
        .map((task) => task.producedArtifactId)
        .filter((id): id is string => Boolean(id)),
    );
    node.artifacts = attention.artifacts.filter((artifact) => producedIds.has(artifact.id));
    for (const artifact of node.artifacts) artifact.deliverableId = node.id;

    attention.deliverables.push(node);
    deliverableNodes.push(node);
  }

  // --- Level 1: initiatives -----------------------------------------------
  const initiativeNodes: InitiativeNode[] = initiatives.map((initiative) => ({
    level: 'initiative',
    id: initiative.id,
    name: initiative.title,
    initiative,
    attentions: [...attentionNodes.values()].filter(
      (attention) => attention.initiativeIds.includes(initiative.id),
    ),
  }));

  const unlinkedAttentions = [...attentionNodes.values()].filter(
    (attention) => attention.initiativeIds.length === 0,
  );

  if (reportOrphans) {
    for (const attention of unlinkedAttentions) {
      // A project with no work in it yet is a draft, not an orphan.
      if (attention.deliverables.length === 0 && attention.artifacts.length === 0) continue;
      issues.push({
        kind: 'orphan-attention',
        level: 'attention',
        sourceId: attention.id,
        sourceName: attention.name,
        message: `«${attention.name}» tiene trabajo en curso pero no responde a ninguna iniciativa de negocio. Enlázala desde el selector para que aparezca en la cadena.`,
      });
    }
  }

  const byId = new Map<string, PortfolioNode>();
  for (const node of initiativeNodes) byId.set(node.id, node);
  for (const node of attentionNodes.values()) byId.set(node.id, node);
  for (const node of deliverableNodes) byId.set(node.id, node);
  for (const attention of attentionNodes.values()) {
    for (const artifact of attention.artifacts) byId.set(artifact.id, artifact);
  }

  return {
    initiatives: initiativeNodes,
    attentions: [...attentionNodes.values()],
    deliverables: deliverableNodes,
    artifacts: [...attentionNodes.values()].flatMap((attention) => attention.artifacts),
    unlinkedAttentions,
    issues,
    byId,
  };
};

/**
 * Walks up from any node to the root, so a breadcrumb can be built from an id
 * alone rather than from whatever happened to be in scope.
 *
 * An attention serving several initiatives resolves to the first one; the
 * caller that needs all of them reads `attention.initiativeIds`.
 */
export const pathTo = (graph: PortfolioGraph, nodeId: string): PortfolioPath => {
  const node = graph.byId.get(nodeId);
  if (!node) return {};

  const attentionOf = (id: string): AttentionNode | undefined =>
    graph.attentions.find((candidate) => candidate.id === id);
  const initiativeOf = (attention: AttentionNode | undefined): InitiativeNode | undefined => {
    const first = attention?.initiativeIds[0];
    return first ? graph.initiatives.find((candidate) => candidate.id === first) : undefined;
  };

  if (node.level === 'initiative') return { initiative: node };

  if (node.level === 'attention') {
    return { initiative: initiativeOf(node), attention: node };
  }

  if (node.level === 'deliverable') {
    const attention = attentionOf(node.attentionId);
    return { initiative: initiativeOf(attention), attention, deliverable: node };
  }

  const attention = attentionOf(node.attentionId);
  const deliverable = node.deliverableId
    ? graph.deliverables.find((candidate) => candidate.id === node.deliverableId)
    : undefined;
  return { initiative: initiativeOf(attention), attention, deliverable, artifact: node };
};

/**
 * The codes an id set corresponds to. Used when writing a link, so the mirror
 * stays in step with the canonical ids rather than drifting from them.
 */
export const codesForInitiativeIds = (
  ids: readonly string[],
  initiatives: readonly BusinessInitiative[],
): string[] => {
  const byId = new Map(initiatives.map((item) => [item.id, item]));
  return [...new Set(
    ids
      .map((id) => byId.get(id)?.code)
      .filter((code): code is BusinessInitiativeCode => Boolean(code)),
  )];
};

export type { ArtifactNode, AttentionNode, DeliverableNode, InitiativeNode };
