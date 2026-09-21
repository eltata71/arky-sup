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
import type { Artifact, ConsistencySuggestion, GroupedArtifacts, Project } from '../../types';
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

  const createArtifact = useCallback((projectId: string, artifactData: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>, deterministicId?: string): Artifact => {
    // La identidad, el versionado y el resumen de compilación los decide el
    // agregado. Este hook aporta el estado optimista y la escritura.
    // `deterministicId` llega de la Oficina: la reanudación de un mismo intento
    // de tarea debe reencontrar el artefacto, no crear un segundo.
    const newArtifact = createArtifactAggregate(artifactData, deterministicId ? { id: deterministicId } : undefined);

    let previousArtifacts: Artifact[] = [];
    let updatedArtifacts: Artifact[] = [];

    setProjects(prev => {
      return prev.map(p => {
        if (p.id === projectId) {
          previousArtifacts = p.artifacts;
          updatedArtifacts = [...p.artifacts, newArtifact];
          return { ...p, artifacts: updatedArtifacts };
        }
        return p;
      });
    });

    if (updatedArtifacts.length > 0) {
      persistArtifacts(projectId, updatedArtifacts, previousArtifacts, 'createArtifact', () => artifactRepository.create(projectId, newArtifact, user?.uid));
    }

    return newArtifact;
  }, [persistArtifacts, setProjects, user]);

  const createArtifactVersion = useCallback((projectId: string, versionGroupId: string, artifactData: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>): Artifact => {
    let newArtifact: Artifact | null = null;
    let previousArtifacts: Artifact[] = [];
    let updatedArtifacts: Artifact[] = [];

    setProjects(prev => {
      return prev.map(p => {
        if (p.id === projectId) {
          previousArtifacts = p.artifacts;
          newArtifact = createArtifactVersionAggregate(versionGroupId, artifactData, p.artifacts);

          updatedArtifacts = [...p.artifacts, newArtifact];
          return { ...p, artifacts: updatedArtifacts };
        }
        return p;
      });
    });

    if (updatedArtifacts.length > 0) {
      persistArtifacts(projectId, updatedArtifacts, previousArtifacts, 'createArtifactVersion', () => artifactRepository.create(projectId, newArtifact!, user?.uid));
    }

    return newArtifact!;
  }, [persistArtifacts, setProjects, user]);

  const getArtifact = useCallback((projectId: string, artifactId: string) => {
    const project = getProject(projectId);
    return project?.artifacts.find(a => a.id === artifactId);
  }, [getProject]);

  const updateArtifact = useCallback((projectId: string, artifactId: string, updates: Partial<Artifact>) => {
    let previousArtifacts: Artifact[] = [];
    let updatedArtifacts: Artifact[] = [];
    // The remote write carries only the partial. When a recompilation refreshes
    // the compilation block, that fresh block is added to the partial so the
    // persisted artifact never keeps a stale `compilation` (Task 1/3/4).
    let remoteUpdates: Partial<Artifact> = updates;

    setProjects(prev => {
      return prev.map(p => {
        if (p.id === projectId) {
          previousArtifacts = p.artifacts;
          updatedArtifacts = p.artifacts.map(a => {
            if (a.id !== artifactId) return a;
            // Centralised recompilation in `safe` mode: keeps `compilation`
            // synchronised with the artifact's real content on the manual-edit
            // path. The fast-path inside recompile skips work when no
            // compilation-relevant field changed (e.g. favorite/review toggles).
            const outcome = recompileArtifactBeforePersist({ ...a, ...updates }, { source: 'manual' });
            remoteUpdates = outcome.recompiled
              ? { ...updates, compilation: outcome.artifact.compilation }
              : updates;
            return outcome.artifact;
          });
          return { ...p, artifacts: updatedArtifacts };
        }
        return p;
      });
    });

    if (updatedArtifacts.length > 0) {
      persistArtifacts(projectId, updatedArtifacts, previousArtifacts, 'updateArtifact', () => artifactRepository.update(projectId, artifactId, remoteUpdates, { userId: user?.uid }));
    }
  }, [persistArtifacts, setProjects, user]);

  const deleteArtifact = useCallback((projectId: string, artifactId: string) => {
    let previousArtifacts: Artifact[] = [];
    let updatedArtifacts: Artifact[] = [];

    setProjects(prev => {
      return prev.map(p => {
        if (p.id === projectId) {
          previousArtifacts = p.artifacts;
          updatedArtifacts = p.artifacts.filter(a => a.id !== artifactId);
          return { ...p, artifacts: updatedArtifacts };
        }
        return p;
      });
    });

    persistArtifacts(projectId, updatedArtifacts, previousArtifacts, 'deleteArtifact', () => artifactRepository.remove(projectId, artifactId, user?.uid));
  }, [persistArtifacts, setProjects, user]);
  
  const getGroupedArtifactsByView = useCallback((projectId: string): GroupedArtifacts => {
    const project = getProject(projectId);
    if (!project || !Array.isArray(project.artifacts)) return {};
    return groupArtifactsByView(project.artifacts);
  }, [getProject]);
  
  const applyConsistencySuggestion = useCallback((projectId: string, suggestion: ConsistencySuggestion) => {
    let previousArtifacts: Artifact[] = [];
    let updatedArtifacts: Artifact[] = [];

    setProjects(prev => {
      return prev.map(p => {
        if (p.id === projectId) {
          previousArtifacts = p.artifacts;
          updatedArtifacts = [...p.artifacts];

          suggestion.changes.forEach(change => {
            const artifactToChange = updatedArtifacts.find(a => a.id === change.artifactId);
            if (!artifactToChange) return;

            const allVersionsInGroup = updatedArtifacts
              .filter(a => a.versionGroupId === artifactToChange.versionGroupId)
              .sort((a, b) => b.version - a.version);

            const latestVersionInGroup = allVersionsInGroup[0];
            // A consistency suggestion replaces `content`; recompile so the new
            // version never inherits the previous version's stale compilation.
            // Una sugerencia de consistencia reemplaza el contenido, así que
            // esto recompila: heredar la compilación anterior haría que el
            // artefacto dijera estar puntuado sobre un texto que ya no tiene.
            const newVersion = reviseArtifact(
              latestVersionInGroup,
              latestVersionInGroup.version,
              { content: change.newContent },
            );
            updatedArtifacts.push(newVersion);
          });
          return { ...p, artifacts: updatedArtifacts };
        }
        return p;
      });
    });

    if (updatedArtifacts.length > 0) {
      persistArtifacts(projectId, updatedArtifacts, previousArtifacts, 'applyConsistencySuggestion', () => artifactRepository.replaceAll(projectId, updatedArtifacts, { userId: user?.uid }));
    }
  }, [persistArtifacts, setProjects, user]);
  
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

    let previousArtifacts: Artifact[] = [];
    let updatedArtifacts: Artifact[] = [];
    setProjects(prev => {
      return prev.map(p => {
        if (p.id === projectId) {
          previousArtifacts = p.artifacts;
          updatedArtifacts = [...p.artifacts, newVersion];
          return { ...p, artifacts: updatedArtifacts };
        }
        return p;
      });
    });

    if (updatedArtifacts.length > 0) {
      persistArtifacts(projectId, updatedArtifacts, previousArtifacts, 'restoreArtifactVersion', () => artifactRepository.create(projectId, newVersion, user?.uid));
    }

    return newVersion;
  }, [getArtifactVersions, persistArtifacts, setProjects, user]);

  const removeCorruptArtifacts = useCallback((projectId: string, corruptArtifactIds: string[]) => {
    let previousArtifacts: Artifact[] = [];
    let updatedArtifacts: Artifact[] = [];
    setProjects(prevProjects => {
      return prevProjects.map(p => {
        if (p.id === projectId) {
          previousArtifacts = p.artifacts;
          updatedArtifacts = p.artifacts.filter(a => !corruptArtifactIds.includes(a.id));
          return { ...p, artifacts: updatedArtifacts };
        }
        return p;
      });
    });

    persistArtifacts(projectId, updatedArtifacts, previousArtifacts, 'removeCorruptArtifacts', () => artifactRepository.replaceAll(projectId, updatedArtifacts, { userId: user?.uid }));
  }, [persistArtifacts, setProjects, user]);

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
