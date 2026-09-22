/**
 * Dónde se escribe un artefacto.
 *
 * ## Un comando por intención (F4-03, ADR-106)
 *
 * Hasta F4-03 cada operación de este fichero leía el proyecto, aplicaba el
 * cambio sobre la lista completa de artefactos en memoria y la devolvía entera
 * a `api.save_project_aggregate`. Eso tenía tres consecuencias, y F4-01 las
 * midió: editar uno reescribía los `N`; la revisión comparada era la del
 * **proyecto**, así que dos ediciones de artefactos distintos chocaban; y una
 * lista incompleta borraba lo que faltaba.
 *
 * ADR-106 decidió que el Artefacto es raíz de su propio agregado. Aquí eso se
 * lee así: cada función llama a **un** comando (`SupabaseArtifactCommands`) y
 * compara la revisión **del artefacto**. El contador y el índice del proyecto
 * son una proyección que el servidor recalcula en la misma transacción.
 *
 * ## De dónde sale la revisión esperada
 *
 * Del propio artefacto: la lectura la superpone como `revision` y el hook que
 * mantiene el estado guarda la que confirma cada escritura. Cuando quien llama
 * no la trae —un artefacto que nunca pasó por la base en esta pestaña, o un
 * llamante que sólo conoce el id—, se lee del proyecto. Nunca de un mapa
 * global: ese es el defecto H10 que F2-10 quitó de los encargos.
 *
 * ## Por qué este módulo conoce a `architectureProjects` y no al revés
 *
 * Para leer el proyecto (`getProject`) y para invalidar su caché
 * (`forgetProject`): el documento del proyecto lleva el índice y el contador,
 * así que escribir un artefacto lo deja obsoleto. La dirección es una sola.
 */

