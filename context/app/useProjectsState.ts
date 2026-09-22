/**
 * The projects a user can see, and every write that changes one.
 *
 * `projects` is the state the rest of the context is built on: artifacts live
 * inside a project record, and the knowledge graph is a field on it. So this
 * hook owns the array and hands `setProjects` to the hooks that need to write
 * through it — one owner, several writers, rather than four copies drifting.
 *
 * Every write here is optimistic with an explicit rollback, and every rollback
 * is reported. That pairing is the whole design: the UI stays fast, and a
 * failed write never leaves the screen showing something the database does not
 * have.
 */

import React, { useCallback, useRef, useState } from 'react';
import type { Project } from '../../services/architectureProjects';
import { architectureProjectRepository } from '../../services/architectureProjects/ArchitectureProjectRepository';
import {
  createArchitectureProject,
  type CreateArchitectureProjectInput,
  type CreateArchitectureProjectResult,
} from '../../services/architectureProjects/architectureProjectFactory';
import { observabilityService } from '../../services/observability';
import { useAuth } from '../AuthContext';
import type { PersistenceReporter } from './usePersistenceReporter';

export interface ProjectsState {
  readonly projects: Project[];
  readonly setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  /** Mirrors `projects` for debounced/async callbacks that must stay stable. */
  readonly projectsRef: React.MutableRefObject<Project[]>;
  readonly addProject: (input: CreateArchitectureProjectInput) => CreateArchitectureProjectResult;
  readonly getProject: (id: string) => Project | undefined;
  readonly ensureProjectArtifacts: (id: string) => Promise<void>;
  readonly updateProject: (id: string, updates: Partial<Omit<Project, 'id' | 'artifacts'>>) => void;
  readonly deleteProject: (id: string) => void;
  readonly updateProjectContext: (projectId: string, context: string[]) => void;
  /**
   * Reads the user's projects from the repository.
   *
   * Exposed so `useAppBootstrap` can orchestrate the first load without
   * importing the repository itself: the hook that owns `projects` is the one
   * that knows where they come from.
   */
  readonly loadProjects: (userId: string | undefined, includeAll: boolean) => Promise<Project[]>;
}

