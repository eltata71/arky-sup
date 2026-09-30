import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../context/AppContext';
import type { PatchRejection } from '../../lib/diagram';
import {
  canModifyDiagram,
  planDiagramModification,
  proposeDiagramModification,
  type DiagramModificationProposal,
} from '../../services/artifacts/application/diagramModification';

export type { DiagramModificationProposal };

export type DiagramModificationState =
  | { readonly status: 'idle' }
  | { readonly status: 'proposing' }
  | { readonly status: 'ready'; readonly proposal: DiagramModificationProposal }
  | { readonly status: 'refused'; readonly reason: string; readonly rejected: readonly PatchRejection[] };

export type DiagramModificationApplyResult =
  | { readonly ok: true; readonly versionId: string; readonly summary: readonly string[] }
  | { readonly ok: false; readonly reason: string };

interface UseDiagramModificationParams {
  readonly projectId: string;
  readonly artifact: Artifact;
  readonly settings: Settings;
  /** The project, so the proposal reads its context (plan de calidad de artefactos, 7.3a). */
  readonly project?: Project;
  readonly restoreArtifactVersion: (projectId: string, version: Artifact) => Artifact;
}

/**
 * El panel «Modificar diagrama»: pedir un cambio, leer lo que haría y
 * aplicarlo como versión nueva. Qué se propone y qué se guarda lo decide
 * `services/artifacts/application/diagramModification`; aquí sólo vive cuándo
 * llamar y qué cancelar.
 */
export function useDiagramModification({
  projectId,
  artifact,
  settings,
  project,
  restoreArtifactVersion,
}: UseDiagramModificationParams) {
  const [state, setState] = useState<DiagramModificationState>({ status: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);

  const canModify = useMemo(
    () => canModifyDiagram(artifact),
    // Sólo lo que decide si hay diagrama: no se recalcula en cada guardado de layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [artifact.id, artifact.type, artifact.representation, artifact.content, artifact.ir?.nodes?.length],
  );

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  // Otro artefacto u otra versión: una propuesta sobre el anterior no vale aquí.
  useEffect(() => {
    abort();
    setState({ status: 'idle' });
    return abort;
  }, [artifact.id, abort]);

  const propose = useCallback(async (instruction: string) => {
    abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'proposing' });
    const outcome = await proposeDiagramModification({ artifact, instruction, project }, settings, { signal: controller.signal });
    if (controller.signal.aborted || controllerRef.current !== controller) return;
    controllerRef.current = null;
    if (outcome.kind === 'proposal') setState({ status: 'ready', proposal: outcome.proposal });
    else if (outcome.kind === 'refused') setState({ status: 'refused', reason: outcome.reason, rejected: outcome.rejected });
    else setState({ status: 'idle' });
  }, [abort, artifact, project, settings]);

  const discard = useCallback(() => {
    abort();
    setState({ status: 'idle' });
  }, [abort]);

  const apply = useCallback((): DiagramModificationApplyResult => {
    if (state.status !== 'ready') return { ok: false, reason: 'No hay ningún cambio propuesto.' };
    const plan = planDiagramModification({ artifact, proposal: state.proposal });
    if (plan.kind === 'stale') {
      setState({ status: 'idle' });
      return { ok: false, reason: 'El diagrama cambió desde la propuesta. Vuelve a pedir el cambio.' };
    }
    if (plan.kind === 'no-change') {
      setState({ status: 'idle' });
      return { ok: false, reason: 'El cambio ya no modifica el diagrama.' };
    }
    const version = restoreArtifactVersion(projectId, plan.draft);
    setState({ status: 'idle' });
    return { ok: true, versionId: version.id, summary: plan.summary };
  }, [artifact, projectId, restoreArtifactVersion, state]);

  return { state, canModify, propose, apply, discard };
}
