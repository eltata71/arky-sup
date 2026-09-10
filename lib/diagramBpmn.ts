/**
 * BPMN 2.0 element detection and visual tokens.
 *
 * Used by `CustomNode` (and indirectly by the export frame legend) to
 * recognise BPMN-specific intents and pick the right visual treatment:
 *
 *  - Start Event        → green circle, thin border.
 *  - End Event          → red circle, thick border.
 *  - Intermediate Event → grey circle (double ring).
 *  - Task               → rounded rectangle (the default).
 *  - User Task          → person glyph in the header.
 *  - Service Task       → cog glyph.
 *  - Manual Task        → hand glyph.
 *  - Business Rule Task → table / rule glyph.
 *  - Gateway X          → diamond, "X" decoration.
 *  - Gateway +          → diamond, "+" decoration.
 *  - Gateway O          → diamond, "O" decoration (inclusive).
 *  - Event Gateway      → diamond with circle decoration.
 *  - Data Object        → page with folded corner.
 *  - Data Store         → cylinder with stack indicator.
 *  - Annotation         → bracketed note (no participant).
 *
 * The detector reads `kind`, `semanticType`, `label` and `technology` so it
 * tolerates the various dialects emitted by the AI (kebab/snake-case,
 * Spanish/English).
 */

export type BpmnElement =
    | 'start-event'
    | 'end-event'
    | 'intermediate-event'
    | 'task'
    | 'user-task'
    | 'service-task'
    | 'manual-task'
    | 'business-rule-task'
    | 'gateway-exclusive'
    | 'gateway-parallel'
    | 'gateway-inclusive'
    | 'gateway-event-based'
    | 'data-object'
    | 'data-store'
    | 'annotation'
    | null;

/**
 * BPMN 2.0 edge / flow types. Each value maps to a distinct visual
 * treatment in {@link components/CustomEdge.tsx}:
 *
 *  - `sequence-flow`     — solid line, solid arrow (default for flow).
 *  - `message-flow`      — dashed line, hollow arrow + circle at origin
 *                          (BPMN convention for cross-participant flow).
 *  - `association`       — dotted line, no arrow (or light arrow); used
 *                          for data objects, annotations, references.
 *  - `conditional-flow`  — solid line with a diamond marker at the origin
 *                          and the condition rendered as the label.
 *  - `default-flow`      — solid line with a tick-mark (`/`) at the
 *                          origin to indicate the "default" branch of a
 *                          gateway.
 */
export type BpmnFlowType =
    | 'sequence-flow'
    | 'message-flow'
    | 'association'
    | 'conditional-flow'
    | 'default-flow';

interface BpmnSignals {
    kind?: string | null;
    label?: string | null;
    semanticType?: string | null;
    technology?: string | null;
    description?: string | null;
}

interface BpmnEdgeSignals {
    semanticType?: string | null;
    relation?: string | null;
    label?: string | null;
    bpmnFlowType?: string | null;
    messageFlow?: boolean | null;
    sequenceFlow?: boolean | null;
    association?: boolean | null;
    condition?: string | null;
    defaultFlow?: boolean | null;
    crossLane?: boolean | null;
}

function normalise(value: string | null | undefined): string {
    return (value ?? '').toString().trim().toLowerCase();
}

