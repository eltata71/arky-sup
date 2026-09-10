/**
 * Accessible textual summary of a diagram.
 *
 * Closes the WCAG 2.2 AA gap on the canvas: ReactFlow renders a graph of
 * `<div>` cards and inline SVG paths that screen readers cannot
 * meaningfully interpret. This module produces a plain-text alternative
 * that captures the diagram's intent in a way assistive tech can read
 * linearly — and that is also useful as:
 *
 *   - an `aria-description` for the ReactFlow root,
 *   - a copy-paste handoff to people working without the visual tool,
 *   - a text companion appended to the PNG export bundle,
 *   - a fallback when the model didn't author a narrative.
 *
 * Pure, deterministic, side-effect free.
 */

import type { DiagramAudience, DiagramIR, DiagramIRNode, DiagramNarrative } from '../../lib/diagram';
import { detectDiagramArchetype, type DiagramArchetype } from './diagramTypeQualityGates';
import { detectSemanticRole } from '../../lib/diagramTokens';

export interface AccessibleSummaryOptions {
    /** Audience to colour the language — affects verbs and verbosity. */
    audience?: DiagramAudience;
    /** Maximum nodes named individually before collapsing the rest into a tail count. */
    maxNamedNodes?: number;
    /** Maximum edges named individually. */
    maxNamedEdges?: number;
}

export interface AccessibleSummary {
    /** One-paragraph summary (title + archetype + headline counts). Suitable for `aria-description`. */
    headline: string;
    /** Bulleted list of the most important nodes (Person, Gateway, Data first). */
    keyNodes: string[];
    /** Bulleted list of the most important edges (critical/labelled/protocol-bearing first). */
    keyFlows: string[];
    /** Group/boundary list (Capa de Datos, Sistemas Externos…). */
    boundaries: string[];
    /** Full multi-paragraph plain text. Suitable for sr-only descriptions and export companion. */
    fullText: string;
}

const ARCHETYPE_LABEL: Record<DiagramArchetype, string> = {
    context:    'Diagrama de Contexto C4',
    container:  'Diagrama de Contenedores C4',
    component:  'Diagrama de Componentes C4',
    integration:'Diagrama de Integración',
    process:    'Diagrama de Proceso (BPMN)',
    data:       'Diagrama de Datos',
    deployment: 'Diagrama de Despliegue',
    sequence:   'Diagrama de Secuencia',
    generic:    'Diagrama de arquitectura',
};

const AUDIENCE_OPENERS: Record<DiagramAudience, (n: number, archetype: string) => string> = {
    executive:   (n, a) => `${a} con ${n} elementos principales para audiencia ejecutiva.`,
    technical:   (n, a) => `${a} técnico con ${n} elementos modelados.`,
    operations:  (n, a) => `${a} operacional con ${n} elementos. Énfasis en runtime y despliegue.`,
};

/**
 * Order nodes by visual / semantic importance: persons & external systems
 * first, then gateways / integration hubs, then data stores, then services.
 * Used to pick the "Key nodes" list for the summary.
 */
function importanceRank(node: DiagramIRNode): number {
    const role = node.semanticRole ?? detectSemanticRole(node.label ?? '', node.kind);
    switch (role) {
        case 'person':    return 0;
        case 'external':  return 1;
        case 'gateway':   return 2;
        case 'data':      return 3;
        case 'messaging': return 4;
        case 'system':    return 5;
        case 'service':   return 6;
        case 'process':   return 7;
        default:          return 9;
    }
}

const truncateLabel = (label: string, max = 56): string =>
    label.length <= max ? label : `${label.slice(0, max - 1).trimEnd()}…`;

function describeNode(node: DiagramIRNode): string {
    const role = node.semanticRole ?? detectSemanticRole(node.label ?? '', node.kind);
    const tech = node.technology ? ` [${node.technology}]` : '';
    const desc = node.description ? ` — ${truncateLabel(node.description, 96)}` : '';
    return `${truncateLabel(node.label || node.id)}${tech} (${role})${desc}`;
}

function describeEdge(edge: DiagramIR['edges'][number], nodes: DiagramIRNode[]): string {
    const src = nodes.find((n) => n.id === edge.source);
    const tgt = nodes.find((n) => n.id === edge.target);
    const srcLabel = src?.label ?? edge.source;
    const tgtLabel = tgt?.label ?? edge.target;
    const protocol = edge.protocol ? ` vía ${edge.protocol}` : '';
    const relation = edge.relation && edge.relation !== 'default' ? ` (${edge.relation})` : '';
    const verb = (edge.label ?? '').trim() || 'se conecta con';
    return `${truncateLabel(srcLabel, 32)} ${verb} ${truncateLabel(tgtLabel, 32)}${protocol}${relation}`;
}

