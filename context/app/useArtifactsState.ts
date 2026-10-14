/**
 * Artifacts: creation, versions, edits, deletion — and what happens when the
 * database refuses one.
 *
 * Since F4-05 this hook decides nothing. What each intent means — which
 * version follows which, what is recompiled, which command carries it, which
 * revision it compares, and what is rolled back when the database refuses — is
 * `services/artifacts/application/artifactWorkflow`, pure and testable without
 * a provider. The interesting rule lives there and is not obvious: a failed
 * write rolls back an *edit*, but keeps a freshly *generated* artifact on
 * screen, marked `failed` or `conflict`.
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
import { artifactRepository } from '../../services/artifacts/infrastructure/ArtifactRepository';
import type { PersistenceResult } from '../../services/persistence';
import { observabilityService } from '../../services/observability';
// Ruta de fichero, no barril: este hook está en el camino de arranque
// (`AppContext`), y el barril de `services/artifacts` alcanza el motor de IA.
// Es una puerta declarada del módulo en `modules.json` (F3-06).
import {
  changedArtifactIds,
  executeArtifactWrite,
  markArtifactPersistence,
  planArtifactIntent,
  settleArtifactWrite,
  withConfirmedRevisions,
  type ArtifactIntent,
  type ArtifactPlan,
} from '../../services/artifacts/application/artifactWorkflow';
import { groupArtifactsByView, findLatestArtifactByName as findLatestByName } from '../../utils';
import { useAuth } from '../AuthContext';
import type { PersistenceReporter } from './usePersistenceReporter';

type NewArtifactDraft = Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>;

interface ArtifactsStatePorts {
  readonly t: (key: string, replacements?: Record<string, string>) => string;
  readonly setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  readonly getProject: (id: string) => Project | undefined;
  readonly reporter: PersistenceReporter;
}

export const useArtifactsState = ({ setProjects, getProject, reporter, t }: ArtifactsStatePorts) => {
  const { user } = useAuth();
  const { handleWriteResult, setPersistenceStatus, setPersistenceMessage } = reporter;

  /** Reescribe los artefactos de un proyecto con una función pura. */
  const updateArtifactsOf = useCallback((projectId: string, change: (artifacts: Artifact[]) => Artifact[]) => {
    setProjects(prev => prev.map(project => (project.id === projectId ? { ...project, artifacts: change(project.artifacts) } : project)));
  }, [setProjects]);

  /**
   * Ejecuta una intención: el plan lo decide `artifactWorkflow` (F4-05) y aquí
   * sólo queda lo que es de React — el estado optimista, la escritura y lo que
   * el plan diga que hay que hacer si la base no confirma.
   *
   * La instantánea se lee **antes** de tocar el estado y el mismo cambio se
   * aplica dentro del actualizador: decidir qué persistir desde variables
   * asignadas dentro del actualizador sólo funciona si React lo ejecuta en el
   * acto, y sólo lo hace con la primera actualización de un render — la
   * segunda edición consecutiva de un artefacto no se escribía (F4-03;
   * `artifactRevisionFlow.test.tsx` lo fija).
   */
  const run = useCallback((projectId: string, intent: ArtifactIntent, onPlanned?: (plan: ArtifactPlan) => void, onSettled?: (result: PersistenceResult<Artifact>) => void): Artifact | undefined => {
    const snapshot = getProject(projectId);
    const plan = planArtifactIntent(snapshot?.artifacts ?? [], intent);
    if (plan) onPlanned?.(plan);
    // Sin proyecto no hay dónde guardarlo, pero una intención que produce un
    // artefacto lo devuelve igual: es el contrato que siempre tuvo el contexto.
    if (!plan || !snapshot) {
      onSettled?.({ status: 'validation-error', success: false, operationId: `artifact-${Date.now()}`, target: 'memory', message: 'No se encontró el proyecto o la operación de artefacto.' });
      return plan?.produced;
    }
    const previous = snapshot.artifacts;
    const next = plan.change(previous);
    const changedIds = changedArtifactIds(previous, next);
    updateArtifactsOf(projectId, artifacts => markArtifactPersistence(plan.change(artifacts), changedIds, 'pending'));
    setPersistenceStatus('saving');
    setPersistenceMessage(t('uiState.28'));

    const rollback = () => updateArtifactsOf(projectId, () => previous);
    executeArtifactWrite(artifactRepository, projectId, plan.write, user?.uid).then(({ result, confirmedRevisions }) => {
      const confirmed = handleWriteResult(result, 'Artefacto guardado en base de datos.');
      const settlement = settleArtifactWrite({ ...result, success: confirmed }, previous, next);
      if (settlement.kind === 'confirmed') {
        updateArtifactsOf(projectId, artifacts =>
          markArtifactPersistence(withConfirmedRevisions(artifacts, confirmedRevisions), changedIds, 'success'));
        onSettled?.({ ...result, status: 'success', success: true, data: plan.produced });
        return;
      }
      observabilityService.reportError(result.error ?? new Error(result.message), {
        source: 'operation',
        title: 'No se pudieron guardar los artefactos',
        message: settlement.kind === 'keep-generated'
          ? 'El artefacto recién generado se conserva localmente y queda marcado como guardado remoto fallido.'
          : 'Se revirtieron los cambios locales para mantener consistencia con la base de datos.',
        operationName: plan.operation,
        recoverable: true,
        userVisible: true,
        metadata: {
          projectId,
          generatedLocalIds: settlement.kind === 'keep-generated' ? Array.from(settlement.artifactIds).join(',') : '',
          status: result.status,
        },
      });
      if (settlement.kind === 'keep-generated') {
        updateArtifactsOf(projectId, artifacts => markArtifactPersistence(artifacts, settlement.artifactIds, settlement.remote));
        onSettled?.({ ...result, success: false, data: plan.produced });
        return;
      }
      rollback();
      onSettled?.({ ...result, success: false, data: plan.produced });
    }).catch(e => {
      observabilityService.reportError(e, {
        source: 'operation',
        title: 'No se pudieron guardar los artefactos',
        message: 'Se revirtieron los cambios locales para mantener consistencia con la base de datos.',
        operationName: plan.operation,
        recoverable: true,
        userVisible: true,
        metadata: { projectId },
      });
      setPersistenceStatus('error');
      setPersistenceMessage(t('uiState.29'));
      rollback();
      onSettled?.({ status: 'failed', success: false, operationId: `artifact-${Date.now()}`, target: 'supabase', error: e, message: e instanceof Error ? e.message : String(e) });
    });
    return plan.produced;
  }, [getProject, handleWriteResult, setPersistenceMessage, setPersistenceStatus, t, updateArtifactsOf, user]);

  const createArtifact = useCallback((projectId: string, draft: NewArtifactDraft, deterministicId?: string): Artifact => {
    // Crear siempre produce un artefacto: el plan de `create` nunca es `null`.
    return run(projectId, { kind: 'create', draft, deterministicId }) as Artifact;
  }, [run]);

  /** Agent and queue writes wait for the repository's confirmation. */
  const createArtifactConfirmed = useCallback((projectId: string, draft: NewArtifactDraft, deterministicId?: string): Promise<PersistenceResult<Artifact>> =>
    new Promise(resolve => { run(projectId, { kind: 'create', draft, deterministicId }, undefined, resolve); }), [run]);

  const createArtifactVersionConfirmed = useCallback((projectId: string, versionGroupId: string, draft: NewArtifactDraft): Promise<PersistenceResult<Artifact>> =>
    new Promise(resolve => { run(projectId, { kind: 'create-version', versionGroupId, draft }, undefined, resolve); }), [run]);

  const updateArtifactConfirmed = useCallback((projectId: string, artifactId: string, updates: Partial<Artifact>): Promise<PersistenceResult<Artifact>> =>
    new Promise(resolve => { run(projectId, { kind: 'update', artifactId, updates }, undefined, resolve); }), [run]);

  const createArtifactVersion = useCallback((projectId: string, versionGroupId: string, draft: NewArtifactDraft): Artifact => {
    return run(projectId, { kind: 'create-version', versionGroupId, draft }) as Artifact;
  }, [run]);

  const getArtifact = useCallback((projectId: string, artifactId: string) => {
    const project = getProject(projectId);
    return project?.artifacts.find(a => a.id === artifactId);
  }, [getProject]);

  const updateArtifact = useCallback((projectId: string, artifactId: string, updates: Partial<Artifact>) => {
    run(projectId, { kind: 'update', artifactId, updates });
  }, [run]);

  const deleteArtifact = useCallback((projectId: string, artifactId: string) => {
    run(projectId, { kind: 'delete', artifactId });
  }, [run]);

  const getGroupedArtifactsByView = useCallback((projectId: string): GroupedArtifacts => {
    const project = getProject(projectId);
    if (!project || !Array.isArray(project.artifacts)) return {};
    return groupArtifactsByView(project.artifacts);
  }, [getProject]);

  /** Devuelve las versiones que creó, para poder ofrecer deshacer (10.4). */
  const applyConsistencySuggestion = useCallback((projectId: string, suggestion: ConsistencySuggestion): Artifact[] => {
    let produced: readonly Artifact[] = [];
    run(projectId, { kind: 'apply-consistency', suggestion }, plan => { produced = plan.producedAll ?? []; });
    return [...produced];
  }, [run]);

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
    return run(projectId, { kind: 'restore-version', version: versionToRestore }) as Artifact;
  }, [run]);

  const removeCorruptArtifacts = useCallback((projectId: string, corruptArtifactIds: string[]) => {
    run(projectId, { kind: 'remove-corrupt', artifactIds: corruptArtifactIds });
  }, [run]);

  return {
    createArtifact,
    createArtifactConfirmed,
    createArtifactVersion,
    createArtifactVersionConfirmed,
    getArtifact,
    updateArtifact,
    updateArtifactConfirmed,
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
