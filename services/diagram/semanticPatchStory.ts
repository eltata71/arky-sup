/**
 * Las operaciones de historia del motor de patches (plan de diagramas, 4.3).
 *
 * Escenas y mensaje: qué cuenta el diagrama y en qué orden lo recorre el modo
 * presentación. Viven aparte del motor porque son su propio vocabulario, pero
 * obedecen sus tres garantías: se comprueban antes de aplicarse, el resultado
 * es un IR válido (una escena nunca enfoca un id que no existe) y lo que no
 * cambia nada se rechaza como `no-effect`.
 *
 * La regla propia de este fichero: **toda operación de historia deja la
 * narrativa marcada `authored`** (`authorStory`), y si era la que compuso la
 * reparación a partir de la topología, su resumen se retira y se dice. Una
 * historia escrita gana a la derivada; una descripción derivada guardada bajo
 * ella se leería como el mensaje del arquitecto.
 */

import type {
    DiagramCallout,
    DiagramIR,
    DiagramIREdge,
    DiagramIRGroup,
    DiagramIRNode,
    DiagramPatchOperation,
    DiagramScene,
    PatchApplication,
    PatchRejection,
} from '../../lib/diagram';
import { MAX_STORY_STEPS } from './storyDerivation';

export interface Draft {
    nodes: DiagramIRNode[];
    edges: DiagramIREdge[];
    groups: DiagramIRGroup[];
    callouts: DiagramCallout[];
    scenes: DiagramScene[];
    /** The story's one sentence (`narrative.summary`). */
    summary: string | undefined;
    /** A scene lost a reference in a cascade: the scenes must be written back. */
    scenesTouched: boolean;
    /** A story operation applied: the narrative is now `authored` (4.3). */
    storyEdited: boolean;
    metadata: NonNullable<DiagramIR['metadata']>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** A removed element leaves the scenes that focused on it. Returns how many. */
export const dropFromScenes = (draft: Draft, matches: (id: string) => boolean, field: 'focusNodeIds' | 'focusEdgeIds'): number => {
    let touched = 0;
    for (const scene of draft.scenes) {
        const kept = (scene[field] ?? []).filter(id => !matches(id));
        if (kept.length !== (scene[field] ?? []).length) {
            scene[field] = kept;
            touched += 1;
        }
    }
    if (touched > 0) draft.scenesTouched = true;
    return touched;
};

/**
 * The first story operation on a narrative the repair pass composed turns it
 * into a written one, and the repair's summary goes: a topology description
 * kept under an architect's story would read as their message.
 */
export const authorStory = (draft: Draft): string[] => {
    if (draft.storyEdited) return [];
    draft.storyEdited = true;
    const narrative = draft.metadata.narrative;
    if (typeof narrative === 'object' && narrative?.source === 'derived' && draft.summary) {
        draft.summary = undefined;
        return ['El resumen derivado de la topología se retira: la historia pasa a ser escrita.'];
    }
    return [];
};

/** Keeps only the ids that exist; says how many it dropped. */
const knownFocus = (draft: Draft, scene: Partial<DiagramScene>) => {
    const nodes = new Set(draft.nodes.map(node => node.id));
    const edges = new Set(draft.edges.map(edge => edge.id));
    const focusNodeIds = (scene.focusNodeIds ?? []).filter(id => nodes.has(id));
    const focusEdgeIds = (scene.focusEdgeIds ?? []).filter(id => edges.has(id));
    const dropped = (scene.focusNodeIds ?? []).length + (scene.focusEdgeIds ?? []).length - focusNodeIds.length - focusEdgeIds.length;
    return { focusNodeIds, focusEdgeIds, dropped };
};

type StoryOperation = Extract<DiagramPatchOperation, { op: 'set-story-message' | 'add-scene' | 'update-scene' | 'remove-scene' | 'move-scene' }>;

export const applyStoryOperation = (
    draft: Draft,
    operation: StoryOperation,
    reject: (code: PatchRejection['code'], message: string) => PatchRejection,
    done: (description: string, cascaded?: string[]) => PatchApplication,
): PatchApplication | PatchRejection => {
    switch (operation.op) {
        case 'set-story-message': {
            const message = text(operation.message);
            const narrative = draft.metadata.narrative;
            const derived = typeof narrative === 'object' && narrative?.source === 'derived' && !draft.storyEdited;
            // Escribir la misma frase que compuso la reparación sí es un cambio:
            // la hace suya quien la escribe.
            if (message === text(draft.summary) && !(derived && message)) {
                return reject('no-effect', message ? 'La historia ya dice eso.' : 'La historia no tiene mensaje que retirar.');
            }
            const cascaded = authorStory(draft);
            draft.summary = message || undefined;
            return done(message ? 'Mensaje de la historia escrito.' : 'Mensaje de la historia retirado.', cascaded);
        }

        case 'add-scene': {
            const scene = operation.scene;
            const id = text(scene?.id);
            if (!id || !text(scene?.title)) return reject('invalid-shape', 'Una escena necesita id y título.');
            if (draft.scenes.some(candidate => candidate.id === id)) return reject('duplicate-id', `Ya existe una escena con id "${id}".`);
            if (draft.scenes.length >= MAX_STORY_STEPS) return reject('invalid-shape', `Una historia tiene como máximo ${MAX_STORY_STEPS} escenas.`);
            const { focusNodeIds, focusEdgeIds, dropped } = knownFocus(draft, scene);
            const at = Math.max(0, Math.min(operation.index ?? draft.scenes.length, draft.scenes.length));
            const cascaded = authorStory(draft);
            draft.scenes.splice(at, 0, { ...scene, id, title: text(scene.title), focusNodeIds, focusEdgeIds });
            if (dropped > 0) cascaded.push(`${dropped} id(s) inexistentes descartados del foco.`);
            return done(`Escena "${text(scene.title)}" añadida en la posición ${at + 1}.`, cascaded);
        }

        case 'update-scene': {
            const scene = draft.scenes.find(candidate => candidate.id === operation.sceneId);
            if (!scene) return reject('unknown-scene', `No existe la escena "${operation.sceneId}".`);
            const changes = { ...(operation.changes ?? {}) };
            if (Object.keys(changes).length === 0) return reject('no-effect', 'La operación no declara ningún cambio.');
            if ('title' in changes && !text(changes.title)) return reject('invalid-shape', 'Una escena necesita título.');
            const cascaded = authorStory(draft);
            if (changes.focusNodeIds || changes.focusEdgeIds) {
                const focus = knownFocus(draft, { focusNodeIds: changes.focusNodeIds ?? scene.focusNodeIds, focusEdgeIds: changes.focusEdgeIds ?? scene.focusEdgeIds });
                changes.focusNodeIds = focus.focusNodeIds;
                changes.focusEdgeIds = focus.focusEdgeIds;
                if (focus.dropped > 0) cascaded.push(`${focus.dropped} id(s) inexistentes descartados del foco.`);
            }
            Object.assign(scene, changes);
            return done(`Escena "${scene.title}" actualizada.`, cascaded);
        }

        case 'remove-scene': {
            const index_ = draft.scenes.findIndex(scene => scene.id === operation.sceneId);
            if (index_ < 0) return reject('unknown-scene', `No existe la escena "${operation.sceneId}".`);
            const cascaded = authorStory(draft);
            const [removed] = draft.scenes.splice(index_, 1);
            return done(`Escena "${removed.title}" eliminada.`, cascaded);
        }

        case 'move-scene': {
            const from = draft.scenes.findIndex(scene => scene.id === operation.sceneId);
            if (from < 0) return reject('unknown-scene', `No existe la escena "${operation.sceneId}".`);
            const to = Math.max(0, Math.min(Math.trunc(operation.toIndex), draft.scenes.length - 1));
            if (!Number.isFinite(to) || to === from) return reject('no-effect', 'La escena ya está en esa posición.');
            const cascaded = authorStory(draft);
            const [moved] = draft.scenes.splice(from, 1);
            draft.scenes.splice(to, 0, moved);
            return done(`Escena "${moved.title}" movida a la posición ${to + 1}.`, cascaded);
        }

    }
};