export function detectBpmnElement(signals: BpmnSignals): BpmnElement {
    const k = normalise(signals.kind);
    const s = normalise(signals.semanticType);
    const l = normalise(signals.label);
    const blob = `${k} ${s} ${l} ${normalise(signals.technology)} ${normalise(signals.description)}`;

    // Highest precedence: explicit BPMN kind tokens.
    if (/(^|\b)(start[\s_-]?event|start)\b/.test(k) || /(^|\b)(start[\s_-]?event)\b/.test(s)) return 'start-event';
    if (/(^|\b)(end[\s_-]?event|end)\b/.test(k) || /(^|\b)(end[\s_-]?event)\b/.test(s)) return 'end-event';
    if (/(^|\b)(intermediate[\s_-]?event|intermediate)\b/.test(k)) return 'intermediate-event';
    if (/(^|\b)(user[\s_-]?task)\b/.test(k) || /(^|\b)(user[\s_-]?task)\b/.test(s)) return 'user-task';
    if (/(^|\b)(service[\s_-]?task|automated[\s_-]?task)\b/.test(k) || /(^|\b)(service[\s_-]?task)\b/.test(s)) return 'service-task';
    if (/(^|\b)(manual[\s_-]?task)\b/.test(k) || /(^|\b)(manual[\s_-]?task)\b/.test(s)) return 'manual-task';
    if (/(^|\b)(business[\s_-]?rule[\s_-]?task|rule[\s_-]?task)\b/.test(k) || /(^|\b)(business[\s_-]?rule[\s_-]?task)\b/.test(s)) return 'business-rule-task';
    if (/(^|\b)(event[\s_-]?based[\s_-]?gateway|event[\s_-]?gateway)\b/.test(k)) return 'gateway-event-based';
    if (/(^|\b)(exclusive[\s_-]?gateway|gateway[\s_-]?exclusive|xor[\s_-]?gateway)\b/.test(k)) return 'gateway-exclusive';
    if (/(^|\b)(parallel[\s_-]?gateway|gateway[\s_-]?parallel|and[\s_-]?gateway)\b/.test(k)) return 'gateway-parallel';
    if (/(^|\b)(inclusive[\s_-]?gateway|gateway[\s_-]?inclusive|or[\s_-]?gateway)\b/.test(k)) return 'gateway-inclusive';
    if (/(^|\b)(data[\s_-]?object|data[\s_-]?input|data[\s_-]?output|document)\b/.test(k) || /(^|\b)(data[\s_-]?object)\b/.test(s)) return 'data-object';
    if (/(^|\b)(data[\s_-]?store|datastore|data[\s_-]?storage)\b/.test(k) || /(^|\b)(data[\s_-]?store)\b/.test(s)) return 'data-store';
    if (/(^|\b)(annotation|text[\s_-]?annotation|note|comment)\b/.test(k) || /(^|\b)(annotation|text[\s_-]?annotation)\b/.test(s)) return 'annotation';
    if (/(^|\b)(task|activity)\b/.test(k) || /(^|\b)(business[\s_-]?process)\b/.test(s)) return 'task';

    // Fallback heuristics on the combined label/description.
    if (/\b(inicio|comienzo|trigger|start)\b/.test(blob)) return 'start-event';
    if (/\b(fin|t[eé]rmino|cierre|stop|end)\b/.test(blob)) return 'end-event';
    if (/\b(decisi[oó]n|exclusiv|xor)\b/.test(blob)) return 'gateway-exclusive';
    if (/\b(paralel|fork|join|split|and[-\s]gateway|parallel)\b/.test(blob)) return 'gateway-parallel';
    if (/\b(inclusiv|or[-\s]gateway)\b/.test(blob)) return 'gateway-inclusive';
    if (/\b(user[\s-]?task|tarea[\s-]?usuario)\b/.test(blob)) return 'user-task';
    if (/\b(service[\s-]?task|tarea[\s-]?servicio)\b/.test(blob)) return 'service-task';
    if (/\b(manual[\s-]?task|tarea[\s-]?manual)\b/.test(blob)) return 'manual-task';
    if (/\b(business[\s-]?rule|regla[\s-]?negocio|drools|dmn)\b/.test(blob)) return 'business-rule-task';
    if (/\b(data[\s-]?object|documento|formulario)\b/.test(blob)) return 'data-object';
    if (/\b(data[\s-]?store|repositorio[\s-]?datos|almacen[\s-]?datos)\b/.test(blob)) return 'data-store';
    if (/\b(annotation|nota|coment|aclaraci[oó]n)\b/.test(blob)) return 'annotation';
    return null;
}

/**
 * Detect the BPMN flow type for an edge.
 *
 * Reads explicit metadata first (the IR pipeline / suggestion executors
 * set `bpmnFlowType`, `messageFlow`, `sequenceFlow`, `association`,
 * `defaultFlow`); falls back to label heuristics, then to a structural
 * hint (`crossLane === true` ⇒ message flow). Returns `null` when there
 * is no evidence the diagram is BPMN — callers should keep the legacy
 * relation-based styling in that case.
 */
export function detectBpmnFlowType(signals: BpmnEdgeSignals): BpmnFlowType | null {
    const explicit = normalise(signals.bpmnFlowType);
    if (explicit === 'sequence' || explicit === 'sequence-flow' || explicit === 'sequence_flow') return 'sequence-flow';
    if (explicit === 'message' || explicit === 'message-flow' || explicit === 'message_flow') return 'message-flow';
    if (explicit === 'association') return 'association';
    if (explicit === 'conditional' || explicit === 'conditional-flow' || explicit === 'conditional_flow') return 'conditional-flow';
    if (explicit === 'default' || explicit === 'default-flow' || explicit === 'default_flow') return 'default-flow';

    if (signals.messageFlow === true) return 'message-flow';
    if (signals.sequenceFlow === true) return 'sequence-flow';
    if (signals.association === true) return 'association';
    if (signals.defaultFlow === true) return 'default-flow';
    if (typeof signals.condition === 'string' && signals.condition.trim().length > 0) return 'conditional-flow';

    const sem = normalise(signals.semanticType);
    const rel = normalise(signals.relation);
    const label = normalise(signals.label);

    if (/(message|async[\s_-]?messaging|publish|subscribe|event|notification)/.test(sem)) return 'message-flow';
    if (rel === 'async') return 'message-flow';
    if (/(asociaci|association|dependency|reference)/.test(sem) || rel === 'dependency') return 'association';
    if (/(default|por[\s_-]?defecto|else|otherwise)/.test(label)) return 'default-flow';
    if (/(sequence|secuencia)/.test(sem)) return 'sequence-flow';

    // Structural hint: cross-lane edges in BPMN should be message flows.
    if (signals.crossLane === true) return 'message-flow';

    return null;
}

