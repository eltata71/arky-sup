/**
 * Cómo se lee un Proyecto de Arquitectura.
 *
 * ## Qué entra y qué sale de este agregado
 *
 * Un artefacto es una entidad **dentro** del agregado Proyecto: vive en su
 * propia tabla, cuenta para su `artifactCount` y aparece en su índice. Por eso
 * la *lectura* de artefactos está aquí —abrir un proyecto los trae— mientras
 * que la *escritura* de un artefacto concreto es de `services/artifacts`, que
 * importa de aquí los ayudantes del agregado y la invalidación de esta caché.
 * La dirección es una sola: artefactos conoce proyectos, proyectos no conoce
 * artefactos.
 *
 * ## Dos cosas que no se pueden perder al leer esto
 *
 * - **La lista de portafolio no carga artefactos.** `api.list_project_aggregates`
 *   devuelve el índice —identidad de cada artefacto, sin su cuerpo— y una lista
 *   de artefactos vacía. Cargarlo todo era lo más caro que hacía la aplicación
 *   al abrirse, y en PostgreSQL costaría lo mismo que costaba en Firestore.
 * - **Un fallo de lectura degrada a lo último que se vio**, nunca a un
 *   proyecto vacío: un proyecto vacío se parece demasiado a un proyecto sin
 *   trabajo.
 *
 * El grafo de conocimiento se lee aparte, de su propia tabla, y su fallo no
 * impide abrir el proyecto: es dato derivado que se reconstruye a partir de los
 * artefactos, así que cambiar una vista degradada por ninguna vista sería un
 * mal negocio.
 */

import type { Artifact, Project } from '../../types';
import { observabilityService } from '../observability';
import { validateProject, validateProjects } from './projectRuntimeValidation';
import { createSupabaseKnowledgeGraphRepository } from '../architectureKnowledgeGraph';
import type { ArchitectureGraph } from '../architectureKnowledgeGraph';
import { deserializePublicationPackages } from '../publicationPipeline/PublicationPersistenceAdapter';
import {
    classifyPersistenceError,
    getErrorCode,
    readLocal,
} from '../persistence';
import type { ArtifactSummary } from './ArchitectureProjectTypes';
import { fromProjectSnapshot, toArtifactSummary } from './projectDocumentMapper';
import { projectCache as cache } from './projectCache';
import { supabaseProjectRepository } from './SupabaseProjectRepository';
import { loadSupabaseDataClient } from '../adapters';

/** La clave del espejo local de la lista completa. */
export const PROJECTS_MIRROR_KEY = 'projects';

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
export const resetProjectReadCaches = (): void => {
    graphRepository = null;
    cache.clear();
};

const readKnowledgeGraph = async (projectId: string): Promise<ArchitectureGraph | undefined> => {
    try {
        return (await (await getGraphRepository()).load(projectId)) ?? undefined;
    } catch (error) {
        observabilityService.recordWarning({
            source: 'operation',
            title: 'Grafo de arquitectura no disponible',
            message: 'No se pudo leer el grafo de conocimiento; el proyecto se abre sin él y se reconstruye al editar.',
            detail: getErrorCode(error),
            metadata: { projectId },
            recoverable: true,
            userVisible: false,
        });
        return undefined;
    }
};

const trustedIndex = (document: Record<string, unknown>): ArtifactSummary[] | undefined => {
    const index = document.artifactIndex;
    if (!Array.isArray(index)) return undefined;
    const count = document.artifactCount;
    if (typeof count !== 'number' || index.length !== count) return undefined;
    return index as ArtifactSummary[];
};


