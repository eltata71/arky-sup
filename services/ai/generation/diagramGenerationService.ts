/**
 * diagramGenerationService — domain entry point for diagram generation.
 *
 * Covers the whole diagram path: direct IR generation, the self-healing and
 * critique/refine variants, and the conversions into the renderer formats.
 * Thin façade over the legacy engine; see `artifactGenerationService` for why
 * the indirection exists.

 * Delegation is lazy: each member is a getter, so importing this façade does
 * not bind the whole engine. Eager binding made reaching for one method
 * construct every other one — the hidden cost that a façade exists to remove,
 * and a needless coupling for callers and tests alike.
 */

import { geminiService } from '../../geminiService';

export const diagramGenerationService = {
  /** Generate a canonical DiagramIR from a project brief. */
  get generateDiagramIR() {
    return geminiService.generateDiagramIR.bind(geminiService);
  },
  /** Generate IR with the C4 self-healing retry loop. */
  get generateDiagramIRWithSelfHealing() {
    return geminiService.generateDiagramIRWithSelfHealing.bind(geminiService);
  },
  /** Generate IR and run the critique/refine passes over it. */
  get generateAndRefineDiagramIR() {
    return geminiService.generateAndRefineDiagramIR.bind(geminiService);
  },
  /** Convert Mermaid source into a ReactFlow graph. */
  get parseMermaidToReactFlow() {
    return geminiService.parseMermaidToReactFlow.bind(geminiService);
  },
  /** Convert a diagram into an Excalidraw scene. */
  get convertToExcalidrawJSON() {
    return geminiService.convertToExcalidrawJSON.bind(geminiService);
  },
  /** Repair a diagram that failed to render. */
  get fixDiagramError() {
    return geminiService.fixDiagramError.bind(geminiService);
  },
} as const;

export type DiagramGenerationService = typeof diagramGenerationService;
