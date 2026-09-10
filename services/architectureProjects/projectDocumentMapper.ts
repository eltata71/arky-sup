/**
 * Cómo un `Project` se convierte en documentos de Firestore y vuelve.
 *
 * Todo esto estaba en `services/firestoreService.ts`. Es mapeo, no reglas de
 * negocio, pero es mapeo **de este agregado**: sabe qué campos viajan dentro
 * del documento del proyecto, cuáles se han sacado a `aggregates/` porque no
 * caben, y cómo se mantiene el índice de artefactos que las pantallas de
 * portafolio leen en vez de cargar los artefactos enteros.
 *
 * `services/artifacts` importa de aquí los ayudantes del índice, y no al revés:
 * un artefacto es una entidad **dentro** del agregado Proyecto —vive en su
 * subcolección, cuenta para su `artifactCount` y aparece en su índice—, así que
 * el vocabulario del índice (`ArtifactSummary`) es de este contexto y ya se
 * declaraba en `ArchitectureProjectTypes.ts`.
 */

import type { DocumentData, DocumentReference, DocumentSnapshot, Transaction } from 'firebase/firestore';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db as firestore } from '../../firebase';
import type { Artifact, Project } from '../../types';
import { sanitizeForFirestore } from '../../lib/firestoreData';
import { sanitizeMemoryEntryList } from '../memory/memoryEntries';
import { normalizeBusinessProjectIds } from '../architectureOffice/officeShared';
import { normalizeAttentionTracking } from './projectRuntimeValidation';
import {
  AGGREGATES_COLLECTION,
  ARCHITECTURE_GRAPH_DOC,
  PROJECTS_COLLECTION,
  PUBLICATIONS_COLLECTION,
  requireDb,
} from '../persistence';
import type { ArchitectureGraph } from '../architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes';
import type { PublicationPackage } from '../publicationPipeline/PublicationPipelineTypes';
import type { ArtifactSummary } from './ArchitectureProjectTypes';

export const toProjectDocument = (project: Project & { userId?: string }): Record<string, unknown> => sanitizeForFirestore({
    id: project.id,
    name: project.name,
    description: project.description,
    projectContext: project.projectContext ?? [],
    initiativeIds: Array.isArray(project.initiativeIds)
        ? [...new Set(project.initiativeIds.filter((item): item is string => typeof item === 'string'))]
        : [],
    linkedBusinessProjects: normalizeBusinessProjectIds(project.linkedBusinessProjects),
    agentMemory: project.agentMemory ?? [],
    initialCapture: project.initialCapture ?? [],
    // Structured memory metadata (fecha, autor, prioridad) for each scope.
    // `sanitizeForFirestore` drops them cleanly when absent (legacy).
    projectContextEntries: project.projectContextEntries,
    agentMemoryEntries: project.agentMemoryEntries,
    initialCaptureEntries: project.initialCaptureEntries,
    // `architectureKnowledgeGraph` and `publicationPackages` are deliberately
    // absent: they live in their own documents now. See AGGREGATES_COLLECTION.
    // Attention tracking, on the other hand, was absent by mistake — a project
    // created with `attention` set lost it silently, because only the
    // `updateProject` path (which sanitizes the raw patch) ever persisted it.
    attention: project.attention,
    userId: project.userId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    artifactCount: project.artifacts?.length ?? 0,
    lastArtifactUpdatedAt: project.artifacts?.length ? project.updatedAt : undefined,
    artifactStorage: 'subcollection-v1',
    aggregateStorage: 'split-v1',
});

export interface ProjectAggregates {
    architectureKnowledgeGraph?: ArchitectureGraph;
    publicationPackages?: PublicationPackage[];
    /** False on the portfolio path, where only the index was read. */
    artifactsLoaded?: boolean;
    artifactIndex?: ArtifactSummary[];
}

