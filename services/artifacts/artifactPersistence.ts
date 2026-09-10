/**
 * Dónde se escribe un artefacto.
 *
 * Ya no delega. Estaba en `services/firestoreService.ts`, donde compartía
 * fichero con la persistencia de otros seis contextos.
 *
 * ## Por qué este módulo conoce a `architectureProjects` y no al revés
 *
 * Un artefacto es una entidad **dentro** del agregado Proyecto: vive en su
 * subcolección, cuenta para su `artifactCount` y aparece en el `artifactIndex`
 * que las pantallas de portafolio leen. Por eso cada escritura de aquí toca
 * también el documento del proyecto —dentro de la misma transacción, que es lo
 * que impide que el recuento y los artefactos se separen— e invalida su caché
 * con `forgetProject`.
 *
 * La dirección es una sola y a propósito: este módulo importa de
 * `architectureProjects`, y `architectureProjects` no importa de éste.
 *
 * ## Las dos carreras que este fichero absorbe
 *
 * 1. `updateArtifact` reintenta con backoff corto cuando el documento todavía
 *    no es visible para su transacción. El caso real: la UI crea un artefacto y
 *    el render siguiente persiste el `layoutPlan` recién calculado antes de que
 *    la creación haya propagado. Sin el reintento eso sale como un «no se pudo
 *    guardar» genérico para algo que se resuelve solo en menos de dos segundos.
 * 2. Un artefacto es lo más pesado que guarda el producto, así que
 *    `toArtifactDocument` poda campos derivados para caber en 1 MiB — y
 *    `reportArtifactPruning` lo dice, porque una poda silenciosa es una pérdida
 *    de datos que nadie descubre hasta que el diagrama se abre vacío.
 */

