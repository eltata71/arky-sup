/**
 * Cómo se escribe un Proyecto de Arquitectura.
 *
 * Ya no delega. Hasta la Ola 2 este fichero eran seis líneas que llamaban a
 * `services/firestoreService.ts`, donde vivía la persistencia de siete
 * contextos a la vez.
 *
 * ## Qué entra y qué sale de este agregado
 *
 * Un artefacto es una entidad **dentro** del agregado Proyecto: vive en su
 * subcolección, cuenta para su `artifactCount` y aparece en su índice. Por eso
 * la *lectura* de artefactos está aquí —abrir un proyecto los trae— mientras
 * que la *escritura* de un artefacto concreto es de `services/artifacts`, que
 * importa de aquí los ayudantes del índice y la invalidación de esta caché.
 * La dirección es una sola: artefactos conoce proyectos, proyectos no conoce
 * artefactos.
 *
 * El grafo de arquitectura y los paquetes de publicación son agregados
 * secundarios en documentos aparte (`aggregates/`, `publications/`), porque
 * dentro del documento de proyecto se comían su presupuesto de 1 MiB.
 *
 * ## Dos cosas que no se pueden perder al leer esto
 *
 * - **La lista de portafolio no carga artefactos.** Lee `artifactIndex`, un
 *   documento pequeño por proyecto, y sólo cae a la subcolección cuando el
 *   índice no existe o no cuadra con `artifactCount`. Cargarlo todo era lo más
 *   caro que hacía la aplicación al abrirse.
 * - **Un fallo de lectura degrada a lo último que se vio**, nunca a un
 *   proyecto vacío: un proyecto vacío se parece demasiado a un proyecto sin
 *   trabajo.
 */

import { collection, doc, getDocs, runTransaction, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Project } from '../../types';
import { assertProjectDocumentFits, type PrunableArtifactField } from '../../lib/artifactPersistenceGuards';
import { sanitizeForFirestore } from '../../lib/firestoreData';
/**
 * The file, not the `services/chat` barrel — and this is the barrel-vs-bundle
 * rule from CLAUDE.md, not a style preference.
 *
 * This module is on the boot path: `AppContext` → `useProjectsState` →
 * `ArchitectureProjectRepository` → here. Entering `services/chat` through its
 * `index.ts` pulls `chatCompactor`, which value-imports `aiGateway` from the
 * `services/ai` barrel, which re-exports `generation`, which reaches
 * `services/geminiService` — so the entire AI layer and the 5 400-line engine
 * were downloaded before the login screen rendered, to obtain one repository
 * object that talks to Firestore.
 *
 * `ChatHistoryRepository` is a leaf: Firestore, observability, persistence and
 * the history cap. Nothing that speaks to a model.
 */
