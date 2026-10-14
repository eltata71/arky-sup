import type { ArtifactGenerationTrace } from '../../lib/artifacts';
import { createContextManifestRecorder, describeCitationReview, reviewContextCitations } from '../../lib/artifacts';

/** Agent generations have their own trace; never inherit one from the prior text. */
export function recordAgentGeneration(operationId: string, source: ArtifactGenerationTrace['source']) {
  const startedAt = new Date().toISOString();
  const recorder = createContextManifestRecorder(startedAt);
  const degradations: string[] = [];
  let aiCalls = 0;
  return {
    options: {
      onModelCall: (): void => { aiCalls += 1; },
      onContextCaptured: recorder.capture,
      onDegraded: (message: string): void => { degradations.push(message); },
    },
    aiCalls: (): number => aiCalls,
    trace: (content: string): ArtifactGenerationTrace => {
      const contextManifest = recorder.manifest();
      const citationWarning = describeCitationReview(reviewContextCitations(content, contextManifest));
      return {
        id: `${operationId}-generation`, operationId, source,
        status: degradations.length ? 'fallback' : contextManifest && !citationWarning ? 'clean' : 'warning',
        startedAt, completedAt: new Date().toISOString(),
        decisions: [], errors: [], contentLength: content.length,
        ...(contextManifest ? { contextManifest } : {}),
        warnings: [...degradations, ...(citationWarning ? [citationWarning] : []), ...(!contextManifest ? ['No se registró el contexto de esta generación.'] : [])],
      };
    },
  };
}
