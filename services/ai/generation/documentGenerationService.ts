/**
 * documentGenerationService — domain entry point for document generation.
 *
 * Thin façade over the legacy engine; see `artifactGenerationService` for why
 * the indirection exists.

 * Delegation is lazy: each member is a getter, so importing this façade does
 * not bind the whole engine. Eager binding made reaching for one method
 * construct every other one — the hidden cost that a façade exists to remove,
 * and a needless coupling for callers and tests alike.
 */

import { geminiService } from '../../geminiService';

export const documentGenerationService = {
  /** Turn a diagram into a narrative document. */
  get convertDiagramToDocument() {
    return geminiService.convertDiagramToDocument.bind(geminiService);
  },
  /** Produce the SDD process plan for a project. */
  get generateSDDProcessPlan() {
    return geminiService.generateSDDProcessPlan.bind(geminiService);
  },
  /** Produce the SDD health report for a project. */
  get generateSDDHealthReport() {
    return geminiService.generateSDDHealthReport.bind(geminiService);
  },
  /** Synthesise a smart note from captured material. */
  get synthesizeSmartNote() {
    return geminiService.synthesizeSmartNote.bind(geminiService);
  },
  /** Extract structured memory entries from an uploaded document. */
  get extractMemoryEntriesFromDocument() {
    return geminiService.extractMemoryEntriesFromDocument.bind(geminiService);
  },
} as const;

export type DocumentGenerationService = typeof documentGenerationService;
