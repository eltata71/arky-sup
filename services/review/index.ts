/**
 * Artifact review persistence — public barrel + default wiring.
 *
 * Provides the repository contracts and the local / remote / hybrid
 * implementations, plus `createDefaultReviewRepository` which assembles the
 * hybrid repository used by `artifactReviewService`.
 */

export * from './types';
export {
  LocalArtifactReviewRepository,
  COMMENTS_STORAGE_KEY,
  DECISIONS_STORAGE_KEY,
  newCommentId,
  newReplyId,
  newDecisionId,
} from './localArtifactReviewRepository';
export {
  RemoteArtifactReviewRepository,
  createRemoteReviewGateway,
  type ReviewRemoteGateway,
} from './remoteArtifactReviewRepository';
export { HybridArtifactReviewRepository } from './hybridArtifactReviewRepository';

import { LocalArtifactReviewRepository } from './localArtifactReviewRepository';
import {
  RemoteArtifactReviewRepository,
  createRemoteReviewGateway,
} from './remoteArtifactReviewRepository';
import { HybridArtifactReviewRepository } from './hybridArtifactReviewRepository';
import { isSupabaseDataBackendConfigured } from '../adapters';
import { currentUserId } from '../identity';

/**
 * Build the hybrid repository the app uses by default. The remote tier is only
 * attached when the backend is configured; otherwise the hybrid runs in pure
 * local mode without ever touching the network.
 */
export function createDefaultReviewRepository(): HybridArtifactReviewRepository {
  const local = new LocalArtifactReviewRepository();
  const env = import.meta.env as Record<string, string | undefined>;
  if (!isSupabaseDataBackendConfigured(env)) {
    return new HybridArtifactReviewRepository(local);
  }
  const remote = new RemoteArtifactReviewRepository(createRemoteReviewGateway(currentUserId, env));
  return new HybridArtifactReviewRepository(local, remote);
}
export * from './reviewTransitions';
export * from './ReviewTypes';
export { artifactReviewService } from './artifactReviewService';
