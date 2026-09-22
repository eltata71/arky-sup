/**
 * Cómo se escribe un Proyecto de Arquitectura.
 *
 * Una puerta desde F4-06: `api.save_project` guarda la raíz, y es la misma para
 * crear (revisión esperada 0) y para actualizar. La RPC compuesta que creaba un
 * proyecto «con sus artefactos iniciales» se retiró: ningún llamante los traía,
 * y cada artefacto se escribe con su propio comando desde `services/artifacts`
 * (ADR-106 §5). **Una
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

import type { Project, ProjectRoot } from './ArchitectureProjectTypes';
import { chatHistoryRepository } from '../chat/ChatHistoryRepository';
import { createFailureResult, executeRemoteWrite, isWriteConfirmed, writeLocalDraft, type PersistenceResult } from '../persistence';
import { toProjectDocument, type PersistedProjectDocument } from './projectDocumentMapper';
import { forgetProject } from './projectCache';
import { getProject } from './projectReads';
import { supabaseProjectRepository } from './SupabaseProjectRepository';
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

type RemoteSave = (document: PersistedProjectDocument) => ReturnType<typeof supabaseProjectRepository.saveRoot>;

/**
 * Lo común a crear y actualizar: el registro en observabilidad, la
 * invalidación de caché y el borrador local, decididos una vez.
 */
/** Lo que devuelve una escritura confirmada: la marca de tiempo y la revisión nueva. */
export interface ProjectWriteConfirmation {
    readonly updatedAt: string;
    readonly revision?: number;
}

const persistProject = async (
    project: ProjectRoot & { userId?: string },
    operationName: string,
    save: RemoteSave,
    draft: unknown,
): Promise<PersistenceResult<ProjectWriteConfirmation>> => {
    const updatedAt = typeof project.updatedAt === 'string' ? project.updatedAt : new Date().toISOString();
    const document = toProjectDocument({ ...project, updatedAt });
    let result: PersistenceResult<ProjectWriteConfirmation>;
    try {
        result = await executeRemoteWrite<ProjectWriteConfirmation>(
            { operationName, userId: project.userId, projectId: project.id },
            async () => {
                const saved = await save(document);
                // `save` devuelve el sobre en vez de lanzar, para que sus
                // llamantes directos no tengan que envolverlo. Aquí sí se
                // lanza: `executeRemoteWrite` es lo que registra el fallo en
                // observabilidad con su duración y su código.
                if (!isWriteConfirmed(saved)) throw saved.error ?? new Error(saved.message ?? 'Escritura no confirmada.');
                return { updatedAt, revision: saved.data?.revision };
            },
        );
    } catch (error) {
        result = createFailureResult(operationName, error);
    }
    if (isWriteConfirmed(result)) forgetProject(project.id);
    else if (result.status === 'offline') writeLocalDraft(`project.${project.id}`, draft);
    return result;
};

/** Guarda sólo la raíz. Los artefactos no viajan: no hay lista que pueda borrar nada. */
const persistProjectRoot = (
    project: ProjectRoot & { userId?: string },
    context: { operationName: string; expectedRevision: number },
): Promise<PersistenceResult<ProjectWriteConfirmation>> => persistProject(
    project,
    context.operationName,
    (document) => supabaseProjectRepository.saveRoot(document, context.expectedRevision),
    project,
);


/**
 * Crea un proyecto a partir de la raíz que construyó la fábrica.
 *
 * Nace sin artefactos —cada uno se crea después con su comando— y sin grafo de
 * conocimiento, que es derivado de los artefactos. Por eso esta firma no acepta
 * el modelo de lectura: no hay nada de él que tenga sentido guardar al crear.
 */
export const createProject = async (project: ProjectRoot & { userId?: string }): Promise<PersistenceResult<ProjectWriteConfirmation>> => {
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
    return persistProjectRoot(project, {
        operationName: 'createProject',
        expectedRevision: 0,
    });
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


/**
 * Guarda cambios en la raíz del proyecto.
 *
 * La revisión esperada es la del registro que la persona está viendo: la trae
 * quien llama (F4-07). Si no la trae, se usa la de la última lectura del
 * proyecto — nunca un mapa del repositorio, y nunca una comparación de fechas,
 * que depende del reloj de quien escribió (ADR-106 §7).
 */
export const updateProject = async (
    projectId: string,
    updates: Partial<Project>,
    options: { userId?: string; expectedRevision?: number } = {},
): Promise<PersistenceResult<ProjectWriteConfirmation>> => {
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

    // `artifacts` se descarta a propósito: desde ADR-106 los artefactos se
    // escriben con sus comandos, y la raíz no tiene forma de enviarlos.
    const { architectureKnowledgeGraph, artifacts: _artifacts, revision: _revision, ...rest } = updates;
    const next: Project & { userId?: string } = {
        ...current,
        ...rest,
        id: projectId,
        updatedAt,
        userId: options.userId ?? (current as Project & { userId?: string }).userId,
    };
    // Sin revisión conocida se envía 0, que la base sólo acepta para crear: una
    // escritura que no sabe contra qué fila va se rechaza, no pisa a nadie.
    const expectedRevision = options.expectedRevision ?? current.revision ?? 0;
    const result = await persistProjectRoot(next, { operationName: 'updateProject', expectedRevision });
    if (isWriteConfirmed(result) && architectureKnowledgeGraph !== undefined) {
        await saveKnowledgeGraph(projectId, architectureKnowledgeGraph);
    }
    return result;
};


export const deleteProject = async (
    projectId: string,
    options: { expectedRevision?: number } = {},
): Promise<PersistenceResult> => {
    const expectedRevision = options.expectedRevision ?? (await getProject(projectId))?.revision ?? 0;
    let result: PersistenceResult;
    try {
        result = await executeRemoteWrite({ operationName: 'deleteProject', projectId }, async () => {
            const removed = await supabaseProjectRepository.remove(projectId, expectedRevision);
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
