import { useCallback, useMemo, useState } from 'react';
import type { Artifact } from '../../types';
import type { RenderableDiagramResolution } from '../../services/diagram/resolveRenderableDiagram';
import {
  buildArtifactDiagnosticReport,
  buildRenderDiagnosticsSummary,
} from '../../services/artifacts/diagnostics';

export interface UseGenerationDiagnosticInput {
  projectId: string;
  projectName: string;
  artifact: Artifact;
  audience: string;
  renderable: RenderableDiagramResolution;
}

export interface UseGenerationDiagnosticResult {
  diagnosticReport: string | null;
  renderDiagnosticsSummary: string | null;
  diagnosticCopied: boolean;
  copyDiagnosticReport: () => Promise<void>;
}

/**
 * Hook that computes the canvas-level diagnostic surfaces (technical report
 * + render summary) and manages the clipboard state. Pure functions live in
 * `services/artifacts/diagnostics.ts` so they can be tested without React.
 */
export const useGenerationDiagnostic = (
  input: UseGenerationDiagnosticInput,
): UseGenerationDiagnosticResult => {
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);

  const diagnosticReport = useMemo(
    () => buildArtifactDiagnosticReport({
      projectId: input.projectId,
      projectName: input.projectName,
      artifact: input.artifact,
      audience: input.audience,
      renderable: input.renderable,
    }),
    [input.projectId, input.projectName, input.artifact, input.audience, input.renderable],
  );

  const renderDiagnosticsSummary = useMemo(
    () => buildRenderDiagnosticsSummary({ renderable: input.renderable }),
    [input.renderable],
  );

  const copyDiagnosticReport = useCallback(async () => {
    if (!diagnosticReport) return;
    try {
      await navigator.clipboard.writeText(diagnosticReport);
      setDiagnosticCopied(true);
      window.setTimeout(() => setDiagnosticCopied(false), 2200);
    } catch (err) {
      console.error('[useGenerationDiagnostic] failed to copy diagnostic report', err);
    }
  }, [diagnosticReport]);

  return {
    diagnosticReport,
    renderDiagnosticsSummary,
    diagnosticCopied,
    copyDiagnosticReport,
  };
};
