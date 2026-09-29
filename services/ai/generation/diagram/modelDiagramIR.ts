/**
 * A model's DiagramIR, read as untrusted structured output (plan de
 * diagramas, 6.4).
 *
 * The IR path used to do `JSON.parse(cleanJsonString(text)) as DiagramIR`:
 * the cast told the compiler the shape was right and nothing checked it. A
 * `relation` outside the renderer's vocabulary, two nodes with one id or an
 * edge to a node that does not exist reached the canvas as they came, and
 * the dangling edges that *were* filtered went away with a console line —
 * the one place in the pipeline that dropped work without reporting it,
 * against the rule every other layer holds.
 *
 * So the answer is parsed with `parseStructured` (fences and truncation
 * tolerated) and read field by field: what is valid is kept, what is not is
 * removed **and named** in `dropped`, so the caller can put it in the trace.
 * Enumerated fields are checked against the same vocabulary the response
 * schema declares; `kind` is kept as written, because a C4 kind the model
 * chose is information the serialiser uses.
 *
 * A model that answers `{"error": …}` is not malformed: it declined, and
 * `declined` carries its reason (6.3 decides what happens next).
 */
import type { DiagramIR, DiagramIREdge, DiagramIRGroup, DiagramIRNode } from '../../../../lib/diagram';
import { parseStructured } from '../../structuredOutput';

export interface ModelDiagramIRResult {
    ir: DiagramIR | null;
    /** One Spanish line per thing removed, for the trace. */
    dropped: string[];
    /** The model's own reason, when it declined instead of answering. */
    declined?: string;
    /** Why nothing usable came back, when `ir` is null and the model did not decline. */
    failure?: string;
}

const ENUMS: Record<string, readonly string[]> = {
    shape: ['rectangle', 'cylinder', 'hexagon', 'cloud', 'person', 'diamond', 'tab-box'],
    dataClassification: ['public', 'internal', 'confidential', 'restricted', 'pii', 'phi', 'pci'],
    securityLevel: ['none', 'standard', 'elevated', 'critical'],
    criticality: ['low', 'medium', 'high', 'critical'],
    trust: ['internal', 'partner', 'external', 'public'],
    relation: ['sync', 'async', 'data-flow', 'dependency', 'inheritance', 'default'],
    direction: ['unidirectional', 'bidirectional'],
    dataSensitivity: ['public', 'internal', 'confidential', 'restricted', 'pii', 'phi', 'pci'],
    frequency: ['real-time', 'near-real-time', 'batch', 'on-demand', 'periodic'],
    synchrony: ['sync', 'async', 'fire-and-forget', 'request-reply'],
    boundaryType: ['trust', 'network', 'data', 'organizational', 'process', 'compliance'],
};

