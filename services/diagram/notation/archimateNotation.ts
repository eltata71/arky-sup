/**
 * ArchiMate as a dialect of the IR (plan clase mundial, 11.1).
 *
 * Mermaid has no ArchiMate, so the text is a flowchart that says it is one:
 *
 *     %% archimate viewpoint=layered
 *     flowchart LR
 *       A["Cliente"]
 *       class A archimate_business_actor
 *       A -->|serving: consulta| B
 *
 * The element type lives in a class named `archimate_<type>` and the relation
 * in the edge label as `<relation>[: text]`. The canvas label of an edge is
 * its text, or the relation's name in Spanish when there is none; the type
 * and the written text live in the notation, by id.
 */
import type { ArchimateNotation, DiagramIR, DiagramIREdge } from '../../../lib/diagram';
import {
    ARCHIMATE_RELATION_LABELS,
    isArchimateElementType,
    isArchimateRelationType,
    type ArchimateElementType,
} from '../../../lib/archimate/archimateMetamodel';
import { irToMermaid } from '../irToMermaid';

const MARKER = /^\s*%%\s*archimate\b(.*)$/im;
const CLASS_PREFIX = 'archimate_';
const className = (type: string): string => `${CLASS_PREFIX}${type.replace(/-/g, '_')}`;
const typeOfClass = (name: string): string => name.slice(CLASS_PREFIX.length).replace(/_/g, '-');
const RELATION_LABEL = /^([a-z]+)\s*(?::\s*(.*))?$/i;

/** Whether a Mermaid text declares itself an ArchiMate diagram. */
export function hasArchimateMarker(code: string): boolean {
    return MARKER.test(code);
}

/** The viewpoint a marker line names; `layered` when it names none. */
function viewpointOf(code: string): string {
    const match = code.match(MARKER);
    return match?.[1].match(/viewpoint\s*=\s*([\w-]+)/i)?.[1] ?? 'layered';
}

/**
 * Reads the notation out of a parsed flowchart: `classes` are the classes
 * assigned to each node, `edges` the parsed edges, whose labels are rewritten
 * to the canvas label. Removes the `archimate_*` classes from `classes` so the
 * generic class-to-role pass does not read `archimate_application_service` as
 * a service. Returns `null` when the text carries no marker.
 */
export function readArchimateNotation(
    code: string,
    nodeIds: readonly string[],
    classes: Map<string, string[]>,
    edges: DiagramIREdge[],
): ArchimateNotation | null {
    if (!hasArchimateMarker(code)) return null;
    const notation: ArchimateNotation = {
        dialect: 'archimate',
        viewpoint: viewpointOf(code),
        elements: {},
        relations: {},
        unsupported: [],
    };
    for (const id of nodeIds) {
        const own = classes.get(id) ?? [];
        const typed = own.filter((c) => c.startsWith(CLASS_PREFIX));
        const type = typed.map(typeOfClass).find(isArchimateElementType);
        if (type) notation.elements[id] = type;
        else notation.unsupported.push(typed[0] ? `class ${id} ${typed[0]}` : `node ${id} sin tipo ArchiMate`);
        if (typed.length > 0) {
            const rest = own.filter((c) => !c.startsWith(CLASS_PREFIX));
            if (rest.length > 0) classes.set(id, rest);
            else classes.delete(id);
        }
    }
    for (const edge of edges) {
        const match = (edge.label ?? '').trim().match(RELATION_LABEL);
        const type = match?.[1].toLowerCase() ?? '';
        if (!match || !isArchimateRelationType(type)) {
            notation.unsupported.push(`edge ${edge.source}>${edge.target}: ${edge.label ?? ''}`);
            continue;
        }
        const text = (match[2] ?? '').trim();
        notation.relations[edge.id] = { type, text };
        edge.label = text || ARCHIMATE_RELATION_LABELS[type];
    }
    return notation;
}

/** The IR as an ArchiMate-marked flowchart, or `null` when it cannot be written. */
export function serializeArchimateNotation(ir: DiagramIR, notation: ArchimateNotation): string | null {
    const nodeIds = new Set(ir.nodes.map((n) => n.id));
    for (const node of ir.nodes) if (!notation.elements[node.id]) return null;
    const edges = ir.edges.map((edge) => {
        const relation = notation.relations[edge.id];
        if (!relation) return null;
        const text = relation.text ? `: ${relation.text}` : '';
        return { ...edge, protocol: undefined, label: `${relation.type}${text}` };
    });
    if (edges.some((e) => e === null)) return null;
    const flowchart = irToMermaid({ ...ir, edges: edges as DiagramIREdge[] });
    const classes = ir.nodes
        .filter((n) => nodeIds.has(n.id))
        .map((n) => `    class ${n.id} ${className(notation.elements[n.id] as ArchimateElementType)}`);
    return [`%% archimate viewpoint=${notation.viewpoint}`, flowchart, ...classes].join('\n');
}

/** Comparable form for the fingerprint. */
export function comparableArchimate(notation: ArchimateNotation, edge: (id: string) => string): unknown {
    return {
        viewpoint: notation.viewpoint,
        elements: notation.elements,
        relations: Object.entries(notation.relations).map(([id, r]) => [edge(id), r]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    };
}
