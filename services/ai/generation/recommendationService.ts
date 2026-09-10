/**
 * recommendationService — domain entry point for AI recommendations.
 *
 * Thin façade over the legacy engine; see `artifactGenerationService` for why
 * the indirection exists.

 * Delegation is lazy: each member is a getter, so importing this façade does
 * not bind the whole engine. Eager binding made reaching for one method
 * construct every other one — the hidden cost that a façade exists to remove,
 * and a needless coupling for callers and tests alike.
 */

import { geminiService } from '../../geminiService';

export const recommendationService = {
  /** Recommend a template for a free-text custom artifact request. */
  get recommendCustomArtifactTemplate() {
    return geminiService.recommendCustomArtifactTemplate.bind(geminiService);
  },
  /** Suggest next actions for the current project state. */
  get getSuggestedActions() {
    return geminiService.getSuggestedActions.bind(geminiService);
  },
} as const;

export type RecommendationService = typeof recommendationService;
