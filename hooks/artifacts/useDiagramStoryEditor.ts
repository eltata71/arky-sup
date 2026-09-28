import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Artifact } from '../../lib/artifacts';
import type { DiagramPatchOperation } from '../../lib/diagram';
import { newPrefixedId } from '../../lib/ids';
import {
  acceptsStoryOperation,
  planStoryEdit,
  previewStoryEdit,
  resolveStoryBase,
  type StoryDraft,
} from '../../services/artifacts/application/diagramStoryEditing';

export type { StoryDraft };

export type StorySaveResult =
  | { readonly ok: true; readonly versionId: string; readonly summary: readonly string[] }
  | { readonly ok: false; readonly reason: string };

interface UseDiagramStoryEditorParams {
  readonly projectId: string;
  readonly artifact: Artifact;
  readonly restoreArtifactVersion: (projectId: string, version: Artifact) => Artifact;
}

/**
 * El editor de la historia (plan de diagramas, 4.3): acumula operaciones del
 * motor sobre el IR del artefacto, muestra el resultado y lo guarda como una
 * versión. Qué es válido y qué se guarda lo decide
 * `services/artifacts/application/diagramStoryEditing`; aquí sólo vive el
 * borrador.
 */
export function useDiagramStoryEditor({ projectId, artifact, restoreArtifactVersion }: UseDiagramStoryEditorParams) {
  const base = useMemo(() => resolveStoryBase(artifact), [artifact]);
  const [operations, setOperations] = useState<DiagramPatchOperation[]>([]);
  const [lastRejection, setLastRejection] = useState<string | null>(null);

  // Otro artefacto u otra versión: el borrador del anterior no vale aquí.
  useEffect(() => {
    setOperations([]);
    setLastRejection(null);
  }, [artifact.id]);

  const preview = useMemo(() => (base ? previewStoryEdit(base, operations) : null), [base, operations]);

  const apply = useCallback((operation: DiagramPatchOperation): boolean => {
    if (!preview) return false;
    const rejection = acceptsStoryOperation(preview.ir, operation);
    if (rejection) {
      setLastRejection(rejection.message);
      return false;
    }
    setLastRejection(null);
    setOperations((current) => [...current, operation]);
    return true;
  }, [preview]);

  const actions = useMemo(() => ({
    setMessage: (message: string) => apply({ op: 'set-story-message', message }),
    addScene: (title: string, focusNodeIds: string[] = []) =>
      apply({ op: 'add-scene', scene: { id: newPrefixedId('scene'), title, focusNodeIds, focusEdgeIds: [] } }),
    renameScene: (sceneId: string, title: string) => apply({ op: 'update-scene', sceneId, changes: { title } }),
    setSceneInsight: (sceneId: string, insight: string) =>
      apply({ op: 'update-scene', sceneId, changes: { insight: insight.trim() || undefined } }),
    setSceneFocus: (sceneId: string, focusNodeIds: string[]) =>
      apply({ op: 'update-scene', sceneId, changes: { focusNodeIds } }),
    moveScene: (sceneId: string, toIndex: number) => apply({ op: 'move-scene', sceneId, toIndex }),
    removeScene: (sceneId: string) => apply({ op: 'remove-scene', sceneId }),
    addCallout: (targetId: string, text: string, severity: 'info' | 'warning' | 'critical') =>
      apply({ op: 'add-callout', callout: { id: newPrefixedId('callout'), targetId, text, severity } }),
    removeCallout: (calloutId: string) => apply({ op: 'remove-callout', calloutId }),
  }), [apply]);

  const discard = useCallback(() => {
    setOperations([]);
    setLastRejection(null);
  }, []);

  const save = useCallback((): StorySaveResult => {
    if (!preview) return { ok: false, reason: 'Este artefacto no tiene un diagrama con historia.' };
    const plan = planStoryEdit({ artifact, preview, operations });
    if (plan.kind === 'no-change') return { ok: false, reason: 'La historia no cambió.' };
    if (plan.kind === 'stale') {
      return { ok: false, reason: 'El diagrama cambió mientras editabas. Descarta el borrador y vuelve a empezar.' };
    }
    const version = restoreArtifactVersion(projectId, plan.draft);
    setOperations([]);
    return { ok: true, versionId: version.id, summary: plan.summary };
  }, [artifact, operations, preview, projectId, restoreArtifactVersion]);

  return {
    hasDiagram: base !== null,
    draft: preview?.draft ?? null,
    pending: operations.length,
    lastRejection,
    ...actions,
    discard,
    save,
  };
}
