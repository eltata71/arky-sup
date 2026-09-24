/**
 * The artifacts context's half of the generation port (F5-01, corte 14).
 *
 * `services/ai` declares `ArtifactGenerationSupport` — the controlled source
 * selection and the deterministic fallbacks it cannot look up without closing
 * a cycle — and this is the one object that supplies it. Every caller of
 * `artifactGenerationService.generateArtifactContent` hands it over; the
 * compiler makes sure none forgets.
 *
 * Nothing here calls a model: the port exists so a pure function does not
 * have to live behind the door that does.
 */
import type { ArtifactGenerationSupport } from '../ai';
import {
  selectArtifactGenerationContext,
  validateControlledContextForPrompt,
} from './artifactContextSelectionService';
import {
  buildDeterministicArtifactFallback,
  buildDeterministicDiagramSkeleton,
  markMermaidAsSkeletonFallback,
} from './deterministicArtifactFallbacks';

export const artifactGenerationSupport: ArtifactGenerationSupport = {
  controlledContext(project, contract, sourceSummaryChars) {
    const selection = selectArtifactGenerationContext(project, contract, {
      maxOptionalSources: 3,
      maxContextItems: 5,
      sourceSummaryChars,
    });
    const validation = validateControlledContextForPrompt(selection);
    return { promptBlock: selection.promptBlock, ...validation };
  },
  deterministicArtifact: buildDeterministicArtifactFallback,
  deterministicDiagramSkeleton: buildDeterministicDiagramSkeleton,
  markSkeleton: markMermaidAsSkeletonFallback,
};