import type { Artifact } from '../../types';
import {
    createFailureResult,
    executeRemoteWrite,
    isWriteConfirmed,
    writeLocalDraft,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import { forgetProject, getProject } from '../architectureProjects';
import { supabaseArtifactCommands, type ArtifactRevisionChange } from './SupabaseArtifactCommands';

export type { ArtifactRevisionChange } from './SupabaseArtifactCommands';

/** Lo que devuelve una edición confirmada: la marca de tiempo y la revisión nueva. */
export interface ArtifactWriteConfirmation {
    readonly updatedAt: string;
    readonly revision?: number;
}

const notFound = (operation: string, artifactId: string): PersistenceResult<never> => ({
    status: 'validation-error',
    success: false,
    operationId: `${operation}-${Date.now()}`,
    target: 'supabase',
    errorCode: 'P0002',
    message: `El artefacto ${artifactId} no está disponible en la base de datos. Si acabas de generarlo, espera unos segundos y reintenta; si el problema persiste, recarga la aplicación.`,
});

/**
 * La revisión vigente de un artefacto según la última lectura del proyecto.
 * `null` si el artefacto no está: el llamante decide qué significa eso.
 */
const currentRevision = async (projectId: string, artifactId: string): Promise<number | null | undefined> => {
    const project = await getProject(projectId);
    const artifact = project?.artifacts?.find((entry) => entry.id === artifactId);
    if (!artifact) return null;
    return artifact.revision;
};

/**
 * Ejecuta un comando con el registro de observabilidad de siempre, e invalida
 * la caché del proyecto cuando la base lo confirma.
 */
const runCommand = async <T>(
    projectId: string,
    operationName: string,
    context: { userId?: string; artifactId?: string },
    command: () => Promise<T>,
): Promise<PersistenceResult<T>> => {
    let result: PersistenceResult<T>;
    try {
        result = await executeRemoteWrite<T>(
            { operationName, userId: context.userId, projectId, artifactId: context.artifactId },
            command,
        );
    } catch (error) {
        result = createFailureResult<T>(operationName, error);
    }
    if (isWriteConfirmed(result)) forgetProject(projectId);
    return result;
};


/** Crea un artefacto en un grupo de versiones nuevo. */
export const createArtifact = async (
    projectId: string,
    artifact: Artifact,
    options: { userId?: string } = {},
): Promise<PersistenceResult<Artifact>> => {
    const result = await runCommand(projectId, 'createArtifact', { ...options, artifactId: artifact.id },
        () => supabaseArtifactCommands.create(projectId, artifact));
    if (!isWriteConfirmed(result) && result.status === 'offline') {
        writeLocalDraft(`project.${projectId}.artifact.${artifact.id}.create`, artifact);
    }
    return result;
};


/**
 * Añade la versión siguiente de un grupo existente. El servidor rechaza con
 * `P0001` una versión que ya no es la siguiente: dos pestañas que versionan a
 * la vez no producen dos «versión 2».
 */
export const createArtifactVersion = async (
    projectId: string,
    artifact: Artifact,
    options: { userId?: string } = {},
): Promise<PersistenceResult<Artifact>> => {
    const result = await runCommand(projectId, 'createArtifactVersion', { ...options, artifactId: artifact.id },
        () => supabaseArtifactCommands.createVersion(projectId, artifact));
    if (!isWriteConfirmed(result) && result.status === 'offline') {
        writeLocalDraft(`project.${projectId}.artifact.${artifact.id}.create`, artifact);
    }
    return result;
};


/** Edita un artefacto: viaja el parche, y se compara la revisión de ese artefacto. */
export const updateArtifact = async (
    projectId: string,
    artifactId: string,
    updates: Partial<Artifact>,
    options: { expectedRevision?: number; userId?: string } = {},
): Promise<PersistenceResult<ArtifactWriteConfirmation>> => {
    const updatedAt = new Date().toISOString();
    const patch = { ...updates, updatedAt } as Partial<Artifact>;
    delete (patch as { id?: string }).id;
    const expected = options.expectedRevision ?? await currentRevision(projectId, artifactId);
    if (expected === null) return notFound('updateArtifact', artifactId);
    const result = await runCommand(projectId, 'updateArtifact', { ...options, artifactId },
        async (): Promise<ArtifactWriteConfirmation> => {
            // Sin revisión conocida se envía 0, que nunca es vigente: el
            // servidor responde con un conflicto en vez de aceptar a ciegas.
            const saved = await supabaseArtifactCommands.update(artifactId, expected ?? 0, patch);
            return { updatedAt, revision: saved.revision };
        });
    if (!isWriteConfirmed(result) && result.status === 'offline') {
        writeLocalDraft(`project.${projectId}.artifact.${artifactId}.update`, updates);
    }
    return result;
};


/** Borra un artefacto. Borrar lo que ya no está es un éxito: la intención se cumplió. */
export const deleteArtifact = async (
    projectId: string,
    artifactId: string,
    options: { expectedRevision?: number; userId?: string } = {},
): Promise<PersistenceResult<{ updatedAt: string }>> => {
    const updatedAt = new Date().toISOString();
    const expected = options.expectedRevision ?? await currentRevision(projectId, artifactId);
    if (expected === null) {
        return { status: 'success', success: true, target: 'supabase', operationId: `deleteArtifact-${Date.now()}`, data: { updatedAt } };
    }
    return runCommand(projectId, 'deleteArtifact', { ...options, artifactId }, async () => {
        await supabaseArtifactCommands.remove(artifactId, expected ?? 0);
        return { updatedAt };
    });
};


/**
 * Varias versiones nuevas y borrados en **una** transacción.
 *
 * Es atómico por intención del usuario —aplicar una sugerencia de
 * consistencia, retirar los artefactos corruptos—, no una frontera de agregado
 * (ADR-106 §4): cualquier rechazo deja el proyecto como estaba. Un borrado sin
 * revisión conocida la toma de la última lectura del proyecto.
 */
export const reviseArtifacts = async (
    projectId: string,
    changes: readonly ArtifactRevisionChange[],
    options: { userId?: string } = {},
): Promise<PersistenceResult<Artifact[]>> => {
    if (changes.length === 0) {
        return { status: 'success', success: true, target: 'supabase', operationId: `reviseArtifacts-${Date.now()}`, data: [] };
    }
    return runCommand(projectId, 'reviseArtifacts', options,
        () => supabaseArtifactCommands.revise(projectId, changes));
};


/**
 * Los cambios de un borrado en lote, con la revisión de cada artefacto.
 * Los que ya no están se omiten: su borrado ya ocurrió.
 */
export const deletionChanges = async (
    projectId: string,
    artifacts: readonly Pick<Artifact, 'id' | 'revision'>[],
): Promise<ArtifactRevisionChange[]> => {
    const changes: ArtifactRevisionChange[] = [];
    for (const artifact of artifacts) {
        const expected = artifact.revision ?? await currentRevision(projectId, artifact.id);
        if (expected === null) continue;
        changes.push({ op: 'delete', artifactId: artifact.id, expectedRevision: expected ?? 0 });
    }
    return changes;
};
