import type { Artifact } from '../../lib/artifacts';
import type { PersistenceResult } from '../persistence';

/** Artifact persistence operations required by the agent executor. */
export interface AgentArtifactStore {
  createArtifact?: (
    projectId: string,
    artifactData: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>,
    deterministicId?: string,
  ) => Promise<PersistenceResult<Artifact>>;
  createArtifactVersion: (
    projectId: string,
    versionGroupId: string,
    artifactData: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>,
  ) => Promise<PersistenceResult<Artifact>>;
  updateArtifact: (projectId: string, artifactId: string, updates: Partial<Artifact>) => Promise<PersistenceResult<Artifact>>;
}

/** Compatibility for old synchronous test doubles. Application call sites use
 * AgentArtifactStore and must await a confirmed PersistenceResult. */
export interface LegacyAgentArtifactStore {
  createArtifact?: (projectId: string, artifactData: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>, deterministicId?: string) => Artifact | Promise<Artifact>;
  createArtifactVersion: (projectId: string, versionGroupId: string, artifactData: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>) => Artifact | Promise<Artifact>;
  updateArtifact: (projectId: string, artifactId: string, updates: Partial<Artifact>) => void | Promise<void>;
}

export type AgentArtifactStoreLike = AgentArtifactStore | LegacyAgentArtifactStore;