import { chatHistoryRepository } from '../chat/ChatHistoryRepository';
import {
    AGGREGATES_COLLECTION,
    ARTIFACT_INDEX_DOC,
    ARTIFACTS_COLLECTION,
    CHAT_DOC,
    HISTORY_COLLECTION,
    PROJECTS_COLLECTION,
    executeRemoteWrite,
    isWriteConfirmed,
    requireDb,
    writeLocalDraft,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import {
    toArtifactIndexDocument,
    toProjectDocument,
    writeProjectAggregates,
    type ProjectAggregates,
} from './projectDocumentMapper';
import { reportArtifactPruning, toArtifactDocument } from './artifactDocumentMapper';
import { forgetProject } from './projectCache';

export const createProject = async (project: Project & { userId?: string }): Promise<PersistenceResult> => {
    if (!project.userId) {
        return {
            status: 'validation-error',
            success: false,
            operationId: `createProject-${Date.now()}`,
            target: 'firestore',
            errorCode: 'project/missing-user-id',
            message: 'No se puede crear un proyecto persistente sin userId autenticado.',
        };
    }

    const pruningReports: Array<{ artifactId: string; prunedFields: PrunableArtifactField[]; sizeBytes: number }> = [];
    const result = await executeRemoteWrite({ operationName: 'createProject', userId: project.userId, projectId: project.id }, async () => {
        const batch = writeBatch(requireDb(db));
        const projectRef = doc(requireDb(db), PROJECTS_COLLECTION, project.id);
        const projectDocument = toProjectDocument(project);
        // Throws an actionable `PersistenceValidationError` naming the
        // oversized field, instead of an opaque Firestore rejection.
        assertProjectDocumentFits(projectDocument, project.id);
        batch.set(projectRef, projectDocument);
        batch.set(
            doc(requireDb(db), PROJECTS_COLLECTION, project.id, AGGREGATES_COLLECTION, ARTIFACT_INDEX_DOC),
            toArtifactIndexDocument(project.artifacts ?? [], project.updatedAt),
        );
        await writeProjectAggregates(batch, project.id, {
            architectureKnowledgeGraph: project.architectureKnowledgeGraph,
            publicationPackages: project.publicationPackages,
        });
        for (const artifact of project.artifacts ?? []) {
            const prepared = toArtifactDocument(artifact);
            batch.set(doc(requireDb(db), PROJECTS_COLLECTION, project.id, ARTIFACTS_COLLECTION, artifact.id), prepared.document);
            if (prepared.prunedFields.length > 0) {
                pruningReports.push({ artifactId: artifact.id, prunedFields: prepared.prunedFields, sizeBytes: prepared.sizeBytes });
            }
        }
        await batch.commit();
    });
    for (const report of pruningReports) {
        reportArtifactPruning({ operationName: 'createProject', projectId: project.id, ...report });
    }
    if (isWriteConfirmed(result)) forgetProject(project.id);
    else if (result.status === 'offline') writeLocalDraft(`project.${project.id}`, project);
    return result;
};


export const updateProject = async (projectId: string, updates: Partial<Project>, options: { userId?: string; expectedUpdatedAt?: string } = {}): Promise<PersistenceResult<{ updatedAt: string }>> => {
    const updatedAt = typeof updates.updatedAt === 'string' ? updates.updatedAt : new Date().toISOString();
    const sanitizedUpdates = sanitizeForFirestore({ ...updates, updatedAt }) as Record<string, unknown>;
    delete sanitizedUpdates.id;
    delete sanitizedUpdates.artifacts;
    // The aggregates never travel on the project document. Removing them
    // here rather than at the call sites means an existing caller that
    // still passes them keeps working — the value is persisted, just to
    // the right place.
    delete sanitizedUpdates.architectureKnowledgeGraph;
    delete sanitizedUpdates.publicationPackages;
    const aggregateUpdates: ProjectAggregates = {};
    if (updates.architectureKnowledgeGraph !== undefined) {
        aggregateUpdates.architectureKnowledgeGraph = updates.architectureKnowledgeGraph;
    }
    if (updates.publicationPackages !== undefined) {
        aggregateUpdates.publicationPackages = updates.publicationPackages;
    }
    const hasAggregateUpdates = Object.keys(aggregateUpdates).length > 0;

    const result = await executeRemoteWrite({ operationName: 'updateProject', userId: options.userId, projectId }, async () => {
        await runTransaction(requireDb(db), async (transaction) => {
            const projectRef = doc(requireDb(db), PROJECTS_COLLECTION, projectId);
            const remote = await transaction.get(projectRef);
            if (!remote.exists()) throw new Error(`Proyecto ${projectId} no existe.`);
            const data = remote.data();
            const remoteOwner = typeof data.userId === 'string' ? data.userId : undefined;
            if (options.userId && remoteOwner && remoteOwner !== options.userId) {
                const error = new Error('El proyecto pertenece a otro usuario.') as Error & { code: string };
                error.code = 'permission-denied';
                throw error;
            }
            const remoteUpdatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : undefined;
            if (options.expectedUpdatedAt && remoteUpdatedAt && remoteUpdatedAt > options.expectedUpdatedAt) {
                const error = new Error('Conflicto de concurrencia en proyecto.') as Error & { code: string; remoteUpdatedAt?: string };
                error.code = 'aborted';
                error.remoteUpdatedAt = remoteUpdatedAt;
                throw error;
            }
            assertProjectDocumentFits({ ...data, ...sanitizedUpdates }, projectId);
            transaction.update(projectRef, sanitizedUpdates as Partial<Project>);
        });
        // After the transaction, and inside the same `executeRemoteWrite`,
        // so a failure here is reported as one failed write and the
        // caller's rollback applies. Splitting it into a second public
        // call would make a partial save look like a success.
        if (hasAggregateUpdates) {
            const aggregateBatch = writeBatch(requireDb(db));
            await writeProjectAggregates(aggregateBatch, projectId, aggregateUpdates);
            await aggregateBatch.commit();
        }
        return { updatedAt };
    });
    if (isWriteConfirmed(result)) {
        forgetProject(projectId);
    } else if (result.status === 'offline') {
        writeLocalDraft(`project.${projectId}.update`, sanitizedUpdates);
    }
    return result;
};


export const deleteProject = async (projectId: string): Promise<PersistenceResult> => {
    const result = await executeRemoteWrite({ operationName: 'deleteProject', projectId }, async () => {
        const batch = writeBatch(requireDb(db));
        const artifactsSnapshot = await getDocs(collection(requireDb(db), PROJECTS_COLLECTION, projectId, ARTIFACTS_COLLECTION));
        artifactsSnapshot.docs.forEach((artifactDoc) => batch.delete(artifactDoc.ref));
        batch.delete(doc(requireDb(db), PROJECTS_COLLECTION, projectId, HISTORY_COLLECTION, CHAT_DOC));
        batch.delete(doc(requireDb(db), PROJECTS_COLLECTION, projectId));
        await batch.commit();
    });
    if (isWriteConfirmed(result)) {
        forgetProject(projectId);
        // El historial de chat vive dentro de la frontera de este agregado
        // (`projects/{id}/history/chat`) y el batch de arriba lo borra, así que
        // hay que decírselo a su contexto: `firestoreService` invalidaba esa
        // clave a mano porque la caché era una sola. Ahora cada contexto tiene
        // la suya y ésta es la coordinación explícita que lo sustituye.
        chatHistoryRepository.clearCache();
    }
    return result;
};
