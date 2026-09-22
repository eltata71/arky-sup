/**
 * Where a Proyecto de Arquitectura is read from and written to.
 *
 * This context's persistence lives next to this file: `projectReads.ts`,
 * `projectWrites.ts` and the cache they share
 * — a 1.379-line file that also holds the artifacts, the settings, the chat
 * history, the agent's action log, the Office's engagements and the business
 * initiatives. Five contexts, one file: changing the shape of a project means
 * editing a module shared by four other domains, with their rules, their cache
 * and their degradation around it.
 *
 * This repository is the seam that ends that, from this side, without a
 * rewrite. Today it delegates; every caller in this context already goes
 * through it, so when the gateway split lands (`services/persistence/`) the
 * change happens here and nowhere else. `OfficeEngagementRepository` and
 * `BusinessInitiativeRepository` are the same pattern, written first.
 *
 * It is deliberately thin and deliberately not a place for rules. The rules
 * are in `architectureProjectFactory.ts`, where they can be tested without a
 * database.
 */

import { getAllProjects, getProject } from './projectReads';
import { createProject, deleteProject, updateProject } from './projectWrites';
import type { PersistenceResult } from '../persistence';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from './ArchitectureProjectTypes';

export interface ArchitectureProjectRepository {
  list(userId?: string, isAdmin?: boolean): Promise<Project[]>;
  get(projectId: string): Promise<Project | undefined>;
  /**
   * Persist a project the factory built.
   *
   * The signature takes a `Project`, never the raw fields, because the only
   * way to obtain one is `createArchitectureProject` — which is what makes the
   * initiative invariant unavoidable rather than merely documented.
   */
  create(project: Project, userId: string | undefined): Promise<PersistenceResult<unknown>>;
  update(
    projectId: string,
    updates: Partial<Project>,
    options?: { userId?: string; expectedUpdatedAt?: string },
  ): Promise<PersistenceResult<{ updatedAt: string }>>;
  remove(projectId: string): Promise<PersistenceResult<unknown>>;
  /** Hydrate the artifacts of a project loaded from the portfolio index. */
  loadArtifacts(projectId: string): Promise<Artifact[] | undefined>;
}

export const architectureProjectRepository: ArchitectureProjectRepository = {
  list: (userId, isAdmin) => getAllProjects(userId, isAdmin),
  get: (projectId) => getProject(projectId),
  create: (project, userId) => createProject({ ...project, userId }),
  update: (projectId, updates, options = {}) => updateProject(projectId, updates, options),
  remove: (projectId) => deleteProject(projectId),
  loadArtifacts: async (projectId) => (await getProject(projectId))?.artifacts,
};
