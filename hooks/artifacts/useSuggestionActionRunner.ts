/**
 * Running a suggestion's action.
 *
 * The Sugerencias panel offers concrete buttons — apply ELK, change density,
 * tag PHI/PII, switch audience — and this is what happens when one is pressed.
 * Every branch either mutates the IR deterministically and persists it, or
 * falls through to an existing user flow.
 *
 * The fallthrough is the design: a deterministic action that cannot run (no IR
 * parsed, or the rule found nothing to change) hands over to auto-improve
 * rather than reporting success. A button that appears to work and changes
 * nothing is worse than one that visibly delegates.
 *
 * Extracted from `ArtifactCanvas.tsx`, where it closed over nine values from a
 * 1.226-line component. Naming them turned out to be the point: what a
 * dispatcher over fourteen action kinds actually needs is an IR, a toast, and
 * five callbacks.
 */

import { useCallback } from 'react';
import { executeDiagramSuggestionAction } from '../../services/diagram/suggestionActionExecutors';
import type { ArtifactSuggestion, ArtifactSuggestionAction } from '../../services/ai/artifactSuggestionTypes';
import type { DiagramAudience, DiagramIR } from '../../lib/diagram';

export type SuggestionActionRunner = (
    action: ArtifactSuggestionAction,
    suggestion: ArtifactSuggestion,
) => void;

export interface SuggestionActionRunnerOptions {
    /** The parsed diagram, or `null` when the artifact never produced one. */
    ir: DiagramIR | null;
    addToast: (message: string, tone: 'success' | 'info' | 'error') => void;
    /** Persist a mutated IR so the change survives a reload. */
    persistIR: (ir: DiagramIR) => void;
    retryDiagram: () => void;
    autoImproveDiagram: () => void;
    applyWithAI: () => Promise<unknown> | void;
    changeAudience: (audience: DiagramAudience) => void;
}

export function useSuggestionActionRunner({
    ir,
    addToast,
    persistIR,
    retryDiagram,
    autoImproveDiagram,
    applyWithAI,
    changeAudience,
}: SuggestionActionRunnerOptions): SuggestionActionRunner {
  return useCallback((action: ArtifactSuggestionAction, suggestion: ArtifactSuggestion) => {
    const runDeterministic = (kind: string, params?: Record<string, string>): boolean => {
      if (!ir) return false;
      const result = executeDiagramSuggestionAction(ir, kind, params ?? {});
      if (!result.ir) {
        addToast(result.summary, 'info');
        return true;
      }
      persistIR(result.ir);
      addToast(result.summary, 'success');
      return true;
    };

    switch (action.kind) {
      case 'apply-elk-layout':
        if (runDeterministic('apply-elk-layout', action.params)) return;
        addToast('Re-corriendo el layout canónico (ELK layered).', 'info');
        retryDiagram();
        return;
      case 'set-layout-direction':
        runDeterministic('set-layout-direction', action.params);
        return;
      case 'set-layout-density':
        runDeterministic('set-layout-density', action.params);
        return;
      case 'assign-group-kind':
        if (runDeterministic('assign-group-kind', action.params)) return;
        autoImproveDiagram();
        return;
      case 'tag-phi-pii':
        if (runDeterministic('tag-phi-pii', action.params)) return;
        autoImproveDiagram();
        return;
      case 'add-missing-protocols':
        if (runDeterministic('add-missing-protocols', action.params)) return;
        autoImproveDiagram();
        return;
      case 'add-security-controls':
        if (runDeterministic('add-security-controls', action.params)) return;
        autoImproveDiagram();
        return;
      case 'split-c4-levels':
        if (runDeterministic('split-c4-levels', action.params)) return;
        autoImproveDiagram();
        return;
      case 'convert-to-bpmn':
      case 'repair-exportability':
        addToast(`${action.label}: ejecutando auto-mejora estructural.`, 'info');
        autoImproveDiagram();
        return;
      case 'switch-audience': {
        const aud = (action.params?.audience ?? 'technical') as DiagramAudience;
        addToast(`Generando vista ${aud}.`, 'info');
        changeAudience(aud);
        return;
      }
      case 'regenerate-with-ir-direct':
        addToast('Reintentando con el pipeline IR-direct conservando metadata previa.', 'info');
        void applyWithAI();
        return;
      default:
        console.warn('[useSuggestionActionRunner] Unknown suggestion action', action.kind, suggestion.id);
    }
  }, [ir, addToast, persistIR, retryDiagram, autoImproveDiagram, applyWithAI, changeAudience]);
}
