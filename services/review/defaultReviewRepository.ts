/**
 * The hybrid repository the app uses by default.
 *
 * It lived in the barrel, and `artifactReviewService` imported it back from
 * `./index` while the barrel re-exported the service — a cycle inside the
 * module. In the production bundle Vite hoists `import.meta.env` to a
 * module-level constant, so the service's singleton, built while the barrel was
 * still evaluating, read that constant before it existed: «Cannot access … before
 * initialization», and the whole Workspace route failed to load (F6-04, found
 * by the artifact-generation journey). In its own file there is no cycle.
 */
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