export const fromProjectSnapshot = (
    id: string,
    data: DocumentData,
    artifacts: Artifact[],
    aggregates: ProjectAggregates = {},
): Project => ({
    id,
    name: typeof data.name === 'string' ? data.name : 'Proyecto sin nombre',
    description: typeof data.description === 'string' ? data.description : '',
    projectContext: Array.isArray(data.projectContext) ? data.projectContext.filter((item: unknown): item is string => typeof item === 'string') : [],
    initiativeIds: Array.isArray(data.initiativeIds)
        ? [...new Set(data.initiativeIds.filter((item: unknown): item is string => typeof item === 'string'))]
        : [],
    linkedBusinessProjects: normalizeBusinessProjectIds(data.linkedBusinessProjects),
    attention: normalizeAttentionTracking(data.attention),
    agentMemory: Array.isArray(data.agentMemory) ? data.agentMemory.filter((item: unknown): item is string => typeof item === 'string') : [],
    initialCapture: Array.isArray(data.initialCapture) ? data.initialCapture.filter((item: unknown): item is string => typeof item === 'string') : [],
    projectContextEntries: Array.isArray(data.projectContextEntries) ? sanitizeMemoryEntryList(data.projectContextEntries) : undefined,
    agentMemoryEntries: Array.isArray(data.agentMemoryEntries) ? sanitizeMemoryEntryList(data.agentMemoryEntries) : undefined,
    initialCaptureEntries: Array.isArray(data.initialCaptureEntries) ? sanitizeMemoryEntryList(data.initialCaptureEntries) : undefined,
    // Resolved by `readProjectAggregates`, which reads the split documents and
    // falls back to the legacy inline fields.
    architectureKnowledgeGraph: aggregates.architectureKnowledgeGraph,
    publicationPackages: aggregates.publicationPackages,
    artifacts,
    // Load state travels with the record so no screen can mistake "not loaded
    // yet" for "there are none".
    artifactsLoaded: aggregates.artifactsLoaded ?? true,
    artifactIndex: aggregates.artifactIndex,
    artifactCount: typeof data.artifactCount === 'number' ? data.artifactCount : artifacts.length,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
});

/**
 * Stage the split aggregate writes onto an existing batch.
 *
 * Reconciling rather than overwriting: a package removed from the array must
 * have its document deleted, or it comes back on the next read. That is the
 * same read-existing/delete-missing/set-rest shape `updateProjectArtifacts`
 * already uses, and for the same reason — a collection cannot be replaced the
 * way a field can.
 *
 * The graph is a single document because a project has exactly one. It is
 * still unbounded in itself: it grows with the artifact count and rebuilds on
 * every artifact change. Moving it here stops it consuming the project's
 * budget and makes an over-budget graph nameable, but bounding the graph
 * itself (an entity per document) is a further step.
 */
/** Identity of one artifact, without its body. */
export const toArtifactSummary = (artifact: Artifact): ArtifactSummary => sanitizeForFirestore({
    id: artifact.id,
    name: artifact.name,
    type: artifact.type,
    versionGroupId: artifact.versionGroupId,
    version: artifact.version,
    architecturalView: artifact.architecturalView,
    phase: artifact.phase,
    createdAt: artifact.createdAt,
    updatedAt: (artifact as Artifact & { updatedAt?: string }).updatedAt,
}) as ArtifactSummary;

/** The persisted index document: the summaries plus the count they describe. */
export const toArtifactIndexDocument = (artifacts: Artifact[], updatedAt: string): Record<string, unknown> => ({
    summaries: artifacts.map(toArtifactSummary),
    count: artifacts.length,
    updatedAt,
});

/**
 * Read the index only if it still describes the project's current artifacts.
 *
 * `count` is the whole safety mechanism: an index written before an artifact
 * was added or removed disagrees with `artifactCount`, and is discarded rather
 * than shown. That is what lets the single-artifact write paths update it
 * best-effort without any risk of a portfolio screen reporting a stale figure.
 */
