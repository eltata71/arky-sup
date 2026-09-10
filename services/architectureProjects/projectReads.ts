/**
 * Cómo se lee un Proyecto de Arquitectura.
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

import { collection, doc, getDoc, getDocs, query, where, type DocumentData } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Artifact, Project } from '../../types';
import { observabilityService } from '../observability';
import { validateProject, validateProjects } from './projectRuntimeValidation';
import { deserializeArchitectureGraph } from '../architectureKnowledgeGraph/ArchitectureGraphPersistenceAdapter';
import { deserializePublicationPackages } from '../publicationPipeline/PublicationPersistenceAdapter';
import type { ArchitectureGraph } from '../architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes';
import type { PublicationPackage } from '../publicationPipeline/PublicationPipelineTypes';
import {
    AGGREGATES_COLLECTION,
    ARCHITECTURE_GRAPH_DOC,
    ARTIFACT_INDEX_DOC,
    ARTIFACTS_COLLECTION,
    PROJECTS_COLLECTION,
    PUBLICATIONS_COLLECTION,
    classifyPersistenceError,
    getErrorCode,
    readLocal,
    requireDb,
} from '../persistence';
import type { ArtifactSummary } from './ArchitectureProjectTypes';
import {
    fromProjectSnapshot,
    readTrustedArtifactIndex,
    toArtifactSummary,
} from './projectDocumentMapper';
import { projectCache as cache } from './projectCache';

/**
 * Load the split aggregates, falling back to the legacy inline fields.
 *
 * Same shape as `readArtifacts` below: migration is lazy and happens on
 * read, so nothing has to be rewritten before the app works and a project
 * saved by an older build still opens. The first write of either aggregate
 * promotes the project to `aggregateStorage: 'split-v1'`.
 */
/**
 * The index alone — what a portfolio screen needs.
 *
 * One small document per project instead of that project's entire artifact
 * subcollection. Returns `undefined` when there is no index, or when the
 * one stored disagrees with `artifactCount`; the caller then loads the
 * artifacts, so this is a performance path that cannot produce a wrong
 * answer.
 */
const readArtifactIndex = async (projectId: string, data: DocumentData): Promise<ArtifactSummary[] | undefined> => {
    try {
        const snap = await getDoc(doc(requireDb(db), PROJECTS_COLLECTION, projectId, AGGREGATES_COLLECTION, ARTIFACT_INDEX_DOC));
        return snap.exists() ? readTrustedArtifactIndex(snap.data(), data.artifactCount) : undefined;
    } catch {
        // Unreadable index behaves exactly like a missing one.
        return undefined;
    }
};


const readProjectAggregates = async (
    projectId: string,
    data: DocumentData,
): Promise<{ architectureKnowledgeGraph?: ArchitectureGraph; publicationPackages?: PublicationPackage[] }> => {
    // Deliberately fault-tolerant. These are secondary documents: the
    // graph is derived data that rebuilds from the artifacts, and the
    // packages are a governance record. Letting a failed read of either
    // prevent the project from opening would trade a degraded view for no
    // view at all — and it would be a new failure mode, because before the
    // split a project read touched neither.
    let splitGraph: unknown;
    let splitPackages: unknown[] = [];
    try {
        const [graphSnap, packagesSnap] = await Promise.all([
            getDoc(doc(requireDb(db), PROJECTS_COLLECTION, projectId, AGGREGATES_COLLECTION, ARCHITECTURE_GRAPH_DOC)),
            getDocs(collection(requireDb(db), PROJECTS_COLLECTION, projectId, PUBLICATIONS_COLLECTION)),
        ]);
        splitGraph = graphSnap?.exists?.() ? graphSnap.data()?.graph : undefined;
        splitPackages = (packagesSnap?.docs ?? []).map((snap) => snap.data()?.package);
    } catch (error) {
        observabilityService.recordWarning({
            source: 'operation',
            title: 'Agregados del proyecto no disponibles',
            message: 'No se pudieron leer el grafo de arquitectura ni los paquetes de publicación; se usan los datos heredados del documento de proyecto.',
            detail: getErrorCode(error),
            metadata: { projectId },
            recoverable: true,
            userVisible: false,
        });
    }

    // Both adapters already migrate and runtime-validate on read.
    const architectureKnowledgeGraph = deserializeArchitectureGraph(
        splitGraph ?? data.architectureKnowledgeGraph,
    ) ?? undefined;

    const rawPackages = splitPackages.length > 0 ? splitPackages : data.publicationPackages;
    const publicationPackages = rawPackages !== undefined
        ? deserializePublicationPackages(rawPackages)
        : undefined;

    return { architectureKnowledgeGraph, publicationPackages };
};


const readArtifacts = async (projectId: string, embeddedArtifacts: unknown): Promise<Artifact[]> => {
    const artifactsSnapshot = await getDocs(collection(requireDb(db), PROJECTS_COLLECTION, projectId, ARTIFACTS_COLLECTION));
    const subcollectionArtifacts = artifactsSnapshot.docs.map((snap) => ({ ...snap.data(), id: snap.id }) as Artifact);
    if (subcollectionArtifacts.length > 0) return subcollectionArtifacts;
    return Array.isArray(embeddedArtifacts) ? embeddedArtifacts as Artifact[] : [];
};


