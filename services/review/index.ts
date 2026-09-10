/**
 * Artifact review persistence — public barrel + default wiring.
 *
 * Provides the repository contracts and the local / Firestore / hybrid
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
  FirestoreArtifactReviewRepository,
  createFirestoreReviewGateway,
  type ReviewFirestoreGateway,
} from './firestoreArtifactReviewRepository';
export { HybridArtifactReviewRepository } from './hybridArtifactReviewRepository';

import { isFirebaseAvailable } from '../../firebase';
import { LocalArtifactReviewRepository } from './localArtifactReviewRepository';
import {
  FirestoreArtifactReviewRepository,
  createFirestoreReviewGateway,
} from './firestoreArtifactReviewRepository';
import { HybridArtifactReviewRepository } from './hybridArtifactReviewRepository';

/**
 * Build the hybrid repository the app uses by default. The Firestore tier is
 * only attached when Firebase initialised successfully; otherwise the hybrid
 * runs in pure local mode without ever touching the network.
 */
export function createDefaultReviewRepository(): HybridArtifactReviewRepository {
  const local = new LocalArtifactReviewRepository();
  if (!isFirebaseAvailable) {
    return new HybridArtifactReviewRepository(local);
  }
  const remote = new FirestoreArtifactReviewRepository(createFirestoreReviewGateway());
  return new HybridArtifactReviewRepository(local, remote);
}
export * from './reviewTransitions';
export * from './ReviewTypes';
export { artifactReviewService } from './artifactReviewService';