import { collection, doc, getDoc, getDocs, runTransaction, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Artifact } from '../../types';
import { sanitizeForFirestore } from '../../lib/firestoreData';
import {
    prepareArtifactUpdateForFirestore,
    type PrunableArtifactField,
} from '../../lib/artifactPersistenceGuards';
import { observabilityService } from '../observability';
import {
    AGGREGATES_COLLECTION,
    ARTIFACT_INDEX_DOC,
    ARTIFACTS_COLLECTION,
    PROJECTS_COLLECTION,
    ensureConfirmed,
    executeRemoteWrite,
    isWriteConfirmed,
    requireDb,
    writeLocalDraft,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import {
    appendToArtifactIndex,
    forgetProject,
    getProject,
    removeFromArtifactIndex,
    reportArtifactPruning,
    toArtifactDocument,
    toArtifactIndexDocument,
} from '../architectureProjects';

/**
 * Cuánto espera `updateArtifact` a que un artefacto recién creado sea visible.
 *
 * Tres reintentos, 1,9 s en el peor caso. Suficiente para cerrar la carrera
 * contra `createArtifact` sin retener la interfaz de forma perceptible cuando
 * el artefacto de verdad no existe.
 */
const ARTIFACT_NOT_FOUND_RETRY_DELAYS_MS = [200, 500, 1200] as const;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const createArtifact = async (projectId: string, artifact: Artifact, options: { userId?: string } = {}): Promise<PersistenceResult<Artifact>> => {
    const updatedAt = new Date().toISOString();
    let pruning: { prunedFields: PrunableArtifactField[]; sizeBytes: number } | null = null;
    const result = await executeRemoteWrite({ operationName: 'createArtifact', userId: options.userId, projectId, artifactId: artifact.id }, async () => {
        // Prepare the persisted form inside the write callback so any
        // `PersistenceValidationError` raised by the guard is classified
        // by `executeRemoteWrite` instead of escaping unhandled.
        const prepared = toArtifactDocument(artifact);
        await runTransaction(requireDb(db), async (transaction) => {
            const projectRef = doc(requireDb(db), PROJECTS_COLLECTION, projectId);
            const artifactRef = doc(requireDb(db), PROJECTS_COLLECTION, projectId, ARTIFACTS_COLLECTION, artifact.id);
            const projectSnap = await transaction.get(projectRef);
            if (!projectSnap.exists()) throw new Error(`Proyecto ${projectId} no existe.`);
            const artifactSnap = await transaction.get(artifactRef);
            // Every read must precede every write in a transaction, so the
            // index is fetched here even though it is written last.
            const indexRef = doc(requireDb(db), PROJECTS_COLLECTION, projectId, AGGREGATES_COLLECTION, ARTIFACT_INDEX_DOC);
            const indexSnap = await transaction.get(indexRef);
            if (artifactSnap.exists()) {
                const error = new Error(`Artefacto ${artifact.id} ya existe.`) as Error & { code: string };
                error.code = 'already-exists';
                throw error;
            }
            transaction.set(artifactRef, prepared.document);
            const currentCount = typeof projectSnap.data().artifactCount === 'number' ? projectSnap.data().artifactCount as number : 0;
            transaction.update(projectRef, { artifactCount: currentCount + 1, lastArtifactUpdatedAt: updatedAt, updatedAt });
            appendToArtifactIndex(transaction, indexRef, indexSnap, artifact, currentCount + 1, updatedAt);
        });
        if (prepared.prunedFields.length > 0) {
            pruning = { prunedFields: prepared.prunedFields, sizeBytes: prepared.sizeBytes };
        }
        return artifact;
    });
    const createPruning = pruning as { prunedFields: PrunableArtifactField[]; sizeBytes: number } | null;
    if (createPruning) {
        reportArtifactPruning({ operationName: 'createArtifact', projectId, artifactId: artifact.id, ...createPruning });
    }
    if (isWriteConfirmed(result)) {
        forgetProject(projectId);
    } else if (result.status === 'offline') {
        writeLocalDraft(`project.${projectId}.artifact.${artifact.id}.create`, artifact);
    }
    return result;
};


export const updateArtifact = async (projectId: string, artifactId: string, updates: Partial<Artifact>, options: { expectedUpdatedAt?: string; userId?: string } = {}): Promise<PersistenceResult<{ updatedAt: string }>> => {
    const updatedAt = new Date().toISOString();
    const sanitizedUpdates = sanitizeForFirestore({ ...updates, updatedAt }) as Record<string, unknown>;
    delete sanitizedUpdates.id;
    let pruning: { prunedFields: PrunableArtifactField[]; sizeBytes: number } | null = null;
    let raceRetryAttempts = 0;
    const result = await executeRemoteWrite({ operationName: 'updateArtifact', userId: options.userId, projectId, artifactId }, async () => {
        // The most common race we have to absorb here is: the caller
        // creates an artifact (createArtifact's transaction is in flight)
        // and the very next render fires `updateArtifact` from
        // `useDiagramRendering` to persist the freshly-computed
        // layoutPlan. `transaction.get(artifactRef)` runs before
        // createArtifact has propagated and reports `!exists()`,
        // bubbling up as the generic "no se pudo guardar" banner.
        // Retry the whole transaction transparently with short
        // exponential backoff before treating the artifact as truly
        // missing — the steady-state cost is zero (single attempt),
        // and the race window collapses in well under two seconds.
        for (let attempt = 0; attempt <= ARTIFACT_NOT_FOUND_RETRY_DELAYS_MS.length; attempt++) {
            try {
                await runTransaction(requireDb(db), async (transaction) => {
                    const projectRef = doc(requireDb(db), PROJECTS_COLLECTION, projectId);
                    const artifactRef = doc(requireDb(db), PROJECTS_COLLECTION, projectId, ARTIFACTS_COLLECTION, artifactId);
                    const artifactSnap = await transaction.get(artifactRef);
                    if (!artifactSnap.exists()) {
                        const error = new Error(`Artefacto ${artifactId} no existe en la base de datos todavía.`) as Error & { code: string };
                        error.code = 'not-found';
                        throw error;
                    }
                    const currentData = artifactSnap.data() as Record<string, unknown>;
                    const remoteUpdatedAt = currentData.updatedAt;
                    if (options.expectedUpdatedAt && typeof remoteUpdatedAt === 'string' && remoteUpdatedAt > options.expectedUpdatedAt) {
                        const error = new Error('Conflicto de concurrencia en artefacto.') as Error & { code: string };
                        error.code = 'aborted';
                        throw error;
                    }
                    // Merge the patch against the existing document,
                    // validate the result against Firestore's
                    // per-document limit, and either apply a cheap
                    // partial update or fall back to a full-document
                    // overwrite when ephemeral fields had to be pruned
                    // (partial updates cannot remove fields from the
                    // remote doc).
                    const prepared = prepareArtifactUpdateForFirestore(currentData, sanitizedUpdates);
                    if (prepared.mode === 'overwrite') {
                        transaction.set(artifactRef, prepared.document);
                    } else {
                        transaction.update(artifactRef, prepared.document as Partial<Artifact>);
                    }
                    transaction.update(projectRef, { lastArtifactUpdatedAt: updatedAt, updatedAt });
                    if (prepared.prunedFields.length > 0) {
                        pruning = { prunedFields: prepared.prunedFields, sizeBytes: prepared.sizeBytes };
                    }
                });
                return { updatedAt };
            } catch (error) {
                const code = (error as { code?: string }).code;
                const canRetry = code === 'not-found' && attempt < ARTIFACT_NOT_FOUND_RETRY_DELAYS_MS.length;
                if (canRetry) {
                    raceRetryAttempts = attempt + 1;
                    await delay(ARTIFACT_NOT_FOUND_RETRY_DELAYS_MS[attempt]);
                    continue;
                }
                if (code === 'not-found') {
                    // Retries exhausted. Surface an actionable Spanish
                    // message via `userMessage` so the UI no longer shows
                    // the generic "No se pudo guardar en la base de
                    // datos" banner for a likely-transient race.
                    const finalError = new Error(`El artefacto ${artifactId} todavía no está disponible en la base de datos. Si acabas de generarlo, espera unos segundos y reintenta; si el problema persiste, recarga la aplicación.`) as Error & { code: string; userMessage: string };
                    finalError.code = 'not-found';
                    finalError.userMessage = finalError.message;
                    throw finalError;
                }
                throw error;
            }
        }
        // Defensive: the for-loop always returns or throws above. This
        // line exists only so TypeScript can verify all paths return.
        throw new Error('updateArtifact agotó el bucle de reintentos sin resolver.');
    });
    if (raceRetryAttempts > 0 && isWriteConfirmed(result)) {
        observabilityService.recordWarning({
            source: 'operation',
            title: 'updateArtifact resolvió tras reintento',
            message: `La escritura aterrizó tras ${raceRetryAttempts} reintento(s) por race contra createArtifact. El usuario no vio error.`,
            operationName: 'updateArtifact',
            userVisible: false,
            recoverable: true,
            metadata: { projectId, artifactId, raceRetryAttempts },
        });
    }
    const updatePruning = pruning as { prunedFields: PrunableArtifactField[]; sizeBytes: number } | null;
    if (updatePruning) {
        reportArtifactPruning({ operationName: 'updateArtifact', projectId, artifactId, ...updatePruning });
    }
    if (isWriteConfirmed(result)) {
        forgetProject(projectId);
    } else if (result.status === 'offline') {
        writeLocalDraft(`project.${projectId}.artifact.${artifactId}.update`, updates);
    }
    return result;
};


export const deleteArtifact = async (projectId: string, artifactId: string, options: { userId?: string } = {}): Promise<PersistenceResult<{ updatedAt: string }>> => {
    const updatedAt = new Date().toISOString();
    const result = await executeRemoteWrite({ operationName: 'deleteArtifact', userId: options.userId, projectId, artifactId }, async () => {
        await runTransaction(requireDb(db), async (transaction) => {
            const projectRef = doc(requireDb(db), PROJECTS_COLLECTION, projectId);
            const artifactRef = doc(requireDb(db), PROJECTS_COLLECTION, projectId, ARTIFACTS_COLLECTION, artifactId);
            const projectSnap = await transaction.get(projectRef);
            const artifactSnap = await transaction.get(artifactRef);
            const indexRef = doc(requireDb(db), PROJECTS_COLLECTION, projectId, AGGREGATES_COLLECTION, ARTIFACT_INDEX_DOC);
            const indexSnap = await transaction.get(indexRef);
            if (!artifactSnap.exists()) return;
            transaction.delete(artifactRef);
            const currentCount = projectSnap.exists() && typeof projectSnap.data().artifactCount === 'number' ? projectSnap.data().artifactCount as number : 1;
            const nextCount = Math.max(0, currentCount - 1);
            transaction.update(projectRef, { artifactCount: nextCount, lastArtifactUpdatedAt: updatedAt, updatedAt });
            removeFromArtifactIndex(transaction, indexRef, indexSnap, artifactId, nextCount, updatedAt);
        });
        return { updatedAt };
    });
    if (isWriteConfirmed(result)) {
        forgetProject(projectId);
    }
    return result;
};


export const updateProjectArtifacts = async (projectId: string, artifacts: Artifact[], options: { expectedUpdatedAt?: string; userId?: string } = {}): Promise<PersistenceResult<{ updatedAt: string }>> => {
    const updatedAt = new Date().toISOString();
    const pruningReports: Array<{ artifactId: string; prunedFields: PrunableArtifactField[]; sizeBytes: number }> = [];
    const result = await executeRemoteWrite({ operationName: 'updateProjectArtifacts', userId: options.userId, projectId }, async () => {
        const projectRef = doc(requireDb(db), PROJECTS_COLLECTION, projectId);
        if (options.expectedUpdatedAt) {
            const remote = await getDoc(projectRef);
            const remoteUpdatedAt = remote.exists() ? remote.data().updatedAt : undefined;
            if (typeof remoteUpdatedAt === 'string' && remoteUpdatedAt > options.expectedUpdatedAt) {
                const error = new Error('Conflicto de concurrencia en artefactos.') as Error & { code: string };
                error.code = 'aborted';
                throw error;
            }
        }
        const batch = writeBatch(requireDb(db));
        const existingSnapshot = await getDocs(collection(requireDb(db), PROJECTS_COLLECTION, projectId, ARTIFACTS_COLLECTION));
        const nextIds = new Set(artifacts.map((artifact) => artifact.id));
        existingSnapshot.docs.forEach((artifactDoc) => {
            if (!nextIds.has(artifactDoc.id)) batch.delete(artifactDoc.ref);
        });
        // Reset pruningReports inside the write callback so retries do not
        // inherit stale entries from earlier (failed) attempts.
        pruningReports.length = 0;
        artifacts.forEach((artifact) => {
            const prepared = toArtifactDocument(artifact);
            batch.set(doc(requireDb(db), PROJECTS_COLLECTION, projectId, ARTIFACTS_COLLECTION, artifact.id), prepared.document);
            if (prepared.prunedFields.length > 0) {
                pruningReports.push({ artifactId: artifact.id, prunedFields: prepared.prunedFields, sizeBytes: prepared.sizeBytes });
            }
        });
        batch.set(
            doc(requireDb(db), PROJECTS_COLLECTION, projectId, AGGREGATES_COLLECTION, ARTIFACT_INDEX_DOC),
            toArtifactIndexDocument(artifacts, updatedAt),
        );
        batch.update(projectRef, { artifactCount: artifacts.length, lastArtifactUpdatedAt: updatedAt, updatedAt, artifactStorage: 'subcollection-v1' });
        await batch.commit();
        return { updatedAt };
    });
    for (const report of pruningReports) {
        reportArtifactPruning({ operationName: 'updateProjectArtifacts', projectId, ...report });
    }
    if (isWriteConfirmed(result)) {
        forgetProject(projectId);
    } else if (result.status === 'offline') {
        writeLocalDraft(`project.${projectId}.artifacts`, artifacts);
    }
    return result;
};


export const batchUpdateArtifacts = async (projectId: string, operations: Array<{ type: 'add' | 'update' | 'delete'; artifact: Artifact }>): Promise<Artifact[]> => {
    const project = await getProject(projectId);
    if (!project) return [];
    let artifacts = [...project.artifacts];
    for (const op of operations) {
        switch (op.type) {
            case 'add':
                artifacts.push(op.artifact);
                break;
            case 'update':
                artifacts = artifacts.map(a => a.id === op.artifact.id ? { ...a, ...op.artifact } : a);
                break;
            case 'delete':
                artifacts = artifacts.filter(a => a.id !== op.artifact.id);
                break;
        }
    }
    ensureConfirmed(await updateProjectArtifacts(projectId, artifacts));
    return artifacts;
};


export const restoreArtifactVersion = async (projectId: string, versionToRestore: Artifact): Promise<PersistenceResult<Artifact>> => {
    return createArtifact(projectId, versionToRestore);
};
