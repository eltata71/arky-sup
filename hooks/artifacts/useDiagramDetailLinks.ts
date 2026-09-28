import { useCallback, useMemo } from 'react';
import type { Artifact } from '../../lib/artifacts';
import {
  C4_LEVEL_LABEL,
  describeDetailLinks,
  expectedDetailLevel,
  listDetailLinkCandidates,
  planDetailLink,
  type DetailLinkCandidate,
  type DetailLinkRow,
  type NodeDetailLink,
} from '../../services/artifacts/application/diagramDetailLinks';

export type { DetailLinkCandidate, DetailLinkRow, NodeDetailLink };

export type DetailLinkSaveResult =
  | { readonly ok: true; readonly versionId: string; readonly summary: string }
  | { readonly ok: false; readonly reason: string; readonly unchanged?: boolean };

interface UseDiagramDetailLinksParams {
  readonly projectId: string;
  readonly artifact: Artifact;
  readonly projectArtifacts: readonly Artifact[];
  readonly restoreArtifactVersion: (projectId: string, version: Artifact) => Artifact;
}

/**
 * El panel «Niveles C4»: qué nodo detalla qué diagrama, y cambiarlo. Qué se
 * puede enlazar y qué se guarda lo decide
 * `services/artifacts/application/diagramDetailLinks`; aquí sólo vive cuándo
 * recalcular.
 */
export function useDiagramDetailLinks({
  projectId,
  artifact,
  projectArtifacts,
  restoreArtifactVersion,
}: UseDiagramDetailLinksParams) {
  const { hasDiagram, rows } = useMemo(
    () => describeDetailLinks(artifact, projectArtifacts),
    [artifact, projectArtifacts],
  );

  const candidates = useMemo(
    () => listDetailLinkCandidates(artifact, projectArtifacts),
    [artifact, projectArtifacts],
  );

  const expected = expectedDetailLevel(artifact.type);
  const expectedLabel = expected ? C4_LEVEL_LABEL[expected] : null;

  const setLink = useCallback((nodeId: string, targetGroupId: string | null): DetailLinkSaveResult => {
    const plan = planDetailLink({ artifact, nodeId, targetGroupId, artifacts: projectArtifacts });
    if (plan.kind === 'no-change') return { ok: false, reason: 'El nodo ya tenía ese enlace.', unchanged: true };
    if (plan.kind === 'refused') return { ok: false, reason: plan.reason };
    const version = restoreArtifactVersion(projectId, plan.draft);
    return { ok: true, versionId: version.id, summary: plan.summary };
  }, [artifact, projectArtifacts, projectId, restoreArtifactVersion]);

  return { hasDiagram, rows, candidates, expectedLabel, setLink };
}
