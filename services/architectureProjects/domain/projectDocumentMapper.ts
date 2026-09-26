/**
 * Cómo un `Project` se convierte en la carga que la RPC guarda, y vuelve.
 *
 * Es mapeo, no reglas de negocio, pero es mapeo **de este agregado**: sabe qué
 * campos viajan dentro del documento del proyecto, cuál se ha sacado a su
 * propia tabla porque es derivado, y cómo se resume un artefacto en el índice
 * que las pantallas de portafolio leen en vez de cargar los artefactos enteros.
 *
 * `services/artifacts` importa de aquí, y no al revés: un artefacto es una
 * entidad **dentro** del agregado Proyecto, así que el vocabulario del índice
 * (`ArtifactSummary`) es de este contexto.
 *
 * `stripUndefined` (en `lib/jsonSafe`) reemplaza a `sanitizeForFirestore`: hace
 * lo único que sigue haciendo falta —quitar los `undefined`, que
 * `JSON.stringify` trata de dos formas distintas según estén en un objeto o en
 * un array— sin el resto de reglas que existían por el modelo de documentos de
 * Firestore.
 */

import type { Artifact } from '../../../lib/artifacts';
import type { Project, ProjectRoot, ArtifactSummary } from './ArchitectureProjectTypes';
import { sanitizeMemoryEntryList } from '../../memory/memoryEntries';
import { toInitiativeCodes as normalizeBusinessProjectIds } from '../../../lib/eaTerminology';
import { normalizeAttentionTracking } from './projectRuntimeValidation';
import type { ArchitectureGraph } from '../../architectureKnowledgeGraph';
import type { PublicationPackage } from '../../publicationPipeline/PublicationPipelineTypes';
import { stripUndefined as sanitize } from '../../../lib/jsonSafe';

/**
 * Documento remoto **leído**: lo que la RPC devuelve dentro de `data`. Sin
 * tipo a propósito —puede venir de un esquema anterior o editado a mano—; lo
 * vuelven utilizable `toProjectRoot` y la validación de lectura.
 */
export type ProjectDocument = Record<string, unknown>;

/**
 * Documento **escrito**: exactamente lo que `api.save_project` recibe (F4-04).
 *
 * Tres formas del mismo proyecto, cada una con su trabajo: `ProjectRoot` es el
 * agregado, esto es su forma persistida, y `Project` es lo que ve una pantalla.
 * Aquí no hay artefactos, índice, contador, grafo ni revisión: la revisión viaja
 * como argumento de la RPC, y lo demás lo escribe quien es su dueño.
 */
export interface PersistedProjectDocument {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly projectContext: string[];
    readonly initiativeIds: string[];
    readonly linkedBusinessProjects: string[];
    readonly agentMemory: string[];
    readonly initialCapture: string[];
    readonly projectContextEntries?: ProjectRoot['projectContextEntries'];
    readonly agentMemoryEntries?: ProjectRoot['agentMemoryEntries'];
    readonly initialCaptureEntries?: ProjectRoot['initialCaptureEntries'];
    readonly publicationPackages?: ProjectRoot['publicationPackages'];
    readonly attention?: ProjectRoot['attention'];
    readonly userId?: string;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export const toProjectDocument = (project: ProjectRoot & { userId?: string }): PersistedProjectDocument => sanitize({
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
    // `sanitize` drops them cleanly when absent (legacy).
    projectContextEntries: project.projectContextEntries,
    agentMemoryEntries: project.agentMemoryEntries,
    initialCaptureEntries: project.initialCaptureEntries,
    // `architectureKnowledgeGraph` is deliberately absent: it is derived data
    // that rebuilds from the artifacts and grows with their number, so it lives
    // in `api.architecture_knowledge_graphs` and travels on its own RPC.
    // `publicationPackages` do ride here — they are small governance records
    // and a row has no 1 MiB budget to share.
    publicationPackages: project.publicationPackages,
    // Attention tracking was absent by mistake once — a project created with
    // `attention` set lost it silently, because only the `updateProject` path
    // ever persisted it.
    attention: project.attention,
    userId: project.userId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
});

export interface ProjectAggregates {
    architectureKnowledgeGraph?: ArchitectureGraph;
    publicationPackages?: PublicationPackage[];
    /** False on the portfolio path, where only the index was read. */
    artifactsLoaded?: boolean;
    artifactIndex?: ArtifactSummary[];
}

/** La raíz, leída de un documento que puede venir de cualquier versión. */
export const toProjectRoot = (id: string, data: ProjectDocument): ProjectRoot => ({
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
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
    // La lectura la devuelve desde F4-03; viaja con el registro (F4-07).
    revision: typeof data.revision === 'number' && Number.isInteger(data.revision) && data.revision > 0
        ? data.revision
        : undefined,
});

/**
 * El modelo de lectura: la raíz, sus artefactos y sus proyecciones (F4-04).
 *
 * `artifactCount` sale del documento cuando lo trae —lo recalcula el servidor—
 * y de los artefactos cuando no. Los paquetes y el grafo los resuelve quien
 * llama: los paquetes vienen del documento, el grafo de su propia RPC.
 */
export const toProjectView = (
    root: ProjectRoot,
    artifacts: Artifact[],
    aggregates: ProjectAggregates = {},
    artifactCount?: number,
): Project => ({
    ...root,
    architectureKnowledgeGraph: aggregates.architectureKnowledgeGraph,
    publicationPackages: aggregates.publicationPackages,
    artifacts,
    // Load state travels with the record so no screen can mistake "not loaded
    // yet" for "there are none".
    artifactsLoaded: aggregates.artifactsLoaded ?? true,
    artifactIndex: aggregates.artifactIndex,
    artifactCount: artifactCount ?? artifacts.length,
});

/** Documento leído + artefactos → lo que una pantalla ve. */
export const fromProjectSnapshot = (
    id: string,
    data: ProjectDocument,
    artifacts: Artifact[],
    aggregates: ProjectAggregates = {},
): Project => toProjectView(
    toProjectRoot(id, data),
    artifacts,
    aggregates,
    typeof data.artifactCount === 'number' ? data.artifactCount : undefined,
);

/** Identity of one artifact, without its body. */
export const toArtifactSummary = (artifact: Artifact): ArtifactSummary => sanitize({
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
