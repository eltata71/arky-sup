/**
 * artifactGenerationService — domain entry point for artifact generation.
 *
 * The canonical surface for everything that produces, reviews or refines an
 * artifact's content. It delegates to the legacy engine today; when a path
 * moves onto the `AIProvider` layer, only this file changes, not its callers.
 *
 * That indirection was the design from the start. What it lacked was callers:
 * every call site still imported the monolith by name, so the façade protected
 * nothing. This surface now covers the whole domain precisely so that stops
 * being true.

 * Delegation is lazy: each member is a getter, so importing this façade does
 * not bind the whole engine. Eager binding made reaching for one method
 * construct every other one — the hidden cost that a façade exists to remove,
 * and a needless coupling for callers and tests alike.
 */

import { geminiService } from '../../geminiService';
import { suggestArtifactImprovements } from './artifactSuggestions';
import { getInitialArtifactsForTemplate } from './artifactTemplateSuggestions';
import { critiqueArtifactContent, refineArtifactContent } from './artifactQualityRefinement';
import { applyArtifactImprovements, generateTestCases, reviewArtifact } from './artifactReview';
import { proposeArtifactBriefContract } from './artifactBriefProposal';

export const artifactGenerationService = {
  /** Generate (or regenerate) the content for a catalog/on-demand artifact. */
  get generateArtifactContent() {
    return geminiService.generateArtifactContent.bind(geminiService);
  },
  /** Resolve the initial artifact set proposed for a project template. */
  get getInitialArtifactsForTemplate() {
    return getInitialArtifactsForTemplate;
  },
  /** Review an artifact and return improvement suggestions. */
  get reviewArtifact() {
    return reviewArtifact;
  },
  /** Apply a set of accepted improvements to an artifact. */
  get applyArtifactImprovements() {
    return applyArtifactImprovements;
  },
  /** Generate test cases derived from an artifact. */
  get generateTestCases() {
    return generateTestCases;
  },
  /** Propose targeted improvements without rewriting the artifact. */
  get suggestArtifactImprovements() {
    return suggestArtifactImprovements;
  },
  /** Critique artifact content against the quality rubric. */
  get critiqueArtifactContent() {
    return critiqueArtifactContent;
  },
  /** Rewrite artifact content once the refinement gate has approved a pass. */
  get refineArtifactContent() {
    return refineArtifactContent;
  },
  /** Refine the structured generation brief before an artifact is produced. */
  get proposeArtifactBriefContract() {
    return proposeArtifactBriefContract;
  },
} as const;

export type ArtifactGenerationService = typeof artifactGenerationService;
