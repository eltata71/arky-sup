/**
 * diagramGenerationService — domain entry point for diagram generation.
 *
 * Covers the whole diagram path: direct IR generation, the self-healing
 * variant and the conversions into the renderer formats. The critique/refine
 * variant was removed in the 6.3 task of the diagram plan: nothing called it,
 * and the C4 path now corrects with one semantic patch instead.
 * Left the engine whole in F5-01 (corte 6): its six methods live in
 * `./diagram/`, so this file no longer imports `services/geminiService`.
 */

import {
  convertToExcalidrawJSON,
  fixDiagramError,
  generateDiagramIR,
  generateDiagramIRWithSelfHealing,
  parseMermaidToReactFlow,
} from './diagram';

export const diagramGenerationService = {
  /** Generate a canonical DiagramIR from a project brief. */
  generateDiagramIR,
  /** Generate IR with the C4 self-healing retry loop. */
  generateDiagramIRWithSelfHealing,
  /** Convert Mermaid source into a ReactFlow graph. */
  parseMermaidToReactFlow,
  /** Convert a diagram into an Excalidraw scene. */
  convertToExcalidrawJSON,
  /** Repair a diagram that failed to render. */
  fixDiagramError,
} as const;

export type DiagramGenerationService = typeof diagramGenerationService;
