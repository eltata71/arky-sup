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

export { createDefaultReviewRepository } from './defaultReviewRepository';
export * from './reviewTransitions';
export * from './ReviewTypes';
export { artifactReviewService } from './artifactReviewService';
