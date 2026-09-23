/**
 * "Resalta únicamente el flujo de autorización" — asked of a model, answered
 * as a patch.
 *
 * Until this existed, every AI-assisted change to a diagram was a
 * regeneration: the model was handed the brief and produced a whole new IR,
 * with new ids, a new layout and none of the architect's manual work. A
 * request to emphasise one path cost the diagram. So the product had an
 * assistant that could only start over, and the honest advice was to edit by
 * hand.
 *
 * Four properties, and each is a decision:
 *
 * 1. **One agent, one call.** Changing a diagram is a single-domain task with
 *    one acceptance criterion — did it do what was asked, and is the result
 *    still a valid diagram. The Office's team is for a question answered from
 *    several domains at once; this is not one. Same reasoning as assisted
 *    capture, and `docs/agentes-anthropic-alineacion.md` records it.
 *
 * 2. **It proposes; it never writes.** The result is a `DiagramPatch` plus the
 *    preview of what applying it would do. Whoever confirms is whoever signs —
 *    the rule the capture assistant already holds, and it matters more here
 *    because a patch can delete.
 *
 * 3. **The model works in ids, never in geometry.** The prompt hands it the
 *    diagram as ids and labels and takes back operations over those ids. It
 *    cannot set a position, a size or a colour, because
 *    `DiagramPatchOperation` has no way to say one — the layout engine and the
 *    design system keep those, and a model that could overrule either from
 *    inside a JSON payload would be the "AI decides geometry" failure this
 *    codebase is built to avoid.
 *
 * 4. **Everything is checked deterministically afterwards.** The engine
 *    validates every reference and reports every cascade. A model's plausible
 *    JSON never reaches the canvas unexamined, and an operation it invented
 *    over a node that does not exist comes back as a rejection the user reads
 *    rather than a dangling edge they discover later.
 *
 * It degrades, never blocks: every failure returns `ok: false` with a Spanish
 * sentence, and the diagram is exactly as it was.
 */

import type { DiagramIR, DiagramPatch, DiagramPatchResult } from '../../../../lib/diagram';
import { resolveEffectiveModel } from '../../../../lib/ai/modelCatalog';
// Through the barrel, not the file: this vertical is lazy, and the engine's
// public surface is the whole point — a second entrance to the applier would
// be a second set of invariants, and only one of them is the one the lint
// rules check.
import { applySemanticPatch } from '../../../diagram';
import { aiGateway } from '../aiGateway';
import { defineSchema, parseStructured } from '../../structuredOutput';
import type { Settings } from '../../../../types';

/** How many operations a single request may propose before it stops being an
 *  edit and becomes a rewrite with extra steps. */
export const MAX_PATCH_OPERATIONS = 12;

export interface DiagramEditRequest {
    ir: DiagramIR;
    /** What the architect asked for, in their own words. */
    instruction: string;
    /** Optional extra grounding — the artifact's objective, the project brief. */
    context?: string;
}

export interface DiagramEditResult {
    ok: boolean;
    /** The proposal, unapplied. `null` when nothing usable came back. */
    patch: DiagramPatch | null;
    /** What applying it would do, from the engine itself — never from the model. */
    preview: DiagramPatchResult | null;
    reason?: string;
}

const PATCH_SCHEMA = defineSchema({
    type: 'object',
    required: ['operations'],
    properties: {
        rationale: { type: 'string' },
        operations: {
            type: 'array',
            items: {
                type: 'object',
                required: ['op'],
                properties: {
                    op: {
                        type: 'string',
                        enum: [
                            'add-node', 'remove-node', 'update-node',
                            'add-edge', 'remove-edge', 'update-edge',
                            'group-nodes', 'ungroup', 'add-to-group', 'remove-from-group',
                            'add-callout', 'remove-callout', 'set-layout-hint',
                        ],
                    },
                    nodeId: { type: 'string' },
                    edgeId: { type: 'string' },
                    groupId: { type: 'string' },
                    calloutId: { type: 'string' },
                    nodeIds: { type: 'array', items: { type: 'string' } },
                    direction: { type: 'string', enum: ['TB', 'LR', 'BT', 'RL'] },
                    density: { type: 'string', enum: ['compact', 'normal', 'spacious'] },
                    node: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            label: { type: 'string' },
                            kind: { type: 'string' },
                            description: { type: 'string' },
                            technology: { type: 'string' },
                            criticality: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                        },
                    },
                    edge: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            source: { type: 'string' },
                            target: { type: 'string' },
                            label: { type: 'string' },
                            protocol: { type: 'string' },
                            criticality: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                        },
                    },
                    group: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            label: { type: 'string' },
                            nodeIds: { type: 'array', items: { type: 'string' } },
                            kind: { type: 'string' },
                        },
                    },
                    callout: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            targetId: { type: 'string' },
                            targetKind: { type: 'string', enum: ['node', 'edge'] },
                            text: { type: 'string' },
                            severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
                        },
                    },
                    changes: { type: 'object' },
                },
            },
        },
    },
});

/**
 * The diagram as the model sees it: ids, labels and relations, and nothing
 * about how it is drawn. Positions are deliberately excluded — a model shown
 * coordinates starts reasoning about them.
 */