const readProject = async (projectId: string): Promise<Project | undefined> => {
    const docRef = doc(requireDb(db), PROJECTS_COLLECTION, projectId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return undefined;
    const data = docSnap.data();
    const [artifacts, aggregates] = await Promise.all([
        readArtifacts(projectId, data.artifacts),
        readProjectAggregates(projectId, data),
    ]);
    const validation = validateProject(fromProjectSnapshot(docSnap.id, data, artifacts, {
        ...aggregates,
        artifactsLoaded: true,
        artifactIndex: artifacts.map(toArtifactSummary),
    }));
    if (!validation.value) {
        observabilityService.recordWarning({
            source: 'operation',
            title: 'Proyecto con datos corruptos',
            message: `El documento ${projectId} no superó la validación de esquema y no se cargó.`,
            metadata: { projectId, issueCount: validation.issues.length },
            recoverable: true,
            userVisible: true,
        });
        return undefined;
    }
    return validation.value;
};


export const getAllProjects = async (userId?: string, isAdmin?: boolean): Promise<Project[]> => {
    if (!userId && !isAdmin) {
        observabilityService.recordWarning({
            source: 'operation',
            title: 'getAllProjects bloqueado sin sesión',
            message: 'Se rechazó una consulta a /projects sin userId ni privilegios admin.',
            userVisible: false,
            recoverable: true,
        });
        return [];
    }

    const cacheKey = `projects_${userId || 'admin-all'}_${isAdmin ? 'admin' : 'user'}`;
    const cached = cache.get<Project[]>(cacheKey);
    if (cached) return cached;

    try {
        const q = isAdmin
            ? collection(requireDb(db), PROJECTS_COLLECTION)
            : query(collection(requireDb(db), PROJECTS_COLLECTION), where("userId", "==", userId));
        const querySnapshot = await getDocs(q);
        // The portfolio needs to know *which* artifacts exist, not what
        // they say. Reading the index instead of the subcollection is the
        // difference between one small document per project and every
        // artifact body in the account — which is what app startup used to
        // download before a single screen had rendered.
        //
        // Neither the dashboard nor the portfolio graph reads the
        // architecture graph or the publication packages, so those are not
        // fetched here either; `getProject` loads them when a project is
        // actually opened.
        const projects = (await Promise.all(querySnapshot.docs.map(async (snap) => {
            const data = snap.data();
            const artifactIndex = await readArtifactIndex(snap.id, data);
            if (artifactIndex) {
                return fromProjectSnapshot(snap.id, data, [], {
                    architectureKnowledgeGraph: deserializeArchitectureGraph(data.architectureKnowledgeGraph) ?? undefined,
                    artifactsLoaded: false,
                    artifactIndex,
                });
            }
            // No trusted index (legacy project, or one written before the
            // index existed): fall back to the previous behaviour rather
            // than report an empty project.
            const artifacts = await readArtifacts(snap.id, data.artifacts);
            return fromProjectSnapshot(snap.id, data, artifacts, {
                architectureKnowledgeGraph: deserializeArchitectureGraph(data.architectureKnowledgeGraph) ?? undefined,
                artifactsLoaded: true,
                artifactIndex: artifacts.map(toArtifactSummary),
            });
        }))).filter((project): project is Project => Boolean(project));

        const validation = validateProjects(projects);
        if (validation.issues.length > 0) {
            observabilityService.recordWarning({
                source: 'operation',
                title: 'Documentos de proyecto con campos faltantes',
                message: `Se sanearon ${validation.issues.length} validaciones al cargar /projects.`,
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
            message: 'La lectura desde Firestore falló. Solo se usará caché local de lectura si existe; no se simula persistencia remota.',
            operationName: 'getAllProjects',
            recoverable: true,
            userVisible: true,
            metadata: { errorCode: getErrorCode(error), status: classifyPersistenceError(error) },
        });
        const allProjects = readLocal<Project[]>(PROJECTS_COLLECTION) || [];
        return userId && !isAdmin ? allProjects.filter((p: Project & { userId?: string }) => p.userId === userId) : allProjects;
    }
};


export const getProject = async (projectId: string): Promise<Project | undefined> => {
    const cacheKey = `project_${projectId}`;
    const cached = cache.get<Project>(cacheKey);
    if (cached) return cached;

    try {
        const project = await readProject(projectId);
        if (project) cache.set(cacheKey, project);
        return project;
    } catch (error) {
        observabilityService.reportError(error, {
            source: 'operation',
            title: 'No se pudo cargar proyecto remoto',
            message: 'La lectura desde Firestore falló. Se intentará caché local de solo lectura si existe.',
            operationName: `getProject(${projectId})`,
            recoverable: true,
            userVisible: true,
            metadata: { projectId, errorCode: getErrorCode(error), status: classifyPersistenceError(error) },
        });
        const projects = readLocal<Project[]>(PROJECTS_COLLECTION) || [];
        return projects.find(p => p.id === projectId);
    }
};