export const getAllProjects = async (userId?: string, isAdmin?: boolean): Promise<Project[]> => {
    if (!userId && !isAdmin) {
        observabilityService.recordWarning({
            source: 'operation',
            title: 'getAllProjects bloqueado sin sesión',
            message: 'Se rechazó una consulta al portafolio sin userId ni privilegios admin.',
            userVisible: false,
            recoverable: true,
        });
        return [];
    }

    const cacheKey = `projects_${userId || 'admin-all'}_${isAdmin ? 'admin' : 'user'}`;
    const cached = cache.get<Project[]>(cacheKey);
    if (cached) return cached;

    try {
        // El portafolio necesita saber *qué* artefactos existen, no lo que
        // dicen. La RPC devuelve el índice y una lista vacía de cuerpos: es la
        // diferencia entre una fila por proyecto y todos los artefactos de la
        // cuenta, que es lo que el arranque descargaba antes de pintar nada.
        const aggregates = await supabaseProjectRepository.list();
        const projects = aggregates
            .map((aggregate) => {
                const id = aggregate.document.id;
                if (typeof id !== 'string' || id === '') return null;
                const index = trustedIndex(aggregate.document);
                return fromProjectSnapshot(id, aggregate.document, aggregate.artifacts, {
                    publicationPackages: aggregate.document.publicationPackages !== undefined
                        ? deserializePublicationPackages(aggregate.document.publicationPackages)
                        : undefined,
                    artifactsLoaded: aggregate.artifacts.length > 0,
                    artifactIndex: index ?? aggregate.artifacts.map(toArtifactSummary),
                });
            })
            .filter((project): project is Project => project !== null);

        const validation = validateProjects(projects);
        if (validation.issues.length > 0) {
            observabilityService.recordWarning({
                source: 'operation',
                title: 'Documentos de proyecto con campos faltantes',
                message: `Se sanearon ${validation.issues.length} validaciones al cargar el portafolio.`,
                metadata: { issueCount: validation.issues.length },
                recoverable: true,
                userVisible: false,
            });
        }
        const validatedProjects = validation.value ?? [];
        cache.set(cacheKey, validatedProjects);
        return validatedProjects;
    } catch (error) {
        observabilityService.reportError(error, {
            source: 'operation',
            title: 'No se pudieron cargar proyectos remotos',
            message: 'La lectura desde la base de datos falló. Solo se usará el espejo local de lectura si existe; no se simula persistencia remota.',
            operationName: 'getAllProjects',
            recoverable: true,
            userVisible: true,
            metadata: { errorCode: getErrorCode(error), status: classifyPersistenceError(error) },
        });
        const allProjects = readLocal<Project[]>(PROJECTS_MIRROR_KEY) || [];
        return userId && !isAdmin ? allProjects.filter((p: Project & { userId?: string }) => p.userId === userId) : allProjects;
    }
};


export const getProject = async (projectId: string): Promise<Project | undefined> => {
    const cacheKey = `project_${projectId}`;
    const cached = cache.get<Project>(cacheKey);
    if (cached) return cached;

    try {
        const aggregate = await supabaseProjectRepository.load(projectId);
        if (!aggregate) return undefined;
        const artifacts: Artifact[] = aggregate.artifacts;
        const architectureKnowledgeGraph = await readKnowledgeGraph(projectId);
        const validation = validateProject(fromProjectSnapshot(projectId, aggregate.document, artifacts, {
            architectureKnowledgeGraph,
            publicationPackages: aggregate.document.publicationPackages !== undefined
                ? deserializePublicationPackages(aggregate.document.publicationPackages)
                : undefined,
            artifactsLoaded: true,
            artifactIndex: artifacts.map(toArtifactSummary),
        }));
        if (!validation.value) {
            observabilityService.recordWarning({
                source: 'operation',
                title: 'Proyecto con datos corruptos',
                message: `El registro ${projectId} no superó la validación de esquema y no se cargó.`,
                metadata: { projectId, issueCount: validation.issues.length },
                recoverable: true,
                userVisible: true,
            });
            return undefined;
        }
        cache.set(cacheKey, validation.value);
        return validation.value;
    } catch (error) {
        observabilityService.reportError(error, {
            source: 'operation',
            title: 'No se pudo cargar proyecto remoto',
            message: 'La lectura desde la base de datos falló. Se intentará el espejo local de solo lectura si existe.',
            operationName: `getProject(${projectId})`,
            recoverable: true,
            userVisible: true,
            metadata: { projectId, errorCode: getErrorCode(error), status: classifyPersistenceError(error) },
        });
        const projects = readLocal<Project[]>(PROJECTS_MIRROR_KEY) || [];
        return projects.find(p => p.id === projectId);
    }
};