export const readTrustedArtifactIndex = (
    indexData: DocumentData | undefined,
    artifactCount: unknown,
): ArtifactSummary[] | undefined => {
    if (!indexData || !Array.isArray(indexData.summaries)) return undefined;
    if (typeof artifactCount !== 'number') return undefined;
    if (indexData.count !== artifactCount) return undefined;
    if (indexData.summaries.length !== artifactCount) return undefined;
    return indexData.summaries as ArtifactSummary[];
};

export type IndexTransaction = Pick<Transaction, 'set'>;
export type IndexSnapshot = Pick<DocumentSnapshot<DocumentData>, 'exists' | 'data'>;

/**
 * Existing summaries, or `null` when there is nothing usable to extend.
 *
 * A single-artifact write can only *amend* an index; it cannot invent one,
 * because it does not know the other artifacts. When none exists the write
 * leaves it absent, and the reader falls back to loading the artifacts until
 * a full-set write (`updateProjectArtifacts`) rebuilds it.
 */
export const existingSummaries = (snapshot: IndexSnapshot): ArtifactSummary[] | null => {
    if (!snapshot?.exists?.()) return null;
    const data = snapshot.data();
    return Array.isArray(data?.summaries) ? (data.summaries as ArtifactSummary[]) : null;
};

/** Add or replace one artifact's entry, keeping `count` in step. */
export const appendToArtifactIndex = (
    transaction: IndexTransaction,
    indexRef: DocumentReference<DocumentData>,
    indexSnap: IndexSnapshot,
    artifact: Artifact,
    nextCount: number,
    updatedAt: string,
): void => {
    const summaries = existingSummaries(indexSnap);
    if (!summaries) return;
    const next = [...summaries.filter((entry) => entry.id !== artifact.id), toArtifactSummary(artifact)];
    transaction.set(indexRef, { summaries: next, count: nextCount, updatedAt });
};

/** Drop one artifact's entry, keeping `count` in step. */
export const removeFromArtifactIndex = (
    transaction: IndexTransaction,
    indexRef: DocumentReference<DocumentData>,
    indexSnap: IndexSnapshot,
    artifactId: string,
    nextCount: number,
    updatedAt: string,
): void => {
    const summaries = existingSummaries(indexSnap);
    if (!summaries) return;
    transaction.set(indexRef, {
        summaries: summaries.filter((entry) => entry.id !== artifactId),
        count: nextCount,
        updatedAt,
    });
};

export const writeProjectAggregates = async (
    batch: ReturnType<typeof writeBatch>,
    projectId: string,
    aggregates: ProjectAggregates,
): Promise<void> => {
    if (aggregates.architectureKnowledgeGraph !== undefined) {
        const graphRef = doc(requireDb(firestore), PROJECTS_COLLECTION, projectId, AGGREGATES_COLLECTION, ARCHITECTURE_GRAPH_DOC);
        batch.set(graphRef, sanitizeForFirestore({
            graph: aggregates.architectureKnowledgeGraph,
            updatedAt: new Date().toISOString(),
        }));
    }

    if (aggregates.publicationPackages !== undefined) {
        const packages = aggregates.publicationPackages;
        const nextIds = new Set(packages.map((item) => item.id));
        const existing = await getDocs(collection(requireDb(firestore), PROJECTS_COLLECTION, projectId, PUBLICATIONS_COLLECTION));
        for (const snap of existing.docs) {
            if (!nextIds.has(snap.id)) batch.delete(snap.ref);
        }
        for (const item of packages) {
            batch.set(
                doc(requireDb(firestore), PROJECTS_COLLECTION, projectId, PUBLICATIONS_COLLECTION, item.id),
                sanitizeForFirestore({ package: item, updatedAt: new Date().toISOString() }),
            );
        }
    }
};

/**
 * Budget for the single chat-history document, well under the project one so a
 * long conversation still has room for the marker and the tail it keeps.
 */
