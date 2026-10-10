/**
 * The dialect notations of the IR — writing them back, and comparing them
 * (plan de diagramas, 8.3b). See `lib/diagram/notationModel.ts`.
 */
import type { DiagramIR, DiagramNotation } from '../../../lib/diagram';
import { serializeSequenceNotation } from './sequenceNotation';
import { serializeErdNotation } from './erdNotation';
import { serializeStateNotation } from './stateNotation';
import { comparableArchimate, serializeArchimateNotation } from './archimateNotation';

export { erdRelationLabel } from './erdNotation';

/** The Mermaid dialect keywords each notation is written in. */
const DIALECT_KEYWORDS: Record<DiagramNotation['dialect'], string[]> = {
    sequence: ['sequencediagram'],
    erd: ['erdiagram'],
    state: ['statediagram', 'statediagram-v2'],
    archimate: ['flowchart', 'graph'],
};

/** Whether `notation` is the notation of a text whose dialect keyword is `dialect`. */
export function notationMatchesDialect(notation: DiagramNotation, dialect: string): boolean {
    return DIALECT_KEYWORDS[notation.dialect].includes(dialect.toLowerCase());
}

/**
 * The IR as Mermaid in the dialect of its notation, or `null` when the
 * notation says the IR does not hold the whole text (`unsupported`), or holds
 * something the dialect cannot be written with.
 */
export function serializeNotation(ir: DiagramIR): string | null {
    const notation = ir.notation;
    if (!notation) return null;
    if (notation.dialect === 'sequence') return serializeSequenceNotation(ir, notation);
    if (notation.dialect === 'erd') return serializeErdNotation(ir, notation);
    if (notation.dialect === 'archimate') return serializeArchimateNotation(ir, notation);
    return serializeStateNotation(ir, notation);
}

/** JSON with object keys sorted, so key order never makes two equal values differ. */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => (
    v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
        : v
));

/**
 * What a diagram says, as a comparable string: nodes (id, label),
 * edges (endpoints and label), groups and the notation, without its list of
 * unsupported statements. Edge ids are replaced by what the edge connects,
 * because a rewritten text numbers them again; the order that means
 * something — a sequence's messages — is kept by the notation's steps.
 * Layout, shapes, kinds and repair metadata do not count — a shape that
 * means something (an actor, a pseudostate, a composite) is in the notation.
 * `graphOnly` leaves the notation out.
 */
export function notationFingerprint(ir: DiagramIR, options: { graphOnly?: boolean } = {}): string {
    const seen = new Map<string, number>();
    const keyOf = new Map<string, string>();
    for (const e of ir.edges) {
        const base = `${e.source}>${e.target}#${e.label}`;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        keyOf.set(e.id, `${base}#${n}`);
    }
    const edge = (id: string): string => keyOf.get(id) ?? `?${id}`;
    const nodes = [...ir.nodes].map((n) => [n.id, n.label]).sort((a, b) => a[0].localeCompare(b[0]));
    const edges = [...keyOf.values()].sort();
    const groups = [...ir.groups]
        .map((g) => [g.id, g.label, [...g.nodeIds].sort()])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return canonical({ nodes, edges, groups, notation: ir.notation && !options.graphOnly ? comparableNotation(ir.notation, edge) : null });
}

function comparableNotation(notation: DiagramNotation, edge: (id: string) => string): unknown {
    if (notation.dialect === 'sequence') {
        type Step = (typeof notation.steps)[number];
        const steps = (list: Step[]): unknown[] => list.map((step) => (
            step.kind === 'message' ? { ...step, edgeId: edge(step.edgeId) }
                : step.kind === 'fragment' ? { ...step, branches: step.branches.map((b) => ({ label: b.label, steps: steps(b.steps) })) }
                    : step
        ));
        return { autonumber: Boolean(notation.autonumber), actors: [...notation.actors].sort(), steps: steps(notation.steps) };
    }
    if (notation.dialect === 'erd') {
        return {
            attributes: notation.attributes,
            relations: Object.entries(notation.relations).map(([id, r]) => [edge(id), r]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        };
    }
    if (notation.dialect === 'archimate') return comparableArchimate(notation, edge);
    return {
        header: notation.header,
        direction: notation.direction ?? null,
        composites: notation.composites.map((c) => [c.id, [...c.childIds].sort()]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        edgeScopes: Object.entries(notation.edgeScopes).map(([id, scope]) => `${edge(id)}@${scope}`).sort(),
        pseudostates: notation.pseudostates,
        unlabeledEdges: notation.unlabeledEdges.map(edge).sort(),
        notes: notation.notes,
    };
}

/**
 * Gives an IR stored before 8.3b the notation of its own text — `parsed` is
 * that text read by `mermaidToIR` — when the two still describe the same
 * graph: every edge the text numbers either is gone from the IR (a patch
 * removed it) or joins the same endpoints. Otherwise the IR is returned
 * unchanged, and whoever wanted to rewrite the text keeps it instead.
 */
export function attachNotationFromSource(ir: DiagramIR, parsed: DiagramIR): DiagramIR {
    if (ir.notation || !parsed.notation) return ir;
    const edges = new Map(ir.edges.map((e) => [e.id, e]));
    const nodes = new Set(ir.nodes.map((n) => n.id));
    for (const edge of parsed.edges) {
        const stored = edges.get(edge.id);
        if (stored && (stored.source !== edge.source || stored.target !== edge.target)) return ir;
    }
    if (parsed.nodes.filter((n) => nodes.has(n.id)).length === 0) return ir;
    return { ...ir, notation: parsed.notation };
}
