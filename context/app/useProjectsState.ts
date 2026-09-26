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
// The domain door, not the module barrel: this hook is on the boot path, and
// the domain is pure and small (the rule of the barrel against the bundle).
import {
  applyProjectCommand,
  type ProjectCommand,
  type ProjectCommandRejection,
} from '../../services/architectureProjects/domain';
import { architectureProjectRepository } from '../../services/architectureProjects/infrastructure/ArchitectureProjectRepository';
import {
  createArchitectureProject,
  newProjectView,
  type CreateArchitectureProjectInput,
  type CreateArchitectureProjectResult,
} from '../../services/architectureProjects/domain/architectureProjectFactory';
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
  /**
   * Apply a named operation to a project (F6-03, corte 2b) — there is no
   * `update(partial)`. The rule is the domain's (`applyProjectCommand`); this
   * only does what a provider is for: optimistic state, the write, the rollback.
   */
  readonly runProjectCommand: (id: string, command: ProjectCommand) => ProjectCommandOutcome;
  /** The knowledge graph, by its own path: it does not touch the root nor its revision. */
  readonly saveProjectGraph: (id: string, graph: NonNullable<Project['architectureKnowledgeGraph']>) => void;
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

/**
 * What a command did, synchronously: rejected with a typed reason, applied
 * with nothing to write, or applied and on its way to the database. The write
 * itself is reported like every other write, through the persistence reporter.
 */
export type ProjectCommandOutcome =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly rejection: ProjectCommandRejection | { readonly reason: 'not-found'; readonly message: string } };

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
   * Applies a named operation to a project's root and writes what it changed.
   *
   * The snapshot is read from `projectsRef`, not captured inside the state
   * updater: React only runs an updater synchronously for the first update of
   * a render, so the second consecutive edit found no snapshot — no rollback
   * if the write failed, and no revision to compare (F4-07; the same defect
   * `useArtifactsState` had). The revision it sends is the one this record was
   * read with, and the one the database confirms is written back into state,
   * so the next edit compares against it.
   */
  const runProjectCommand = useCallback((id: string, command: ProjectCommand): ProjectCommandOutcome => {
    const snapshot = projectsRef.current.find(p => p.id === id);
    if (!snapshot) {
      return { ok: false, rejection: { reason: 'not-found', message: `El proyecto ${id} no está cargado.` } };
    }
    const decision = applyProjectCommand(snapshot, command);
    if (!decision.ok) {
      observabilityService.recordWarning({
        source: 'operation',
        title: 'Cambio de proyecto rechazado',
        message: decision.rejection.message,
        operationName: `project:${command.kind}`,
        metadata: { projectId: id, reason: decision.rejection.reason },
        recoverable: true,
      });
      return decision;
    }
    if (!decision.changed) return { ok: true, changed: false };

    const changes = decision.changes;
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, ...changes } : p)));
    setPersistenceStatus('saving');
    const rollback = () => setProjects(prev => prev.map(p => (p.id === id ? snapshot : p)));
    architectureProjectRepository.update(id, changes, { userId: user?.uid, expectedRevision: snapshot.revision }).then(result => {
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
        operationName: `project:${command.kind}`,
        recoverable: true,
        userVisible: true,
        metadata: { projectId: id },
      });
      rollback();
    });
    return { ok: true, changed: true };
  }, [user, handleWriteResult, setPersistenceStatus]);

  /**
   * The graph is derived, so a failed save keeps it in state: it is still the
   * right picture of the artifacts, and the projection outbox rebuilds and
   * saves it on the next start (F5-04/F5-05). What changes on success is only
   * the revision the next save compares against.
   */
  const saveProjectGraph = useCallback((id: string, graph: NonNullable<Project['architectureKnowledgeGraph']>) => {
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, architectureKnowledgeGraph: graph } : p)));
    architectureProjectRepository.saveGraph(id, graph).then((confirmed) => {
      if (!confirmed) return;
      setProjects(prev => prev.map(p => (p.id === id && p.architectureKnowledgeGraph
        ? { ...p, architectureKnowledgeGraph: { ...p.architectureKnowledgeGraph, revision: confirmed.revision } }
        : p)));
    }).catch(e => {
      observabilityService.reportError(e, {
        source: 'operation',
        severity: 'warning',
        title: 'Grafo de conocimiento sin guardar',
        operationName: 'saveProjectGraph',
        recoverable: true,
        metadata: { projectId: id },
      });
    });
  }, []);

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
    runProjectCommand(projectId, { kind: 'replace-memory', area: 'projectContext', texts: context });
  }, [runProjectCommand]);

  return {
    projects,
    setProjects,
    projectsRef,
    addProject,
    getProject,
    ensureProjectArtifacts,
    runProjectCommand,
    saveProjectGraph,
    deleteProject,
    updateProjectContext,
    loadProjects,
  };
};
