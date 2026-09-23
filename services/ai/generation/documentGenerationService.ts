/**
 * documentGenerationService — domain entry point for document generation.
 *
 * Left the engine whole in F5-01 (corte 5): its five methods live in
 * `./documents/` and reach a model through `aiGateway`, so this file no longer
 * imports `services/geminiService`.
 */

import {
  convertDiagramToDocument,
  extractMemoryEntriesFromDocument,
  generateSDDHealthReport,
  generateSDDProcessPlan,
  synthesizeSmartNote,
} from './documents';

export const documentGenerationService = {
  /** Turn a diagram into a narrative document. */
  convertDiagramToDocument,
  /** Produce the SDD process plan for a project. */
  generateSDDProcessPlan,
  /** Produce the SDD health report for a project. */
  generateSDDHealthReport,
  /** Synthesise a smart note from captured material. */
  synthesizeSmartNote,
  /** Extract structured memory entries from an uploaded document. */
  extractMemoryEntriesFromDocument,
} as const;

export type DocumentGenerationService = typeof documentGenerationService;