const GROUP_KINDS = ['swimlane', 'system-boundary', 'enterprise', 'security', 'external-provider', 'data', 'cloud', 'legacy', 'integration', 'cluster'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
    (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Removes enumerated fields outside their vocabulary, naming each one. */
function sanitizeEnums(entry: Record<string, unknown>, where: string, dropped: string[], fields: readonly string[]): void {
    for (const field of fields) {
        const value = entry[field];
        if (value === undefined) continue;
        if (typeof value !== 'string' || !ENUMS[field].includes(value)) {
            dropped.push(`${where}: «${field}» con valor fuera de vocabulario (${JSON.stringify(value)}).`);
            delete entry[field];
        }
    }
}

const NODE_ENUMS = ['shape', 'dataClassification', 'securityLevel', 'criticality', 'trust'];
const EDGE_ENUMS = ['relation', 'direction', 'criticality', 'dataSensitivity', 'frequency', 'synchrony', 'trust'];

export function readModelDiagramIR(raw: string | null | undefined): ModelDiagramIRResult {
    const parsed = parseStructured<unknown>(raw);
    if (!parsed.ok || !isRecord(parsed.value)) {
        return { ir: null, dropped: [], failure: 'La respuesta no es un objeto JSON interpretable.' };
    }
    const value = parsed.value;
    if (value.error !== undefined && !Array.isArray(value.nodes)) {
        return { ir: null, dropped: [], declined: String(value.error) };
    }
    if (!Array.isArray(value.nodes)) {
        return { ir: null, dropped: [], failure: 'La respuesta no trae la lista de nodos.' };
    }

    const dropped: string[] = [];
    const nodes: DiagramIRNode[] = [];
    const ids = new Set<string>();
    value.nodes.forEach((candidate, index) => {
        if (!isRecord(candidate)) {
            dropped.push(`Nodo ${index + 1}: no es un objeto.`);
            return;
        }
        const id = text(candidate.id);
        const label = text(candidate.label);
        if (!id || !label) {
            dropped.push(`Nodo ${index + 1}: le falta ${id ? 'la etiqueta' : 'el id'}.`);
            return;
        }
        if (ids.has(id)) {
            dropped.push(`Nodo «${id}» repetido: se conserva el primero.`);
            return;
        }
        const node = { ...candidate } as Record<string, unknown>;
        sanitizeEnums(node, `Nodo «${id}»`, dropped, NODE_ENUMS);
        ids.add(id);
        nodes.push({ ...(node as unknown as DiagramIRNode), id, label, kind: text(candidate.kind) ?? 'generic' });
    });
    if (nodes.length === 0) {
        return { ir: null, dropped, failure: 'La respuesta no trae ningún nodo válido.' };
    }

    const edges: DiagramIREdge[] = [];
    const edgeIds = new Set<string>();
    (Array.isArray(value.edges) ? value.edges : []).forEach((candidate, index) => {
        if (!isRecord(candidate)) {
            dropped.push(`Conexión ${index + 1}: no es un objeto.`);
            return;
        }
        const source = text(candidate.source);
        const target = text(candidate.target);
        const where = `Conexión «${text(candidate.id) ?? index + 1}»`;
        if (!source || !target || !ids.has(source) || !ids.has(target)) {
            dropped.push(`${where}: apunta a un nodo que no existe (${source ?? '?'} → ${target ?? '?'}).`);
            return;
        }
        let id = text(candidate.id) ?? `e-${source}-${target}`;
        if (edgeIds.has(id)) id = `${id}-${index + 1}`;
        edgeIds.add(id);
        const edge = { ...candidate } as Record<string, unknown>;
        sanitizeEnums(edge, where, dropped, EDGE_ENUMS);
        edges.push({ ...(edge as unknown as DiagramIREdge), id, source, target });
    });

    const groups: DiagramIRGroup[] = [];
    (Array.isArray(value.groups) ? value.groups : []).forEach((candidate, index) => {
        if (!isRecord(candidate) || !text(candidate.id) || !text(candidate.label)) {
            dropped.push(`Agrupación ${index + 1}: le falta el id o la etiqueta.`);
            return;
        }
        const members = (Array.isArray(candidate.nodeIds) ? candidate.nodeIds : []).filter((m): m is string => typeof m === 'string');
        const known = members.filter((m) => ids.has(m));
        if (known.length < members.length) {
            dropped.push(`Agrupación «${candidate.id}»: ${members.length - known.length} miembro(s) que no existen.`);
        }
        if (known.length === 0) return;
        const group = { ...candidate } as Record<string, unknown>;
        sanitizeEnums(group, `Agrupación «${candidate.id}»`, dropped, ['boundaryType', 'trust']);
        if (group.kind !== undefined && !GROUP_KINDS.includes(String(group.kind))) {
            dropped.push(`Agrupación «${candidate.id}»: «kind» fuera de vocabulario (${JSON.stringify(group.kind)}).`);
            delete group.kind;
        }
        groups.push({ ...(group as unknown as DiagramIRGroup), id: String(candidate.id), label: String(candidate.label), nodeIds: known });
    });

    return {
        ir: {
            nodes,
            edges,
            groups,
            ...(isRecord(value.metadata) ? { metadata: value.metadata as DiagramIR['metadata'] } : {}),
        },
        dropped,
    };
}
