/**
 * Dónde se escribe un artefacto.
 *
 * ## Por qué este módulo conoce a `architectureProjects` y no al revés
 *
 * Un artefacto es una entidad **dentro** del agregado Proyecto: vive en su
 * tabla hija, cuenta para su `artifactCount` y aparece en el `artifactIndex`
 * que las pantallas de portafolio leen. La dirección es una sola y a propósito:
 * este módulo importa de `architectureProjects`, y `architectureProjects` no
 * importa de éste.
 *
 * ## Lo que cambió al retirar Firestore, y por qué es más simple
 *
 * Cada una de estas operaciones era una transacción a mano —leer el proyecto,
 * leer el artefacto, leer el índice, escribir los tres, mantener el contador—
 * porque Firestore no tenía forma de expresar «este agregado se guarda entero».
 * `api.save_project_aggregate` sí: recibe el proyecto y la lista completa de
 * artefactos y mantiene raíz, hijos, contador e índice en una sola transacción
 * del servidor. Así que aquí se lee el agregado, se aplica el cambio en memoria
 * y se vuelve a guardar.
 *
 * Tres cosas desaparecieron con eso, y ninguna se echa de menos:
 *
 *  - **La poda.** `prepareArtifactForFirestore` recortaba el plan de
 *    maquetación y la traza de generación para caber en 1 MiB por documento.
 *    Una fila `jsonb` admite tres órdenes de magnitud más, así que el artefacto
 *    se guarda entero. La poda silenciosa era pérdida de datos que sólo se
 *    descubría cuando el diagrama se abría vacío.
 *  - **El reintento contra la carrera de creación.** Existía porque
 *    `createArtifact` y el `updateArtifact` del render siguiente eran dos
 *    transacciones independientes y la segunda podía no ver a la primera. Ahora
 *    las dos leen y escriben el mismo agregado, y la revisión optimista de la
 *    RPC convierte la carrera en un conflicto explícito en vez de en un «no
 *    existe».
 *  - **El índice a mano.** Lo mantiene el servidor, que es el único que puede
 *    garantizar que concuerda con las filas.
 */

