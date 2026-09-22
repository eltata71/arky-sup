/**
 * Qué significa cada cosa que un usuario hace con un artefacto (F4-05).
 *
 * `useArtifactsState` decidía, entre dos `setState`, cinco reglas del dominio:
 * qué versión sigue a cuál, qué se recompila antes de guardar, qué escritura
 * lleva cada intención, qué revisión se compara, y —la menos obvia— qué se
 * revierte cuando la base de datos no confirma. Ninguna se podía comprobar sin
 * renderizar un proveedor, y la última es exactamente la que un cambio
 * «pequeño» en un hook rompe sin que nada lo note.
 *
 * Este fichero las declara sin React, en dos pasos que el hook no puede
 * reordenar:
 *
 *  1. **`planArtifactIntent`** — puro. De la lista vigente y una intención
 *     saca el cambio a aplicar (una función, porque el hook la aplica dos
 *     veces: sobre la instantánea y dentro del actualizador de estado, que es
 *     la corrección de F4-03), la escritura que la representa y el artefacto
 *     que el llamante recibe.
 *  2. **`settleArtifactWrite`** — puro. Del resultado de la escritura decide
 *     confirmar, conservar lo generado marcado como no guardado, o revertir.
 *
 * Lo único con efectos es `executeArtifactWrite`, que traduce la escritura a
 * **un** comando del repositorio (ADR-106). Recibe el repositorio: no hay E/S
 * escondida detrás de una importación.
 */

import type { ConsistencySuggestion } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { PersistenceResult } from '../../persistence';
import { recompileArtifactBeforePersist } from '../../artifactCompiler';
import {
  createArtifact as createArtifactAggregate,
  createArtifactVersion as createArtifactVersionAggregate,
  reviseArtifact,
  type NewArtifactDraft,
} from '../artifactFactory';
import type { ArtifactRepository, ArtifactRevisionChange } from '../ArtifactRepository';

// ─────────────────────────────────────────────────────────── intenciones

export type ArtifactIntent =
  | { readonly kind: 'create'; readonly draft: NewArtifactDraft; readonly deterministicId?: string }
  | { readonly kind: 'create-version'; readonly versionGroupId: string; readonly draft: NewArtifactDraft }
  | { readonly kind: 'update'; readonly artifactId: string; readonly updates: Partial<Artifact> }
  | { readonly kind: 'delete'; readonly artifactId: string }
  | { readonly kind: 'apply-consistency'; readonly suggestion: ConsistencySuggestion }
  | { readonly kind: 'restore-version'; readonly version: Artifact }
  | { readonly kind: 'remove-corrupt'; readonly artifactIds: readonly string[] };

/** Lo que viaja al servidor: un comando, nunca la lista del proyecto (ADR-106). */
export type ArtifactWrite =
  | { readonly kind: 'create'; readonly artifact: Artifact }
  | { readonly kind: 'create-version'; readonly artifact: Artifact }
  | {
      readonly kind: 'update';
      readonly artifactId: string;
      readonly updates: Partial<Artifact>;
      readonly expectedRevision: number | undefined;
    }
  | { readonly kind: 'delete'; readonly artifactId: string; readonly expectedRevision: number | undefined }
  | { readonly kind: 'revise'; readonly changes: readonly ArtifactRevisionChange[] }
  | { readonly kind: 'remove-many'; readonly artifacts: readonly Pick<Artifact, 'id' | 'revision'>[] };

export interface ArtifactPlan {
  /** Nombre de la operación, para observabilidad. */
  readonly operation: string;
  /**
   * El cambio sobre la lista de artefactos. Una función, no una lista: el hook
   * la aplica a la instantánea para saber qué escribir y otra vez dentro del
   * actualizador de estado, que puede ver una lista más nueva.
   */
  readonly change: (artifacts: Artifact[]) => Artifact[];
  readonly write: ArtifactWrite;
  /** El artefacto que la intención produjo, cuando produjo uno. */
  readonly produced?: Artifact;
}

const OPERATION: Record<ArtifactIntent['kind'], string> = {
  create: 'createArtifact',
  'create-version': 'createArtifactVersion',
  update: 'updateArtifact',
  delete: 'deleteArtifact',
  'apply-consistency': 'applyConsistencySuggestion',
  'restore-version': 'restoreArtifactVersion',
  'remove-corrupt': 'removeCorruptArtifacts',
};

const latestVersionOf = (artifacts: readonly Artifact[], versionGroupId: string): number =>
  artifacts
    .filter((artifact) => artifact.versionGroupId === versionGroupId)
    .reduce((latest, artifact) => Math.max(latest, artifact.version), 0);

/**
 * Traduce una intención a su cambio y su escritura.
 *
 * Devuelve `null` cuando no hay nada que hacer —el artefacto no existe, la
 * sugerencia no cambia ninguno—, y el hook entonces no toca el estado ni llama
 * al servidor. Una escritura vacía que se confirma es un «guardado» que no
 * guardó nada, y eso se lee en pantalla como éxito.
 */
