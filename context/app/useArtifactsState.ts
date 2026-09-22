/**
 * Artifacts: creation, versions, edits, deletion — and what happens when the
 * database refuses one.
 *
 * The interesting rule is in `persistArtifacts`, and it is not obvious: a
 * failed write rolls back an *edit*, but keeps a freshly *generated* artifact
 * on screen, marked `failed` or `conflict`. Discarding a generation the user
 * just waited a minute for, because the write did not land, loses work that
 * cannot be recovered by retrying — whereas the edit can simply be made again.
 *
 * Artifacts live inside the project record, so this hook writes through
 * `setProjects` from `useProjectsState` rather than owning state of its own.
 * That is deliberate: two arrays of the same artifacts is how a canvas and a
 * sidebar start disagreeing.
 */

import React, { useCallback } from 'react';
import type { ConsistencySuggestion } from '../../types';
import type { Artifact, GroupedArtifacts } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';
import type { PersistenceResult } from '../../services/persistence';
import { artifactRepository } from '../../services/artifacts/ArtifactRepository';
import { observabilityService } from '../../services/observability';
import { recompileArtifactBeforePersist } from '../../services/artifactCompiler';
import {
  createArtifact as createArtifactAggregate,
  createArtifactVersion as createArtifactVersionAggregate,
  reviseArtifact,
} from '../../services/artifacts/artifactFactory';
import { groupArtifactsByView, findLatestArtifactByName as findLatestByName } from '../../utils';
import { useAuth } from '../AuthContext';
import type { PersistenceReporter } from './usePersistenceReporter';

interface ArtifactsStatePorts {
  readonly setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  readonly getProject: (id: string) => Project | undefined;
  readonly reporter: PersistenceReporter;
}

