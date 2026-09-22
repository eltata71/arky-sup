/**
 * Cómo se escribe un Proyecto de Arquitectura.
 *
 * Dos puertas desde ADR-106: `api.save_project` guarda la raíz —y es la que usa
 * `updateProject`— y `api.save_project_aggregate` crea un proyecto junto con
 * sus artefactos iniciales. Ninguna escribe un artefacto de un proyecto que ya
 * existe: eso es de `services/artifacts`, comando a comando. **Una
 * actualización parcial sigue leyendo antes de escribir**, porque la raíz se
 * guarda entera y un `updateProject` con tres campos necesita los demás.
 *
 * El grafo de conocimiento viaja aparte, a `api.save_knowledge_graph`. Es dato
 * derivado que se reconstruye con cada cambio de artefacto y crece con su
 * número: dentro del proyecto haría que cada escritura de un campo de texto
 * arrastrara el grafo entero por la red.
 *
 * ## Lo que este fichero puede y no puede importar
 *
 * Está en el camino de arranque —`AppContext` → `useProjectsState` →
 * `ArchitectureProjectRepository` → aquí—, así que entra a `services/chat` por
 * **ruta de fichero** y no por su barril. El barril exporta `chatCompactor`,
 * que alcanza `services/ai` y con él el motor de 5 400 líneas: entrar por la
 * puerta principal ponía toda la capa de IA en la carga inicial para obtener un
 * objeto que sólo habla con la base de datos.
 */

