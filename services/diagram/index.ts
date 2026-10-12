/**
 * Canonical diagram pipeline entry point.
 *
 * Call sites should prefer these functions over the AI-powered Gemini ones
 * (`parseMermaidToReactFlow`, `convertToExcalidrawJSON`) because they are:
 *   - deterministic
 *   - offline
 *   - free from LLM rate limits
 *   - idempotent (same Mermaid always yields the same layout)
 *
 * A feature flag (`VITE_DIAGRAM_PIPELINE=canonical|ai`) controls which path
 * is used; the default is `canonical` for new generations.  The AI fallback
 * remains reachable for migration/debugging.
 */

import type { DiagramIR } from '../../lib/diagram';
import { mermaidToIR } from './mermaidToIR';
import { irToReactFlow, IRToReactFlowResult, hasManualLayout } from './irToReactFlow';
import { irToExcalidraw, ExcalidrawBundle } from './irToExcalidraw';
import { irToMermaid } from './irToMermaid';

export type DiagramPipelineMode = 'canonical' | 'ai';

export function getPipelineMode(): DiagramPipelineMode {
    const flag = (import.meta.env.VITE_DIAGRAM_PIPELINE ?? 'canonical').toString().trim().toLowerCase();
    return flag === 'ai' ? 'ai' : 'canonical';
}

/**
 * Optional safety valve:
 * - false (default): avoid dual generation passes (deterministic + AI fallback)
 * - true: allow AI fallback when deterministic parsing yields no usable output
 */
export function isDiagramAIFallbackEnabled(): boolean {
    const flag = (import.meta.env.VITE_DIAGRAM_AI_FALLBACK ?? 'false').toString().trim().toLowerCase();
    return flag === '1' || flag === 'true' || flag === 'yes';
}

/**
 * Diagram generator strategy:
 *  - `ir-direct`  (default since Phase 2): ask Gemini for canonical
 *                  DiagramIR JSON in one shot (responseSchema-validated).
 *                  Falls back to legacy if the structured call fails.
 *  - `legacy`               : generate Mermaid via Gemini, then parse to IR.
 *                             Kept as an explicit override to roll back if
 *                             the structured call is unavailable in a given
 *                             environment.
 *
 * Wired through `VITE_DIAGRAM_GENERATOR=legacy` so the legacy path can be
 * re-engaged per environment without redeploying. Any other value (including
 * unset) resolves to `ir-direct`.
 */
export type DiagramGeneratorMode = 'legacy' | 'ir-direct';
export function getGeneratorMode(): DiagramGeneratorMode {
    const flag = (import.meta.env.VITE_DIAGRAM_GENERATOR ?? 'ir-direct').toString().trim().toLowerCase();
    return flag === 'legacy' ? 'legacy' : 'ir-direct';
}

export function parseMermaidDeterministic(code: string): DiagramIR {
    return mermaidToIR(code);
}

export function renderIRToReactFlow(ir: DiagramIR): IRToReactFlowResult {
    return irToReactFlow(ir);
}

export function renderIRToExcalidraw(ir: DiagramIR, isDark = false): ExcalidrawBundle {
    return irToExcalidraw(ir, isDark);
}

export function serializeIRToMermaid(ir: DiagramIR): string {
    return irToMermaid(ir);
}

/** Convenience: Mermaid → ReactFlow without any LLM call. */
export function mermaidToReactFlow(code: string): IRToReactFlowResult {
    return renderIRToReactFlow(parseMermaidDeterministic(code));
}

export function mermaidToExcalidraw(code: string, isDark = false): ExcalidrawBundle {
    return renderIRToExcalidraw(parseMermaidDeterministic(code), isDark);
}

export { mermaidToIR, irToReactFlow, irToExcalidraw, irToMermaid, hasManualLayout };
export { irToMermaidC4, c4LevelOfArtifactType, type C4DiagramLevel } from './irToMermaidC4';
export { mermaidDialectOf, serializeIRPreservingDialect } from './dialectSerialization';
export * from './requestFidelity';

export { extractIRDiagnostic, extractIRFromArtifact, type ExtractIRResult } from './irExtraction';

export { resolveEditableDiagramIR, resolveRenderableDiagram } from './resolveRenderableDiagram';

/**
 * Diagram quality — the ten-dimension score, the lints and the preflight report.
 *
 * `diagramQualityService` sat at the root of `services/` and six UI files
 * imported it directly, past `services/quality/diagramQualityBridge.ts` which
 * exists to mediate it. It depends on ten modules in this directory and on
 * nothing else, so this is where it belongs; `services/quality` keeps the
 * bridge, which is that context's *view* of a diagram's quality rather than a
 * second copy of it.
 */
export {
  analyzeDiagramQuality,
  buildDiagramPreflightReport,
  mergeIRMetadata,
  toDiagramIR,
} from './quality/diagramQualityService';
export type { DiagramPreflightReport, DiagramQualityReport } from './quality/diagramQualityService';
// The architectural guardrails and the quality gate, for the diagram
// generation vertical in `services/ai` (F5-01, corte 6), which used to reach
// them by file path from inside the engine.
export { detectArchitecturalViolations } from './guardrails';
export { runDiagramQualityGate } from './qualityGate';

/**
 * Deterministic signal extraction over a project's artifacts.
 *
 * Public because the deterministic fallbacks in `services/artifacts` build a
 * skeleton out of these signals when generation fails; they used to reach the
 * file directly from inside the AI engine.
 */
export {
  extractDiagramSignals,
  renderDiagramSignals,
  type DiagramSignalSource,
  type ExtractedDiagramContext,
} from './diagramSignalExtractor';

/**
 * The story a diagram tells, in the order it should be read.
 *
 * Public because three sides need it and none of them is this module: the
 * quality engine scores whether a diagram has a story at all, the canvas walks
 * its steps in presentation mode, and the accessible summary reads it out to
 * whoever cannot see the highlight.
 */
export {
  buildStoryPlan,
  resolvePrimaryPathFocus,
  resolveStoryFocus,
  MAX_STORY_HOTSPOTS,
  MAX_STORY_STEPS,
} from './storyPlanner';

/**
 * Changing a diagram without regenerating it.
 *
 * Public because the change can come from three places — the canvas, an AI
 * proposal the user previews, and a deterministic suggestion action — and all
 * three must go through the same validation. A second applier is a second set
 * of invariants, and only one of them would be the one the lint rules check.
 */
export { applySemanticPatch, describeSemanticPatch } from './semanticPatchEngine';
export { diffDiagramIR, matchDiagramIR } from './diagramDiff';
export { buildAccessibleSummary } from './accessibleSummary';
export { reconcileIRWithContent } from './contentReconciliation';
export type { DiagramDiff, DiagramDiffEdge, DiagramDiffField, DiagramDiffNode, DiagramFieldChange } from './diagramDiff';

// Tipos que otros módulos ya usaban entrando por ruta de fichero: se publican
// aquí, en la puerta, sin coste en el bundle (se borran al compilar).
export type { RenderableDiagramResolution } from './resolveRenderableDiagram';
export type { DiagramSuggestion, SuggestionCategory } from './diagramTypeQualityGates';
export type { EdgeSegment, FloatingObstacleRect, GroupRect, NodeRect, ViewportRect } from './layoutQualityService';