function pickNarrativeText(narrative: unknown): string {
    // The IR persists `narrative` as either a plain string (legacy) or a
    // structured object. Both shapes carry the human-readable summary.
    if (!narrative) return '';
    if (typeof narrative === 'string') return narrative.trim();
    if (typeof narrative === 'object' && narrative !== null) {
        const obj = narrative as DiagramNarrative;
        return (obj.summary ?? '').trim();
    }
    return '';
}

/**
 * Build the accessible summary of a DiagramIR. Returns a structured object
 * with both granular fields (headline, keyNodes, keyFlows…) and the
 * pre-composed `fullText`, so different consumers can pick the level of
 * detail they want.
 *
 * Always returns a non-null object: even an empty IR produces a usable
 * "Diagrama vacío" summary that screen readers can announce.
 */
export function buildAccessibleSummary(ir: DiagramIR, options: AccessibleSummaryOptions = {}): AccessibleSummary {
    const audience = options.audience ?? ir.metadata?.audience ?? 'technical';
    const maxNodes = options.maxNamedNodes ?? 8;
    const maxEdges = options.maxNamedEdges ?? 8;

    if (ir.nodes.length === 0) {
        return {
            headline: 'Diagrama vacío: aún no hay elementos modelados.',
            keyNodes: [],
            keyFlows: [],
            boundaries: [],
            fullText: 'Diagrama vacío: aún no hay elementos modelados. Genera o agrega nodos para describir la arquitectura.',
        };
    }

    const archetype = detectDiagramArchetype(ir);
    const archetypeLabel = ARCHETYPE_LABEL[archetype];
    const title = (ir.metadata?.title ?? '').trim();
    const opener = AUDIENCE_OPENERS[audience](ir.nodes.length, archetypeLabel);
    const headline = title ? `${title}. ${opener}` : opener;

    const rankedNodes = [...ir.nodes].sort((a, b) => importanceRank(a) - importanceRank(b));
    const keyNodes = rankedNodes.slice(0, maxNodes).map(describeNode);
    const remainingNodes = ir.nodes.length - keyNodes.length;
    if (remainingNodes > 0) {
        keyNodes.push(`…y ${remainingNodes} elemento(s) adicional(es).`);
    }

    // Rank edges by criticality > protocol-presence > labeled.
    const rankedEdges = [...ir.edges].sort((a, b) => {
        const score = (e: typeof a): number => {
            let s = 0;
            if (e.criticality === 'critical') s += 4;
            else if (e.criticality === 'high') s += 2;
            if (e.protocol) s += 1.5;
            if ((e.label ?? '').trim()) s += 1;
            return -s;
        };
        return score(a) - score(b);
    });
    const keyFlows = rankedEdges.slice(0, maxEdges).map((edge) => describeEdge(edge, ir.nodes));
    const remainingEdges = ir.edges.length - keyFlows.length;
    if (remainingEdges > 0) {
        keyFlows.push(`…y ${remainingEdges} relación(es) adicional(es).`);
    }

    const boundaries = ir.groups.map((g) => `${g.label} (${g.nodeIds.length} elemento(s))`);

    const narrative = pickNarrativeText(ir.metadata?.narrative);

    const lines: string[] = [headline];
    if (narrative) {
        lines.push('');
        lines.push('Narrativa:');
        lines.push(narrative);
    }
    if (boundaries.length > 0) {
        lines.push('');
        lines.push(`Agrupaciones / límites (${boundaries.length}):`);
        boundaries.forEach((b) => lines.push(`  • ${b}`));
    }
    lines.push('');
    lines.push(`Elementos clave (${ir.nodes.length} total):`);
    keyNodes.forEach((n) => lines.push(`  • ${n}`));
    lines.push('');
    lines.push(`Relaciones clave (${ir.edges.length} total):`);
    keyFlows.forEach((f) => lines.push(`  • ${f}`));

    return {
        headline,
        keyNodes,
        keyFlows,
        boundaries,
        fullText: lines.join('\n'),
    };
}

/**
 * Compact `aria-description` string suitable for an inline ARIA attribute
 * on the ReactFlow root. Caps total length so screen readers don't drone
 * — full detail is available via the visible "Descripción accesible"
 * dialog, which renders `fullText`.
 */
export function buildShortAriaDescription(ir: DiagramIR, audience?: DiagramAudience): string {
    const summary = buildAccessibleSummary(ir, { audience, maxNamedNodes: 4, maxNamedEdges: 0 });
    return `${summary.headline} Pulsa "Descripción accesible" para los detalles completos.`;
}