export const planArtifactIntent = (
  artifacts: readonly Artifact[],
  intent: ArtifactIntent,
): ArtifactPlan | null => {
  const operation = OPERATION[intent.kind];
  switch (intent.kind) {
    case 'create': {
      // La identidad, el versionado y el resumen de compilación los decide el
      // agregado. `deterministicId` llega de la Oficina: reanudar un intento de
      // tarea debe reencontrar el artefacto, no crear un segundo.
      const artifact = createArtifactAggregate(
        intent.draft,
        intent.deterministicId ? { id: intent.deterministicId } : undefined,
      );
      return { operation, change: (list) => [...list, artifact], write: { kind: 'create', artifact }, produced: artifact };
    }
    case 'create-version': {
      const artifact = createArtifactVersionAggregate(intent.versionGroupId, intent.draft, [...artifacts]);
      return { operation, change: (list) => [...list, artifact], write: { kind: 'create-version', artifact }, produced: artifact };
    }
    case 'update': {
      const current = artifacts.find((artifact) => artifact.id === intent.artifactId);
      if (!current) return null;
      // Recompilación centralizada en modo `safe`: mantiene `compilation`
      // sincronizada con el contenido real en la edición manual. La vía rápida
      // de la recompilación no hace nada si no cambió un campo que la afecte
      // (favorito, revisión).
      const outcome = recompileArtifactBeforePersist({ ...current, ...intent.updates }, { source: 'manual' });
      // Viaja sólo el parcial, más la compilación nueva cuando la hubo: un
      // artefacto guardado nunca conserva una compilación de otro texto.
      const updates: Partial<Artifact> = outcome.recompiled
        ? { ...intent.updates, compilation: outcome.artifact.compilation }
        : intent.updates;
      return {
        operation,
        change: (list) => list.map((artifact) => (artifact.id === intent.artifactId ? { ...artifact, ...updates } : artifact)),
        // La revisión contra la que se hizo la edición: el servidor la compara,
        // así que una edición sobre una copia vieja se rechaza en vez de pisar.
        write: { kind: 'update', artifactId: intent.artifactId, updates, expectedRevision: current.revision },
      };
    }
    case 'delete': {
      const current = artifacts.find((artifact) => artifact.id === intent.artifactId);
      if (!current) return null;
      return {
        operation,
        change: (list) => list.filter((artifact) => artifact.id !== intent.artifactId),
        write: { kind: 'delete', artifactId: intent.artifactId, expectedRevision: current.revision },
      };
    }
    case 'apply-consistency': {
      const working = [...artifacts];
      const versions: Artifact[] = [];
      for (const change of intent.suggestion.changes) {
        const target = working.find((artifact) => artifact.id === change.artifactId);
        if (!target) continue;
        const latest = working
          .filter((artifact) => artifact.versionGroupId === target.versionGroupId)
          .sort((left, right) => right.version - left.version)[0];
        // Una sugerencia de consistencia reemplaza el contenido, así que se
        // recompila: heredar la compilación anterior haría que el artefacto
        // dijera estar puntuado sobre un texto que ya no tiene.
        const version = reviseArtifact(latest, latest.version, { content: change.newContent });
        working.push(version);
        versions.push(version);
      }
      if (versions.length === 0) return null;
      return {
        operation,
        change: (list) => [...list, ...versions],
        // Una intención, una transacción: todas las versiones o ninguna
        // (ADR-106 §4), así que una corrección nunca queda a medias.
        write: { kind: 'revise', changes: versions.map((artifact) => ({ op: 'create-version' as const, artifact })) },
      };
    }
    case 'restore-version': {
      // Restaurar clona un artefacto cuyo contenido puede diferir del que se
      // puntuó; `reviseArtifact` recompila por eso.
      const artifact = reviseArtifact(intent.version, latestVersionOf(artifacts, intent.version.versionGroupId));
      return { operation, change: (list) => [...list, artifact], write: { kind: 'create-version', artifact }, produced: artifact };
    }
    case 'remove-corrupt': {
      const ids = new Set(intent.artifactIds);
      const removed = artifacts.filter((artifact) => ids.has(artifact.id));
      if (removed.length === 0) return null;
      return {
        operation,
        change: (list) => list.filter((artifact) => !ids.has(artifact.id)),
        write: { kind: 'remove-many', artifacts: removed },
      };
    }
  }
};

// ───────────────────────────────────────────────────────── la escritura

export interface ArtifactWriteOutcome {
  readonly result: PersistenceResult<unknown>;
  /**
   * Las revisiones que la base confirmó, por artefacto. El siguiente comando
   * sobre ese artefacto las compara, así que viajan con él en el estado —nunca
   * en un mapa de módulo, que es el defecto (H10) que F2-10 retiró.
   */
  readonly confirmedRevisions: readonly Pick<Artifact, 'id' | 'revision'>[];
}