/**
 * Colour palette per BPMN element. Pure tokens — the renderer composites
 * them through gradient helpers.
 */
export const BPMN_PALETTE: Record<NonNullable<BpmnElement>, { stroke: string; bg: string; accent: string; label: string }> = {
    'start-event':         { stroke: '#10b981', bg: '#ecfdf5', accent: '#059669', label: 'Inicio' },
    'end-event':           { stroke: '#ef4444', bg: '#fef2f2', accent: '#b91c1c', label: 'Fin' },
    'intermediate-event':  { stroke: '#a3a3a3', bg: '#f5f5f5', accent: '#525252', label: 'Evento' },
    'task':                { stroke: '#3b82f6', bg: '#eff6ff', accent: '#1d4ed8', label: 'Tarea' },
    'user-task':           { stroke: '#8b5cf6', bg: '#f5f3ff', accent: '#6d28d9', label: 'Tarea (Usuario)' },
    'service-task':        { stroke: '#0ea5e9', bg: '#f0f9ff', accent: '#0369a1', label: 'Tarea (Servicio)' },
    'manual-task':         { stroke: '#f97316', bg: '#fff7ed', accent: '#c2410c', label: 'Tarea (Manual)' },
    'business-rule-task':  { stroke: '#a16207', bg: '#fefce8', accent: '#854d0e', label: 'Tarea (Regla)' },
    'gateway-exclusive':   { stroke: '#f59e0b', bg: '#fffbeb', accent: '#b45309', label: 'Gateway exclusivo' },
    'gateway-parallel':    { stroke: '#6366f1', bg: '#eef2ff', accent: '#4338ca', label: 'Gateway paralelo' },
    'gateway-inclusive':   { stroke: '#0d9488', bg: '#f0fdfa', accent: '#0f766e', label: 'Gateway inclusivo' },
    'gateway-event-based': { stroke: '#7c3aed', bg: '#faf5ff', accent: '#6d28d9', label: 'Gateway de evento' },
    'data-object':         { stroke: '#0891b2', bg: '#ecfeff', accent: '#155e75', label: 'Data Object' },
    'data-store':          { stroke: '#0e7490', bg: '#cffafe', accent: '#0e7490', label: 'Data Store' },
    'annotation':          { stroke: '#64748b', bg: '#f8fafc', accent: '#475569', label: 'Anotación' },
};

/**
 * Visual tokens per BPMN flow type. Consumed by {@link components/CustomEdge.tsx}.
 *
 *  - `strokeWidth`: base stroke weight in pixels.
 *  - `dash`: SVG dasharray (`undefined` = solid).
 *  - `marker`: arrowhead style (`solid` = solid triangle, `hollow` =
 *    open triangle for message flow, `none` = no marker for association).
 *  - `originBadge`: optional decoration at the source end (`circle` for
 *    message flow, `tick` for default flow, `diamond` for conditional).
 *  - `light` / `dark`: themed stroke colours.
 */
export const BPMN_FLOW_TOKENS: Record<BpmnFlowType, {
    strokeWidth: number;
    dash: string | undefined;
    marker: 'solid' | 'hollow' | 'none';
    originBadge?: 'circle' | 'tick' | 'diamond';
    label: string;
    light: string;
    dark: string;
}> = {
    'sequence-flow': {
        strokeWidth: 2,
        dash: undefined,
        marker: 'solid',
        label: 'Flujo de secuencia',
        light: '#1e293b',
        dark: '#e2e8f0',
    },
    'message-flow': {
        strokeWidth: 1.6,
        dash: '8 5',
        marker: 'hollow',
        originBadge: 'circle',
        label: 'Flujo de mensaje',
        light: '#2563eb',
        dark: '#93c5fd',
    },
    'association': {
        strokeWidth: 1.2,
        dash: '2 4',
        marker: 'none',
        label: 'Asociación',
        light: '#64748b',
        dark: '#cbd5e1',
    },
    'conditional-flow': {
        strokeWidth: 2,
        dash: undefined,
        marker: 'solid',
        originBadge: 'diamond',
        label: 'Flujo condicional',
        light: '#0f766e',
        dark: '#5eead4',
    },
    'default-flow': {
        strokeWidth: 2,
        dash: undefined,
        marker: 'solid',
        originBadge: 'tick',
        label: 'Flujo por defecto',
        light: '#475569',
        dark: '#cbd5e1',
    },
};
