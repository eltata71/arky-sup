/**
 * The shape `AppContext` publishes.
 *
 * Split out of the provider because an interface with this much documentation
 * on it is the contract forty modules read, and it was buried under a
 * dictionary and a settings literal in a 917-line file. Nothing here is
 * implementation: the provider composes the hooks in `context/app/` and hands
 * back exactly this.
 */

import type {
  Artifact,
  ConsistencySuggestion,
  GroupedArtifacts,
  Project,
  Settings,
} from '../../types';
// Type-only, so these enter through the modules' barrels rather than naming a
// file: `import type` is erased at build time, so a barrel costs nothing here.
// The value imports in the hooks still name the file — see `useProjectsState`.
import type { AgentActionRecord } from '../../services/agent';
import type { ChatMessage } from '../../services/chat';
import type { PublicationPackage } from '../../services/publicationPipeline';
import type {
  ArchitectureGraph,
  ArchitectureGraphFreshness,
} from '../../services/architectureKnowledgeGraph';
import type {
  CreateArchitectureProjectInput,
  CreateArchitectureProjectResult,
} from '../../services/architectureProjects';

/** How the last remote write went, as the status banner reports it. */
export type PersistenceStatus = 'ready' | 'degraded' | 'saving' | 'error';

export interface AppContextType {
  projects: Project[];
  settings: Settings;
  isLoading: boolean;
  /**
   * The initiative link travels with the creation write rather than as a
   * follow-up update: an attention that exists for a moment with no declared
   * business reason is the `orphan-attention` the portfolio graph reports, and
   * a failed second write would make that state permanent.
   */
  addProject: (input: CreateArchitectureProjectInput) => CreateArchitectureProjectResult;
  getProject: (id: string) => Project | undefined;
  /**
   * Load a project's artifact documents if they are not in memory yet.
   *
   * The portfolio loads a compact index instead of every artifact body, so a
   * project reached from a list arrives with `artifactsLoaded: false`. Any
   * screen that shows or edits artifact *content* must await this first.
   * Idempotent and safe to call on an already-hydrated project.
   */
  ensureProjectArtifacts: (id: string) => Promise<void>;
  updateProject: (id: string, updates: Partial<Omit<Project, 'id' | 'artifacts'>>) => void;
  deleteProject: (id: string) => void;
  createArtifact: (projectId: string, artifact: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>, deterministicId?: string) => Artifact;
  createArtifactVersion: (projectId: string, versionGroupId: string, artifactData: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>) => Artifact;
  updateArtifact: (projectId: string, artifactId: string, updates: Partial<Artifact>) => void;
  deleteArtifact: (projectId: string, artifactId: string) => void;
  getArtifact: (projectId: string, artifactId: string) => Artifact | undefined;
  updateSettings: (updates: Partial<Settings>) => void;
  t: (key: string, replacements?: Record<string, string>) => string;
  getGroupedArtifactsByView: (projectId: string) => GroupedArtifacts;
  updateProjectContext: (projectId: string, context: string[]) => void;
  applyConsistencySuggestion: (projectId: string, suggestion: ConsistencySuggestion) => void;
  toggleArtifactFavorite: (projectId: string, artifactId: string) => void;
  findLatestArtifactByName: (projectId: string, name: string) => Artifact | undefined;
  getArtifactVersions: (projectId: string, versionGroupId: string) => Artifact[];
  restoreArtifactVersion: (projectId: string, versionToRestore: Artifact) => Artifact;
  removeCorruptArtifacts: (projectId: string, corruptArtifactIds: string[]) => void;
  saveChatHistory: (projectId: string, messages: ChatMessage[]) => Promise<void>;
  loadChatHistory: (projectId: string) => Promise<ChatMessage[]>;
  /**
   * Persist a transformed chat history (the result of delete or compact
   * operations from the Memory Center). Wraps `saveChatHistory` but exposes
   * the result so the UI can show success/error toasts.
   */
  replaceChatHistory: (projectId: string, messages: ChatMessage[]) => Promise<boolean>;
  /**
   * Append-only audit log of agentic actions on this project. Persists to
   * Firestore best-effort; failures are silent because the artifact versions
   * themselves are the rollback source of truth. Reads pull from cache when
   * available.
   */
  logAgentAction: (projectId: string, record: AgentActionRecord) => Promise<void>;
  listAgentActions: (projectId: string, options?: { artifactId?: string; limit?: number }) => Promise<AgentActionRecord[]>;
  /**
   * Rebuilds the Architecture Knowledge Graph for a project from its current
   * artifacts and persists it additively. Returns the new graph (or `null`
   * when the project is unknown). Never throws.
   *
   * This is the manual "Recalcular y persistir" path; a stale graph is also
   * rebuilt automatically (debounced) so this is never the only way to keep
   * the canonical model in sync.
   */
  rebuildArchitectureGraph: (projectId: string) => ArchitectureGraph | null;
  /**
   * Resolves whether a project's persisted graph still reflects its current
   * artifacts: `current`, `stale` or `missing`. Pure — never throws.
   */
  getArchitectureGraphFreshness: (projectId: string) => ArchitectureGraphFreshness;
  /**
   * Persists the project's publication packages additively through the
   * standard project-update path (optimistic update + rollback + concurrency
   * control unchanged). Used by the Publication Center.
   */
  savePublicationPackages: (projectId: string, packages: PublicationPackage[]) => void;
  persistenceStatus: PersistenceStatus;
  persistenceMessage: string | null;
}