/** Un comando del repositorio por escritura. Nada de «reemplazar todos». */
export const executeArtifactWrite = async (
  repository: ArtifactRepository,
  projectId: string,
  write: ArtifactWrite,
  userId: string | undefined,
): Promise<ArtifactWriteOutcome> => {
  const revisionsOf = <T,>(result: PersistenceResult<T>, pick: (data: T) => readonly Pick<Artifact, 'id' | 'revision'>[]) =>
    (result.success && result.data !== undefined ? pick(result.data) : []);
  switch (write.kind) {
    case 'create': {
      const result = await repository.create(projectId, write.artifact, userId);
      return { result, confirmedRevisions: revisionsOf(result, (saved) => [saved]) };
    }
    case 'create-version': {
      const result = await repository.createVersion(projectId, write.artifact, userId);
      return { result, confirmedRevisions: revisionsOf(result, (saved) => [saved]) };
    }
    case 'update': {
      const result = await repository.update(projectId, write.artifactId, write.updates, {
        userId,
        expectedRevision: write.expectedRevision,
      });
      return { result, confirmedRevisions: revisionsOf(result, (saved) => [{ id: write.artifactId, revision: saved.revision }]) };
    }
    case 'delete': {
      const result = await repository.remove(projectId, write.artifactId, { userId, expectedRevision: write.expectedRevision });
      return { result, confirmedRevisions: [] };
    }
    case 'revise': {
      const result = await repository.revise(projectId, write.changes, userId);
      return { result, confirmedRevisions: revisionsOf(result, (saved) => saved) };
    }
    case 'remove-many': {
      const result = await repository.removeMany(projectId, write.artifacts, userId);
      return { result, confirmedRevisions: [] };
    }
  }
};

// ─────────────────────────────────────────── qué pasa si no se confirma

export type ArtifactRemoteState = 'pending' | 'success' | 'failed' | 'conflict';

export type ArtifactSettlement =
  | { readonly kind: 'confirmed' }
  /**
   * Un artefacto recién **generado** se queda en pantalla, marcado como no
   * guardado. Descartar una generación que el usuario esperó un minuto porque
   * la escritura no llegó pierde un trabajo que reintentar no recupera; una
   * edición, en cambio, se puede volver a hacer.
   */
  | { readonly kind: 'keep-generated'; readonly artifactIds: ReadonlySet<string>; readonly remote: 'failed' | 'conflict' }
  /** Todo lo demás se revierte: la pantalla no puede mostrar lo que la base no tiene. */
  | { readonly kind: 'rollback' };

/** Los artefactos que el cambio tocó: nuevos, o sustituidos por otro objeto. */
export const changedArtifactIds = (previous: readonly Artifact[], next: readonly Artifact[]): Set<string> =>
  new Set(next
    .filter((candidate) => !previous.some((before) => before.id === candidate.id && before === candidate))
    .map((artifact) => artifact.id));

export const settleArtifactWrite = (
  result: Pick<PersistenceResult<unknown>, 'success' | 'status'>,
  previous: readonly Artifact[],
  next: readonly Artifact[],
): ArtifactSettlement => {
  if (result.success) return { kind: 'confirmed' };
  const generated = new Set(next
    .filter((artifact) => artifact.generationTrace && !previous.some((before) => before.id === artifact.id))
    .map((artifact) => artifact.id));
  if (generated.size > 0) {
    return { kind: 'keep-generated', artifactIds: generated, remote: result.status === 'conflict' ? 'conflict' : 'failed' };
  }
  return { kind: 'rollback' };
};

/**
 * Marca en la traza de generación dónde está cada artefacto: pendiente, en la
 * base, o fallido y recuperable. Sólo los que tienen traza: un artefacto
 * escrito a mano no tiene ciclo de vida de generación que informar.
 */
export const markArtifactPersistence = (
  artifacts: readonly Artifact[],
  artifactIds: ReadonlySet<string>,
  remote: ArtifactRemoteState,
): Artifact[] => artifacts.map((artifact) => {
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
});

/** Superpone las revisiones confirmadas sobre los artefactos que las recibieron. */
export const withConfirmedRevisions = (
  artifacts: readonly Artifact[],
  confirmed: readonly Pick<Artifact, 'id' | 'revision'>[],
): Artifact[] => {
  const byId = new Map(confirmed
    .filter((entry) => typeof entry.revision === 'number')
    .map((entry) => [entry.id, entry.revision as number]));
  if (byId.size === 0) return [...artifacts];
  return artifacts.map((artifact) => (byId.has(artifact.id) ? { ...artifact, revision: byId.get(artifact.id) } : artifact));
};
