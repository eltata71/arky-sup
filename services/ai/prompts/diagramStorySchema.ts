/**
 * The story half of the diagram contract: what the model is asked to say about
 * a diagram, beyond the boxes and the arrows.
 *
 * `metadata.narrative` used to be `string` in both halves of the contract —
 * the JSON the prompt prints and the schema the request enforces — while the
 * IR it fills has always been `string | DiagramNarrative`, with scenes bound
 * to node ids and callouts bound to elements. So the richer shape was
 * unreachable: the one component able to produce a story could only ever
 * return a sentence, and the guided walk, the highlights and the *narrativa*
 * dimension were left deriving from topology for every diagram in the product.
 *
 * This module is where the structured half lives, and it is a separate file
 * for a reason worth keeping: `diagramPrompts.ts` sits at its size ceiling,
 * and a prompt that grows by whatever the newest capability needs is how that
 * file got there. The metadata contract moved out whole rather than being
 * duplicated — there is still exactly one place that says what
 * `metadata` looks like, on both sides.
 *
 * **The model writes meaning, never geometry.** Scenes are ids and a title;
 * callouts are ids and a sentence. Nothing here lets a model choose a
 * position, a size or a colour — those belong to the layout engine and the
 * design system, and asking for them is how a diagram ends up with a story
 * nobody can lay out.
 */

/** The `metadata` block as it appears in the JSON the prompt prints. */
export const METADATA_CONTRACT = `  "metadata": {
    "audience": "executive" | "technical" | "operations",
    "title"?: string,
    "narrative"?: {
      "summary": string,
      "scenes"?: [{ "id": string, "title": string, "focusNodeIds": string[], "focusEdgeIds": string[], "insight"?: string }],
      "callouts"?: [{ "id": string, "targetId": string, "targetKind": "node" | "edge", "text": string, "severity"?: "info" | "warning" | "critical" }]
    },
    "diagramType"?: "c4-context" | "c4-container" | "c4-component" | "c4-deployment" | "integration" | "bpmn-process" | "value-stream" | "data-flow" | "deployment" | "sequence" | "erd" | "generic"
  },`;

/**
 * What the model is told about the story, in the prompt body.
 *
 * Three of these rules exist because the alternative is a story that reads
 * well and cannot be shown: a scene naming a node that is not in `nodes`
 * highlights nothing, a callout with no target is a floating sentence, and a
 * summary that describes the picture instead of arguing about it is the
 * caption a reader can already see.
 */
export const STORY_INSTRUCTIONS = `NARRATIVA (metadata.narrative) — obligatoria y estructurada:
- "summary": UNA frase que diga qué SOSTIENE el diagrama (el mensaje), no qué contiene. "El cobro depende de un único proveedor externo" sí; "diagrama de la plataforma de pagos" no.
- "scenes": entre 2 y 6 pasos que guíen la lectura de principio a fin. Cada uno con "focusNodeIds" y "focusEdgeIds" tomados EXACTAMENTE de los ids que declaraste arriba. Un id inventado deja el paso sin nada que resaltar.
- "callouts": como máximo 4, y sólo donde haya algo que un lector podría pasar por alto: un riesgo, una decisión, un punto único de fallo, un límite de confianza. Cada uno apunta a un "targetId" existente.
- No describas posiciones, tamaños, colores ni disposición: de eso se encarga el motor de layout.`;

/** The `metadata` object of the structured-output schema. */
export const METADATA_SCHEMA = {
    type: 'object',
    properties: {
        audience: { type: 'string', enum: ['executive', 'technical', 'operations'] },
        title: { type: 'string' },
        narrative: {
            type: 'object',
            properties: {
                summary: { type: 'string' },
                scenes: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            title: { type: 'string' },
                            focusNodeIds: { type: 'array', items: { type: 'string' } },
                            focusEdgeIds: { type: 'array', items: { type: 'string' } },
                            insight: { type: 'string' },
                        },
                        required: ['id', 'title', 'focusNodeIds'],
                    },
                },
                callouts: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            targetId: { type: 'string' },
                            targetKind: { type: 'string', enum: ['node', 'edge'] },
                            text: { type: 'string' },
                            severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
                        },
                        required: ['id', 'targetId', 'text'],
                    },
                },
            },
            required: ['summary'],
        },
        // Gap 6: explicit diagram archetype so validators and the layout
        // selector can apply rules without re-inferring.
        diagramType: {
            type: 'string',
            enum: [
                'c4-context', 'c4-container', 'c4-component', 'c4-deployment',
                'integration', 'bpmn-process', 'value-stream', 'data-flow',
                'deployment', 'sequence', 'erd', 'generic',
            ],
        },
    },
} as const;
