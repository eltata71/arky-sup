import type { Artifact } from '../../types';

/** Artifact persistence operations required by the agent executor. */
export interface AgentArtifactStore {
  createArtifact?: (
    projectId: string,
    artifactData: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>,
    deterministicId?: string,
  ) => Artifact;
  createArtifactVersion: (
    projectId: string,
    versionGroupId: string,
    artifactData: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>,
  ) => Artifact;
  updateArtifact: (projectId: string, artifactId: string, updates: Partial<Artifact>) => void;
}