const describeDiagram = (ir: DiagramIR): string => [
    'NODOS (id — etiqueta [tipo]):',
    ...ir.nodes.map(node => `- ${node.id} — ${node.label} [${node.kind}]${node.criticality ? ` (criticidad ${node.criticality})` : ''}`),
    '',
    'CONEXIONES (id: origen → destino — etiqueta):',
    ...(ir.edges.length > 0
        ? ir.edges.map(edge => `- ${edge.id}: ${edge.source} → ${edge.target} — ${edge.label || '(sin etiqueta)'}`)
        : ['- (ninguna)']),
    '',
    'AGRUPACIONES (id — etiqueta: miembros):',
    ...(ir.groups.length > 0
        ? ir.groups.map(group => `- ${group.id} — ${group.label}: ${group.nodeIds.join(', ')}`)
        : ['- (ninguna)']),
].join('\n');

const buildPrompt = (request: DiagramEditRequest): string => [
    'Eres un arquitecto que edita un diagrama existente. NO lo regeneres: propón el cambio MÍNIMO que cumpla lo que se te pide.',
    '',
    'DIAGRAMA ACTUAL:',
    describeDiagram(request.ir),
    ...(request.context ? ['', 'CONTEXTO:', request.context] : []),
    '',
    `PETICIÓN: ${request.instruction.trim()}`,
    '',
    'REGLAS:',
    '- Usa EXACTAMENTE los ids de arriba. Un id inventado hace que la operación se rechace.',
    '- Un id nuevo (para add-node / add-edge / group-nodes) debe ser kebab-case y no existir ya.',
    '- No describas posiciones, tamaños ni colores: de eso se encargan el motor de layout y el sistema de diseño. No tienes forma de expresarlos.',
    `- Como máximo ${MAX_PATCH_OPERATIONS} operaciones. Si hacen falta más, la petición es una regeneración y no un cambio: propón las más importantes y dilo en "rationale".`,
    '- Para destacar un flujo, sube la "criticality" de sus conexiones con update-edge y añade a lo sumo una anotación; no borres lo que no estorba.',
    '- Si la petición no se puede cumplir sobre este diagrama, devuelve "operations": [] y explica por qué en "rationale".',
    '',
    'Responde EXCLUSIVAMENTE con este JSON:',
    '{ "rationale": "una línea explicando el cambio", "operations": [{ "op": "…", … }] }',
].join('\n');

const buildPatchId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `dp-${crypto.randomUUID()}`;
    return `dp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

/**
 * Take only what the vocabulary allows, and only as much of it as a single
 * edit may contain. Nothing here decides whether an operation is *valid* —
 * that is the engine's job, over ids it can actually check.
 */
const normalizePatch = (raw: unknown): DiagramPatch | null => {
    if (!raw || typeof raw !== 'object') return null;
    const payload = raw as { operations?: unknown; rationale?: unknown };
    if (!Array.isArray(payload.operations)) return null;
    const operations = payload.operations
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
        .filter(entry => typeof entry.op === 'string')
        .slice(0, MAX_PATCH_OPERATIONS) as DiagramPatch['operations'];
    return {
        id: buildPatchId(),
        source: 'ai',
        rationale: typeof payload.rationale === 'string' && payload.rationale.trim()
            ? payload.rationale.trim()
            : undefined,
        operations,
    };
};

export const diagramEditService = {
    /**
     * Ask for a patch and return it together with the deterministic preview of
     * what applying it would do. Never applies anything; never throws.
     */
    async proposeEdit(
        request: DiagramEditRequest,
        settings: Settings,
        options: { signal?: AbortSignal } = {},
    ): Promise<DiagramEditResult> {
        if (!request.ir || request.ir.nodes.length === 0) {
            return { ok: false, patch: null, preview: null, reason: 'No hay diagrama que editar.' };
        }
        if (!request.instruction?.trim()) {
            return { ok: false, patch: null, preview: null, reason: 'Describe qué quieres cambiar.' };
        }

        try {
            const model = resolveEffectiveModel('default', settings).id;
            const response = await aiGateway.generateContent(
                settings,
                model,
                buildPrompt(request),
                { responseMimeType: 'application/json', responseSchema: PATCH_SCHEMA, temperature: 0.2 },
                { signal: options.signal },
            );

            const parsed = parseStructured<unknown>(response.text);
            if (!parsed.ok) {
                return { ok: false, patch: null, preview: null, reason: 'La propuesta llegó en un formato que no se pudo interpretar. Vuelve a intentarlo.' };
            }

            const patch = normalizePatch(parsed.value);
            if (!patch || patch.operations.length === 0) {
                return {
                    ok: false,
                    patch,
                    preview: null,
                    reason: patch?.rationale ?? 'El asistente no encontró un cambio que proponer para esa petición.',
                };
            }

            // The preview comes from the engine, run against a copy — not from
            // the model's own account of what it did. A proposal that describes
            // one change and encodes another is exactly what a preview exists
            // to catch, and a summary written by the proposer cannot catch it.
            const preview = applySemanticPatch(request.ir, patch);
            if (!preview.changed) {
                return {
                    ok: false,
                    patch,
                    preview,
                    reason: 'Ninguna de las operaciones propuestas es aplicable a este diagrama.',
                };
            }
            return { ok: true, patch, preview };
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return { ok: false, patch: null, preview: null, reason: '' };
            }
            return { ok: false, patch: null, preview: null, reason: 'El asistente no está disponible ahora. Puedes editar el diagrama a mano.' };
        }
    },
} as const;

export type DiagramEditService = typeof diagramEditService;