import type { Artifact, Project } from '../../types';
import {
    createFailureResult,
    ensureConfirmed,
    isWriteConfirmed,
    writeLocalDraft,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import { getProject, persistProjectAggregate } from '../architectureProjects';

const missingProject = (projectId: string, operation: string): PersistenceResult<never> => ({
    status: 'validation-error',
    success: false,
    operationId: `${operation}-${Date.now()}`,
    target: 'supabase',
    errorCode: 'project/not-found',
    message: `El proyecto ${projectId} no existe o no pertenece a esta sesión.`,
});

/**
 * Lee el agregado, aplica el cambio y lo vuelve a guardar.
 *
 * Es el único camino de escritura de este módulo. `mutate` devuelve la lista
 * completa de artefactos que debe quedar, o `null` cuando no hay nada que
 * hacer — un borrado de algo que ya no está, por ejemplo, que es un éxito y no
 * un error.
 */
const mutateArtifacts = async <T>(
    projectId: string,
    operationName: string,
    mutate: (current: Artifact[], project: Project) => Artifact[] | null,
    data: (updatedAt: string) => T,
    options: { userId?: string } = {},
): Promise<PersistenceResult<T>> => {
    const project = await getProject(projectId);
    if (!project) return missingProject(projectId, operationName) as PersistenceResult<T>;
    let next: Artifact[] | null;
    try {
        next = mutate(project.artifacts ?? [], project);
    } catch (error) {
        // `mutate` lanza para los rechazos que se deciden en memoria —el id
        // duplicado, el artefacto ausente, el conflicto de fecha— y aquí se
        // clasifican con el mismo vocabulario que un rechazo del servidor.
        // Quien llama a un repositorio recibe siempre un sobre.
        return createFailureResult<T>(operationName, error);
    }
    const updatedAt = new Date().toISOString();
    if (next === null) {
        return {
            status: 'success', success: true, target: 'supabase',
            operationId: `${operationName}-${Date.now()}`, data: data(updatedAt),
        };
    }
    const result = await persistProjectAggregate(
        { ...project, updatedAt, userId: options.userId ?? (project as Project & { userId?: string }).userId },
        next,
        { operationName },
    );
    return {
        ...result,
        data: isWriteConfirmed(result) ? data(updatedAt) : undefined,
    } as PersistenceResult<T>;
};


export const createArtifact = async (
    projectId: string,
    artifact: Artifact,
    options: { userId?: string } = {},
): Promise<PersistenceResult<Artifact>> => {
    const result = await mutateArtifacts<Artifact>(
        projectId,
        'createArtifact',
        (current) => {
            if (current.some((entry) => entry.id === artifact.id)) {
                const error = new Error(`Artefacto ${artifact.id} ya existe.`) as Error & { code: string };
                error.code = '23505';
                throw error;
            }
            return [...current, artifact];
        },
        () => artifact,
        options,
    );
    if (!isWriteConfirmed(result) && result.status === 'offline') {
        writeLocalDraft(`project.${projectId}.artifact.${artifact.id}.create`, artifact);
    }
    return result;
};


export const updateArtifact = async (
    projectId: string,
    artifactId: string,
    updates: Partial<Artifact>,
    options: { expectedUpdatedAt?: string; userId?: string } = {},
): Promise<PersistenceResult<{ updatedAt: string }>> => {
    const updatedAt = new Date().toISOString();
    const patch = { ...updates, updatedAt } as Partial<Artifact>;
    delete (patch as { id?: string }).id;
    const result = await mutateArtifacts<{ updatedAt: string }>(
        projectId,
        'updateArtifact',
        (current) => {
            const existing = current.find((entry) => entry.id === artifactId);
            if (!existing) {
                const error = new Error(
                    `El artefacto ${artifactId} no está disponible en la base de datos. Si acabas de generarlo, espera unos segundos y reintenta; si el problema persiste, recarga la aplicación.`,
                ) as Error & { code: string; userMessage: string };
                error.code = '23503';
                error.userMessage = error.message;
                throw error;
            }
            const remoteUpdatedAt = (existing as Artifact & { updatedAt?: string }).updatedAt;
            if (options.expectedUpdatedAt && typeof remoteUpdatedAt === 'string' && remoteUpdatedAt > options.expectedUpdatedAt) {
                const error = new Error('Conflicto de concurrencia en artefacto.') as Error & { code: string };
                error.code = 'P0001';
                throw error;
            }
            return current.map((entry) => (entry.id === artifactId ? { ...entry, ...patch } : entry));
        },
        () => ({ updatedAt }),
        options,
    );
    if (!isWriteConfirmed(result) && result.status === 'offline') {
        writeLocalDraft(`project.${projectId}.artifact.${artifactId}.update`, updates);
    }
    return result;
};


export const deleteArtifact = async (
    projectId: string,
    artifactId: string,
    options: { userId?: string } = {},
): Promise<PersistenceResult<{ updatedAt: string }>> => {
    const updatedAt = new Date().toISOString();
    return mutateArtifacts<{ updatedAt: string }>(
        projectId,
        'deleteArtifact',
        // Borrar algo que ya no está es un éxito: la intención se cumplió y
        // devolver un error obligaría a cada llamante a distinguir dos casos
        // que para el usuario son el mismo.
        (current) => (current.some((entry) => entry.id === artifactId)
            ? current.filter((entry) => entry.id !== artifactId)
            : null),
        () => ({ updatedAt }),
        options,
    );
};


export const updateProjectArtifacts = async (
    projectId: string,
    artifacts: Artifact[],
    options: { expectedUpdatedAt?: string; userId?: string } = {},
): Promise<PersistenceResult<{ updatedAt: string }>> => {
    const updatedAt = new Date().toISOString();
    const result = await mutateArtifacts<{ updatedAt: string }>(
        projectId,
        'updateProjectArtifacts',
        (_current, project) => {
            if (options.expectedUpdatedAt && project.updatedAt > options.expectedUpdatedAt) {
                const error = new Error('Conflicto de concurrencia en artefactos.') as Error & { code: string };
                error.code = 'P0001';
                throw error;
            }
            return artifacts;
        },
        () => ({ updatedAt }),
        options,
    );
    if (!isWriteConfirmed(result) && result.status === 'offline') {
        writeLocalDraft(`project.${projectId}.artifacts`, artifacts);
    }
    return result;
};


export const batchUpdateArtifacts = async (
    projectId: string,
    operations: Array<{ type: 'add' | 'update' | 'delete'; artifact: Artifact }>,
): Promise<Artifact[]> => {
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
