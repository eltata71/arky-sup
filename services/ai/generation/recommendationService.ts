/**
 * recommendationService — domain entry point for AI recommendations.
 *
 * The first façade to leave the engine whole (F5-01, corte 4): both methods
 * live in `./recommendation/` and reach a model through `aiGateway`, so this
 * file no longer imports `services/geminiService`.
 */

import { getSuggestedActions, recommendCustomArtifactTemplate } from './recommendation';

export const recommendationService = {
  /** Recommend a template for a free-text custom artifact request. */
  recommendCustomArtifactTemplate,
  /** Suggest next actions for the current project state. */
  getSuggestedActions,
} as const;

export type RecommendationService = typeof recommendationService;
