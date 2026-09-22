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
  newProjectView,
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

    const newProject = newProjectView(created.project);

    // Optimistic UI update with an explicit remote-pending state.
    setProjects(prev => [...prev, newProject]);
    setPersistenceStatus('saving');
    setPersistenceMessage('Guardando proyecto en base de datos…');

    architectureProjectRepository.create(created.project, user?.uid).then(result => {
      if (!handleWriteResult(result, 'Proyecto guardado en base de datos.')) {
        setProjects(prev => prev.filter(p => p.id !== newProject.id));
        return;
      }
      // La revisión que la base asignó al crear: sin ella, la primera edición
      // de un proyecto recién creado iría contra 0 y chocaría (F4-07).
      const confirmed = result.data?.revision;
      if (typeof confirmed === 'number') {
        setProjects(prev => prev.map(p => (p.id === newProject.id ? { ...p, revision: confirmed } : p)));
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

  /**
   * Writes a change to a project's root.
   *
   * The snapshot is read from `projectsRef`, not captured inside the state
   * updater: React only runs an updater synchronously for the first update of
   * a render, so the second consecutive edit found no snapshot — no rollback
   * if the write failed, and no revision to compare (F4-07; the same defect
   * `useArtifactsState` had). The revision it sends is the one this record was
   * read with, and the one the database confirms is written back into state,
   * so the next edit compares against it.
   */
  const updateProject = useCallback((id: string, updates: Partial<Omit<Project, 'id' | 'artifacts'>>) => {
    const snapshot = projectsRef.current.find(p => p.id === id);
    if (!snapshot) return;
    const { revision: _revision, ...changes } = updates;
    const updatedFields = { ...changes, updatedAt: new Date().toISOString() };
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, ...updatedFields } : p)));
    setPersistenceStatus('saving');
    const rollback = () => setProjects(prev => prev.map(p => (p.id === id ? snapshot : p)));
    architectureProjectRepository.update(id, updatedFields, { userId: user?.uid, expectedRevision: snapshot.revision }).then(result => {
      if (!handleWriteResult(result, 'Proyecto actualizado en base de datos.')) {
        rollback();
        return;
      }
      const confirmed = result.data?.revision;
      if (typeof confirmed === 'number') {
        setProjects(prev => prev.map(p => (p.id === id ? { ...p, revision: confirmed } : p)));
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
      rollback();
    });
  }, [user, handleWriteResult, setPersistenceStatus]);

  const deleteProject = useCallback((id: string) => {
    const snapshot = projectsRef.current.find(p => p.id === id);
    if (!snapshot) return;
    setProjects(prev => prev.filter(p => p.id !== id));
    setPersistenceStatus('saving');
    const rollback = () => setProjects(prev => (prev.some(p => p.id === id) ? prev : [...prev, snapshot]));
    architectureProjectRepository.remove(id, snapshot.revision).then(result => {
      if (!handleWriteResult(result, 'Proyecto eliminado en base de datos.')) rollback();
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
      rollback();
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