export const useProjectsState = (reporter: PersistenceReporter): ProjectsState => {
  const [projects, setProjects] = useState<Project[]>([]);
  const { user } = useAuth();
  const { handleWriteResult, setPersistenceStatus, setPersistenceMessage } = reporter;

  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  /**
   * Open an attention.
   *
   * A thin wrapper over `createArchitectureProject`, which is the only thing
   * that can build a `Project` and the only thing that knows an attention must
   * belong to an initiative. This used to build the aggregate inline with
   * `initiativeIds` optional and a `?? []` fallback, which made the invariant
   * `CLAUDE.md` states a convention of `AttentionInitiativeGate` — one React
   * component standing between the product and an orphan.
   *
   * It returns the factory's result rather than a `Project`, so a caller has
   * to handle the refusal instead of receiving something that looks fine.
   */
  const addProject = useCallback((input: CreateArchitectureProjectInput): CreateArchitectureProjectResult => {
    const created = createArchitectureProject({
      ...input,
      author: { authorId: user?.uid ?? null, authorName: user?.displayName ?? null },
    });
    if (created.outcome === 'rejected') return created;

    const newProject = created.project;

    // Optimistic UI update with an explicit remote-pending state.
    setProjects(prev => [...prev, newProject]);
    setPersistenceStatus('saving');
    setPersistenceMessage('Guardando proyecto en base de datos…');

    architectureProjectRepository.create(newProject, user?.uid).then(result => {
      if (!handleWriteResult(result, 'Proyecto guardado en base de datos.')) {
        setProjects(prev => prev.filter(p => p.id !== newProject.id));
      }
    }).catch(e => {
      observabilityService.reportError(e, {
        source: 'operation',
        title: 'No se pudo crear el proyecto',
        message: 'El proyecto se eliminó del estado local porque el guardado remoto falló. Reintenta o revisa permisos.',
        operationName: 'addProject',
        recoverable: true,
        userVisible: true,
        metadata: { projectId: newProject.id },
      });
      setPersistenceStatus('error');
      setPersistenceMessage('No se pudo guardar en la base de datos.');
      setProjects(prev => prev.filter(p => p.id !== newProject.id));
    });

    return created;
  }, [user, handleWriteResult, setPersistenceStatus, setPersistenceMessage]);

  const loadProjects = useCallback(
    (userId: string | undefined, includeAll: boolean) => architectureProjectRepository.list(userId, includeAll),
    [],
  );

  const getProject = useCallback((id: string) => projects.find(p => p.id === id), [projects]);

  /**
   * In-flight hydrations, so two components mounting at once do not each
   * fetch the same project's artifacts.
   */
  const hydratingProjects = React.useRef(new Map<string, Promise<void>>());

  const ensureProjectArtifacts = useCallback(async (id: string): Promise<void> => {
    const current = projectsRef.current.find(p => p.id === id);
    if (!current || current.artifactsLoaded !== false) return;

    const inFlight = hydratingProjects.current.get(id);
    if (inFlight) return inFlight;

    const request = (async () => {
      try {
        const hydrated = await architectureProjectRepository.get(id);
        if (!hydrated) return;
        setProjects(prev => prev.map(p => (
          // Merge rather than replace: an optimistic edit made while the read
          // was in flight lives on the record, and overwriting it with the
          // remote snapshot would silently discard the user's work.
          p.id === id
            ? { ...hydrated, ...p, artifacts: hydrated.artifacts, artifactsLoaded: true, artifactIndex: hydrated.artifactIndex }
            : p
        )));
      } catch (error) {
        observabilityService.reportError(error, {
          source: 'operation',
          title: 'No se pudieron cargar los artefactos del proyecto',
          operationName: 'ensureProjectArtifacts',
          recoverable: true,
          userVisible: true,
          metadata: { projectId: id },
        });
      } finally {
        hydratingProjects.current.delete(id);
      }
    })();

    hydratingProjects.current.set(id, request);
    return request;
  }, []);

  const updateProject = useCallback((id: string, updates: Partial<Omit<Project, 'id' | 'artifacts'>>) => {
    const updatedFields = { ...updates, updatedAt: new Date().toISOString() };
    let snapshot: Project | undefined;
    setProjects(prev => {
      snapshot = prev.find(p => p.id === id);
      return prev.map(p => (p.id === id ? { ...p, ...updatedFields } : p));
    });
    setPersistenceStatus('saving');
    architectureProjectRepository.update(id, updatedFields, { userId: user?.uid, expectedUpdatedAt: snapshot?.updatedAt }).then(result => {
      if (!handleWriteResult(result, 'Proyecto actualizado en base de datos.') && snapshot) {
        const rollback = snapshot;
        setProjects(prev => prev.map(p => (p.id === id ? rollback : p)));
      }
    }).catch(e => {
      observabilityService.reportError(e, {
        source: 'operation',
        title: 'No se pudo actualizar el proyecto',
        message: 'Se revirtió la actualización local porque el guardado remoto falló.',
        operationName: 'updateProject',
        recoverable: true,
        userVisible: true,
        metadata: { projectId: id },
      });
      if (snapshot) {
        const rollback = snapshot;
        setProjects(prev => prev.map(p => (p.id === id ? rollback : p)));
      }
    });
  }, [user, handleWriteResult, setPersistenceStatus]);

  const deleteProject = useCallback((id: string) => {
    let snapshot: Project | undefined;
    setProjects(prev => {
      snapshot = prev.find(p => p.id === id);
      return prev.filter(p => p.id !== id);
    });
    setPersistenceStatus('saving');
    architectureProjectRepository.remove(id).then(result => {
      if (!handleWriteResult(result, 'Proyecto eliminado en base de datos.') && snapshot) {
        const rollback = snapshot;
        setProjects(prev => (prev.some(p => p.id === id) ? prev : [...prev, rollback]));
      }
    }).catch(e => {
      observabilityService.reportError(e, {
        source: 'operation',
        title: 'No se pudo eliminar el proyecto',
        message: 'Se restauró el proyecto en el estado local porque el borrado remoto falló.',
        operationName: 'deleteProject',
        recoverable: true,
        userVisible: true,
        metadata: { projectId: id },
      });
      if (snapshot) {
        const rollback = snapshot;
        setProjects(prev => (prev.some(p => p.id === id) ? prev : [...prev, rollback]));
      }
    });
  }, [handleWriteResult, setPersistenceStatus]);

  const updateProjectContext = useCallback((projectId: string, context: string[]) => {
    updateProject(projectId, { projectContext: context });
  }, [updateProject]);

  return {
    projects,
    setProjects,
    projectsRef,
    addProject,
    getProject,
    ensureProjectArtifacts,
    updateProject,
    deleteProject,
    updateProjectContext,
    loadProjects,
  };
};