export const useArtifactsState = ({ setProjects, getProject, reporter }: ArtifactsStatePorts) => {
  const { user } = useAuth();
  const { handleWriteResult, setPersistenceStatus, setPersistenceMessage } = reporter;

  const markArtifactPersistence = useCallback((projectId: string, artifactIds: Set<string>, remote: 'pending' | 'success' | 'failed' | 'conflict') => {
    setProjects(prev => prev.map(project => {
      if (project.id !== projectId) return project;
      return {
        ...project,
        artifacts: project.artifacts.map(artifact => {
          if (!artifactIds.has(artifact.id) || !artifact.generationTrace) return artifact;
          const lifecycleState = remote === 'success' ? 'persisted-remote' : remote === 'pending' ? 'persisted-local' : 'failed-recoverable';
          return {
            ...artifact,
            generationTrace: {
              ...artifact.generationTrace,
              lifecycle: Array.from(new Set([...(artifact.generationTrace.lifecycle ?? []), lifecycleState])),
              persistence: {
                ...(artifact.generationTrace.persistence ?? { local: 'success', remote: 'pending' }),
                remote,
              },
            },
          };
        }),
      };
    }));
  }, [setProjects]);

  /**
   * Stores the revision the database confirmed on each artifact (ADR-106).
   *
   * The next command on that artifact compares it, so it travels with the
   * artifact in state — never in a module-level map, which is the defect
   * (H10) F2-10 removed from engagements. Without it, the second edit of the
   * same artifact would carry a stale revision and be refused as a conflict.
   */
  const recordRevisions = useCallback((projectId: string, confirmed: readonly Pick<Artifact, 'id' | 'revision'>[]) => {
    const byId = new Map(confirmed
      .filter((entry) => typeof entry.revision === 'number')
      .map((entry) => [entry.id, entry.revision as number]));
    if (byId.size === 0) return;
    setProjects(prev => prev.map(project => project.id !== projectId ? project : {
      ...project,
      artifacts: project.artifacts.map(artifact => byId.has(artifact.id)
        ? { ...artifact, revision: byId.get(artifact.id) }
        : artifact),
    }));
  }, [setProjects]);

  /** Wraps a command so a confirmed result records its revisions. */
  const confirming = useCallback(<T,>(
    projectId: string,
    write: () => Promise<PersistenceResult<T>>,
    revisionsOf: (data: T) => readonly Pick<Artifact, 'id' | 'revision'>[],
  ) => async (): Promise<PersistenceResult<T>> => {
    const result = await write();
    if (result.success && result.data !== undefined) recordRevisions(projectId, revisionsOf(result.data));
    return result;
  }, [recordRevisions]);

  /**
   * Persists artifact mutations and rolls back non-generated edits on any
   * unconfirmed remote write. Generated artifacts may remain visible, but they
   * are marked as remote failed/conflict and never presented as persisted.
   */
  const persistArtifacts = useCallback((
    projectId: string,
    nextArtifacts: Artifact[],
    previousArtifacts: Artifact[],
    operationName: string,
    // The helper only reads the result's status, never its payload, so it
    // accepts any write. Typing it `PersistenceResult` — which defaults
    // to `<void>` — rejected every real caller, and the mismatch was
    // invisible while React's types were missing and JSX was all `any`.
    remoteWrite: () => Promise<PersistenceResult<unknown>>,
  ): void => {
    const changedIds = new Set(nextArtifacts.filter(next => !previousArtifacts.some(prev => prev.id === next.id && prev === next)).map(artifact => artifact.id));
    markArtifactPersistence(projectId, changedIds, 'pending');
    setPersistenceStatus('saving');
    setPersistenceMessage('Guardando artefacto en base de datos…');

    remoteWrite().then(result => {
      if (handleWriteResult(result, 'Artefacto guardado en base de datos.')) {
        markArtifactPersistence(projectId, changedIds, 'success');
        return;
      }

      const remoteState = result.status === 'conflict' ? 'conflict' : 'failed';
      const generatedLocalIds = new Set(
        nextArtifacts
          .filter(artifact => artifact.generationTrace && !previousArtifacts.some(prev => prev.id === artifact.id))
          .map(artifact => artifact.id),
      );
      const keepGeneratedVisible = generatedLocalIds.size > 0;
      observabilityService.reportError(result.error ?? new Error(result.message), {
        source: 'operation',
        title: 'No se pudieron guardar los artefactos',
        message: keepGeneratedVisible
          ? 'El artefacto recién generado se conserva localmente y queda marcado como guardado remoto fallido.'
          : 'Se revirtieron los cambios locales para mantener consistencia con la base de datos.',
        operationName,
        recoverable: true,
        userVisible: true,
        metadata: { projectId, generatedLocalIds: Array.from(generatedLocalIds).join(','), status: result.status },
      });
      if (keepGeneratedVisible) {
        markArtifactPersistence(projectId, generatedLocalIds, remoteState);
        return;
      }
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, artifacts: previousArtifacts } : p));
    }).catch(e => {
      observabilityService.reportError(e, {
        source: 'operation',
        title: 'No se pudieron guardar los artefactos',
        message: 'Se revirtieron los cambios locales para mantener consistencia con la base de datos.',
        operationName,
        recoverable: true,
        userVisible: true,
        metadata: { projectId },
      });
      setPersistenceStatus('error');
      setPersistenceMessage('No se pudo guardar en la base de datos.');
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, artifacts: previousArtifacts } : p));
    });
  }, [handleWriteResult, markArtifactPersistence, setProjects, setPersistenceStatus, setPersistenceMessage]);

  /**
   * Applies a pure change to one project's artifacts and returns what the write
   * needs: the list before and after.
   *
   * The change is computed on the current snapshot and the **same** function
   * is applied inside the state updater. The hook used to decide what to
   * persist from variables assigned *inside* the updater, which only works if
   * React runs it synchronously — and React only does that for the first
   * update of a render: the second consecutive edit of an artifact left them
   * empty and was never written, with no error anywhere (found while wiring
   * F4-03; `artifactRevisionFlow.test.tsx` pins it).
   */
  const changeArtifacts = useCallback((
    projectId: string,
    change: (artifacts: Artifact[]) => Artifact[],
  ): { previous: Artifact[]; next: Artifact[] } | null => {
    const snapshot = getProject(projectId);
    if (!snapshot) return null;
    const previous = snapshot.artifacts;
    const next = change(previous);
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, artifacts: change(p.artifacts) } : p));
    return { previous, next };
  }, [getProject, setProjects]);

  const createArtifact = useCallback((projectId: string, artifactData: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>, deterministicId?: string): Artifact => {
    // La identidad, el versionado y el resumen de compilación los decide el
    // agregado. Este hook aporta el estado optimista y la escritura.
    // `deterministicId` llega de la Oficina: la reanudación de un mismo intento
    // de tarea debe reencontrar el artefacto, no crear un segundo.
    const newArtifact = createArtifactAggregate(artifactData, deterministicId ? { id: deterministicId } : undefined);
    const changed = changeArtifacts(projectId, artifacts => [...artifacts, newArtifact]);
    if (changed) {
      persistArtifacts(projectId, changed.next, changed.previous, 'createArtifact', confirming(projectId,
        () => artifactRepository.create(projectId, newArtifact, user?.uid),
        (saved) => [saved]));
    }
    return newArtifact;
  }, [changeArtifacts, confirming, persistArtifacts, user]);

  const createArtifactVersion = useCallback((projectId: string, versionGroupId: string, artifactData: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>): Artifact => {
    const siblings = getProject(projectId)?.artifacts ?? [];
    const newArtifact = createArtifactVersionAggregate(versionGroupId, artifactData, siblings);
    const changed = changeArtifacts(projectId, artifacts => [...artifacts, newArtifact]);
    if (changed) {
      persistArtifacts(projectId, changed.next, changed.previous, 'createArtifactVersion', confirming(projectId,
        () => artifactRepository.createVersion(projectId, newArtifact, user?.uid),
        (saved) => [saved]));
    }
    return newArtifact;
  }, [changeArtifacts, confirming, getProject, persistArtifacts, user]);

  const getArtifact = useCallback((projectId: string, artifactId: string) => {
    const project = getProject(projectId);
    return project?.artifacts.find(a => a.id === artifactId);
  }, [getProject]);

  const updateArtifact = useCallback((projectId: string, artifactId: string, updates: Partial<Artifact>) => {
    const current = getProject(projectId)?.artifacts.find(a => a.id === artifactId);
    if (!current) return;
    // Centralised recompilation in `safe` mode: keeps `compilation`
    // synchronised with the artifact's real content on the manual-edit path.
    // The fast-path inside recompile skips work when no compilation-relevant
    // field changed (e.g. favorite/review toggles).
    const outcome = recompileArtifactBeforePersist({ ...current, ...updates }, { source: 'manual' });
    // The remote write carries only the partial. When a recompilation refreshes
    // the compilation block, that fresh block is added to the partial so the
    // persisted artifact never keeps a stale `compilation`.
    const remoteUpdates: Partial<Artifact> = outcome.recompiled
      ? { ...updates, compilation: outcome.artifact.compilation }
      : updates;
    // The revision this edit was made against: the server compares it, so an
    // edit made on a stale copy is refused instead of overwriting another.
    const expectedRevision = current.revision;
    const changed = changeArtifacts(projectId, artifacts =>
      artifacts.map(a => a.id === artifactId ? { ...a, ...remoteUpdates } : a));
    if (changed) {
      persistArtifacts(projectId, changed.next, changed.previous, 'updateArtifact', confirming(projectId,
        () => artifactRepository.update(projectId, artifactId, remoteUpdates, { userId: user?.uid, expectedRevision }),
        (saved) => [{ id: artifactId, revision: saved.revision }]));
    }
  }, [changeArtifacts, confirming, getProject, persistArtifacts, user]);

  const deleteArtifact = useCallback((projectId: string, artifactId: string) => {
    const changed = changeArtifacts(projectId, artifacts => artifacts.filter(a => a.id !== artifactId));
    if (!changed) return;
    const expectedRevision = changed.previous.find(a => a.id === artifactId)?.revision;
    persistArtifacts(projectId, changed.next, changed.previous, 'deleteArtifact', () => artifactRepository.remove(projectId, artifactId, { userId: user?.uid, expectedRevision }));
  }, [changeArtifacts, persistArtifacts, user]);

  const getGroupedArtifactsByView = useCallback((projectId: string): GroupedArtifacts => {
    const project = getProject(projectId);
    if (!project || !Array.isArray(project.artifacts)) return {};
    return groupArtifactsByView(project.artifacts);
  }, [getProject]);

  const applyConsistencySuggestion = useCallback((projectId: string, suggestion: ConsistencySuggestion) => {
    const snapshot = getProject(projectId)?.artifacts ?? [];
    const newVersions: Artifact[] = [];
    const working = [...snapshot];
    suggestion.changes.forEach(change => {
      const artifactToChange = working.find(a => a.id === change.artifactId);
      if (!artifactToChange) return;
      const latestVersionInGroup = working
        .filter(a => a.versionGroupId === artifactToChange.versionGroupId)
        .sort((a, b) => b.version - a.version)[0];
      // A consistency suggestion replaces `content`; recompile so the new
      // version never inherits the previous version's stale compilation.
      // Una sugerencia de consistencia reemplaza el contenido, así que
      // esto recompila: heredar la compilación anterior haría que el
      // artefacto dijera estar puntuado sobre un texto que ya no tiene.
      const newVersion = reviseArtifact(latestVersionInGroup, latestVersionInGroup.version, { content: change.newContent });
      working.push(newVersion);
      newVersions.push(newVersion);
    });
    if (newVersions.length === 0) return;
    const changed = changeArtifacts(projectId, artifacts => [...artifacts, ...newVersions]);
    if (changed) {
      // One user intent, one transaction: every new version lands or none do
      // (ADR-106 §4), so a consistency fix is never left half applied.
      persistArtifacts(projectId, changed.next, changed.previous, 'applyConsistencySuggestion', confirming(projectId,
        () => artifactRepository.revise(projectId, newVersions.map(artifact => ({ op: 'create-version' as const, artifact })), user?.uid),
        (saved) => saved));
    }
  }, [changeArtifacts, confirming, getProject, persistArtifacts, user]);

  const toggleArtifactFavorite = useCallback((projectId: string, artifactId: string) => {
      const artifact = getArtifact(projectId, artifactId);
      if (artifact) {
          updateArtifact(projectId, artifactId, { isFavorite: !artifact.isFavorite });
      }
  }, [getArtifact, updateArtifact]);

  const findLatestArtifactByName = useCallback((projectId: string, name: string): Artifact | undefined => {
      const project = getProject(projectId);
      if (!project) return undefined;
      return findLatestByName(project.artifacts, name);
  }, [getProject]);

  const getArtifactVersions = useCallback((projectId: string, versionGroupId: string): Artifact[] => {
      const project = getProject(projectId);
      if (!project) return [];

      return project.artifacts
        .filter(a => a.versionGroupId === versionGroupId)
        .sort((a, b) => b.version - a.version);
  }, [getProject]);

  const restoreArtifactVersion = useCallback((projectId: string, versionToRestore: Artifact): Artifact => {
    const allVersions = getArtifactVersions(projectId, versionToRestore.versionGroupId);
    const latestVersionNumber = allVersions.length > 0 ? allVersions[0].version : 0;

    // Restaurar una versión —y guardar una edición manual— clona un artefacto
    // cuyo contenido puede diferir del que se puntuó. `reviseArtifact`
    // recompila por eso.
    const newVersion = reviseArtifact(versionToRestore, latestVersionNumber);
    const changed = changeArtifacts(projectId, artifacts => [...artifacts, newVersion]);
    if (changed) {
      persistArtifacts(projectId, changed.next, changed.previous, 'restoreArtifactVersion', confirming(projectId,
        () => artifactRepository.createVersion(projectId, newVersion, user?.uid),
        (saved) => [saved]));
    }
    return newVersion;
  }, [changeArtifacts, confirming, getArtifactVersions, persistArtifacts, user]);

  const removeCorruptArtifacts = useCallback((projectId: string, corruptArtifactIds: string[]) => {
    const changed = changeArtifacts(projectId, artifacts => artifacts.filter(a => !corruptArtifactIds.includes(a.id)));
    if (!changed) return;
    const removed = changed.previous.filter(a => corruptArtifactIds.includes(a.id));
    persistArtifacts(projectId, changed.next, changed.previous, 'removeCorruptArtifacts', () => artifactRepository.removeMany(projectId, removed, user?.uid));
  }, [changeArtifacts, persistArtifacts, user]);

  return {
    createArtifact,
    createArtifactVersion,
    getArtifact,
    updateArtifact,
    deleteArtifact,
    getGroupedArtifactsByView,
    applyConsistencySuggestion,
    toggleArtifactFavorite,
    findLatestArtifactByName,
    getArtifactVersions,
    restoreArtifactVersion,
    removeCorruptArtifacts,
  };
};