import type { Artifact, Project } from '../../types';
import { chatHistoryRepository } from '../chat/ChatHistoryRepository';
import {
    createFailureResult,
    executeRemoteWrite,
    isWriteConfirmed,
    writeLocalDraft,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import { toProjectDocument } from './projectDocumentMapper';
import { forgetProject } from './projectCache';
import { getProject } from './projectReads';
import { knownProjectRevision, supabaseProjectRepository } from './SupabaseProjectRepository';
import { createSupabaseKnowledgeGraphRepository } from '../architectureKnowledgeGraph';
import { loadSupabaseDataClient } from '../adapters';

let graphRepository: ReturnType<typeof createSupabaseKnowledgeGraphRepository> | null = null;
const getGraphRepository = async () => {
    if (!graphRepository) {
        const client = await loadSupabaseDataClient();
        graphRepository = createSupabaseKnowledgeGraphRepository(
            client as unknown as Parameters<typeof createSupabaseKnowledgeGraphRepository>[0],
        );
    }
    return graphRepository;
};

/** Solo para pruebas: olvida el repositorio de grafo memorizado. */
export const resetProjectWriteCaches = (): void => { graphRepository = null; };

type RemoteSave = (document: Record<string, unknown>) => ReturnType<typeof supabaseProjectRepository.save>;

/**
 * Lo común a las dos escrituras: el registro en observabilidad, la
 * invalidación de caché y el borrador local, decididos una vez.
 */
const persistProject = async (
    project: Project & { userId?: string },
    operationName: string,
    save: RemoteSave,
    draft: unknown,
): Promise<PersistenceResult<{ updatedAt: string }>> => {
    const updatedAt = typeof project.updatedAt === 'string' ? project.updatedAt : new Date().toISOString();
    const document = toProjectDocument({ ...project, updatedAt });
    let result: PersistenceResult<{ updatedAt: string }>;
    try {
        result = await executeRemoteWrite<{ updatedAt: string }>(
            { operationName, userId: project.userId, projectId: project.id },
            async () => {
                const saved = await save(document);
                // `save` devuelve el sobre en vez de lanzar, para que sus
                // llamantes directos no tengan que envolverlo. Aquí sí se
                // lanza: `executeRemoteWrite` es lo que registra el fallo en
                // observabilidad con su duración y su código.
                if (!isWriteConfirmed(saved)) throw saved.error ?? new Error(saved.message ?? 'Escritura no confirmada.');
                return { updatedAt };
            },
        );
    } catch (error) {
        result = createFailureResult(operationName, error);
    }
    if (isWriteConfirmed(result)) forgetProject(project.id);
    else if (result.status === 'offline') writeLocalDraft(`project.${project.id}`, draft);
    return result;
};

/**
 * Crea el agregado con sus artefactos iniciales, en una transacción.
 *
 * Es el único uso que le queda a la RPC compuesta (ADR-106 §5): sobre un
 * proyecto existente el servidor ya no acepta una lista distinta de la que
 * tiene, porque cada artefacto se escribe con su propio comando.
 */
export const persistProjectAggregate = (
    project: Project & { userId?: string },
    artifacts: Artifact[],
    context: { operationName: string; expectedRevision?: number },
): Promise<PersistenceResult<{ updatedAt: string }>> => persistProject(
    project,
    context.operationName,
    (document) => supabaseProjectRepository.save(document, artifacts, context.expectedRevision),
    { ...project, artifacts },
);

/** Guarda sólo la raíz. Los artefactos no viajan: no hay lista que pueda borrar nada. */
const persistProjectRoot = (
    project: Project & { userId?: string },
    context: { operationName: string; expectedRevision?: number },
): Promise<PersistenceResult<{ updatedAt: string }>> => persistProject(
    project,
    context.operationName,
    (document) => supabaseProjectRepository.saveRoot(document, context.expectedRevision),
    project,
);


export const createProject = async (project: Project & { userId?: string }): Promise<PersistenceResult> => {
    if (!project.userId) {
        return {
            status: 'validation-error',
            success: false,
            operationId: `createProject-${Date.now()}`,
            target: 'supabase',
            errorCode: 'project/missing-user-id',
            message: 'No se puede crear un proyecto persistente sin userId autenticado.',
        };
    }
    // Revisión 0 = «no existe todavía». La RPC crea la fila con revisión 1 y
    // rechaza el segundo intento con el mismo id, que es lo que impide que dos
    // pestañas creen dos proyectos con la misma identidad.
    const result = await persistProjectAggregate(project, project.artifacts ?? [], {
        operationName: 'createProject',
        expectedRevision: 0,
    });
    if (isWriteConfirmed(result) && project.architectureKnowledgeGraph) {
        await saveKnowledgeGraph(project.id, project.architectureKnowledgeGraph);
    }
    return result;
};


const saveKnowledgeGraph = async (
    projectId: string,
    graph: NonNullable<Project['architectureKnowledgeGraph']>,
): Promise<void> => {
    try {
        await (await getGraphRepository()).save({ ...graph, projectId });
    } catch {
        // El grafo es derivado: un fallo aquí no invalida la escritura del
        // proyecto, y la próxima edición de un artefacto lo vuelve a construir.
        // Informar de un proyecto no guardado por esto sería mentir al revés.
    }
};


export const updateProject = async (
    projectId: string,
    updates: Partial<Project>,
    options: { userId?: string; expectedUpdatedAt?: string } = {},
): Promise<PersistenceResult<{ updatedAt: string }>> => {
    const updatedAt = typeof updates.updatedAt === 'string' ? updates.updatedAt : new Date().toISOString();
    const current = await getProject(projectId);
    if (!current) {
        return {
            status: 'validation-error',
            success: false,
            operationId: `updateProject-${Date.now()}`,
            target: 'supabase',
            errorCode: 'project/not-found',
            message: `El proyecto ${projectId} no existe o no pertenece a esta sesión.`,
        };
    }
    // Conflicto por fecha, **antes** de llegar al servidor. La RPC comprueba la
    // revisión, que es la garantía real; esto atrapa el caso en que esta pestaña
    // sabe que hay una versión más nueva y evita gastar la ida y vuelta.
    if (options.expectedUpdatedAt && current.updatedAt > options.expectedUpdatedAt) {
        return {
            status: 'conflict',
            success: false,
            operationId: `updateProject-${Date.now()}`,
            target: 'supabase',
            message: 'El proyecto cambió en otra sesión. Recarga antes de sobrescribir.',
            conflict: { remoteUpdatedAt: current.updatedAt, expectedUpdatedAt: options.expectedUpdatedAt },
        };
    }

    // `artifacts` se descarta a propósito: desde ADR-106 los artefactos se
    // escriben con sus comandos, y la raíz no tiene forma de enviarlos.
    const { architectureKnowledgeGraph, artifacts: _artifacts, ...rest } = updates;
    const next: Project & { userId?: string } = {
        ...current,
        ...rest,
        id: projectId,
        updatedAt,
        userId: options.userId ?? (current as Project & { userId?: string }).userId,
    };
    const result = await persistProjectRoot(next, { operationName: 'updateProject' });
    if (isWriteConfirmed(result) && architectureKnowledgeGraph !== undefined) {
        await saveKnowledgeGraph(projectId, architectureKnowledgeGraph);
    }
    return result;
};


export const deleteProject = async (projectId: string): Promise<PersistenceResult> => {
    let result: PersistenceResult;
    try {
        result = await executeRemoteWrite({ operationName: 'deleteProject', projectId }, async () => {
            const removed = await supabaseProjectRepository.remove(projectId, knownProjectRevision(projectId));
            if (!isWriteConfirmed(removed)) throw removed.error ?? new Error(removed.message ?? 'Borrado no confirmado.');
        });
    } catch (error) {
        result = createFailureResult('deleteProject', error);
    }
    if (isWriteConfirmed(result)) {
        forgetProject(projectId);
        // El historial de chat vive dentro de la frontera de este agregado y la
        // cascada de la base de datos lo borró, así que hay que decírselo a su
        // contexto: cada contexto tiene su caché y ésta es la coordinación
        // explícita que sustituye a la invalidación a mano de `firestoreService`.
        chatHistoryRepository.clearCache();
    }
    return result;
};
