/**
 * State diagrams: composite states, pseudostates, descriptions and notes
 * kept, and written back without loss (plan de diagramas, 8.3b).
 *
 * Each composite state is a scope with its own start and end: `[*]` inside
 * `state Revision { … }` is not the `[*]` of the diagram. The parser used to
 * read both as one node, which joined every scope's start into one. Inside a
 * composite they are now `Revision::[*]`; at the top level the id is still
 * `[*]`, as before.
 *
 * The composite itself stays a node — transitions enter and leave it — and
 * also becomes an IR group with its children, so the canvas draws it as a
 * container.
 */
import type { DiagramIR, StateNotation } from '../../../lib/diagram';
import { oneLine, statementsOf, unquote, type NotationParseApi } from './notationParseApi';

const STATE_ID = '[A-Za-z0-9_]+';
const ENDPOINT = `(\\[\\*\\]|${STATE_ID})`;
const TRANSITION = new RegExp(`^${ENDPOINT}\\s*-->\\s*${ENDPOINT}(?:\\s*:\\s*(.*))?$`);
const COMPOSITE_OPEN = new RegExp(`^state\\s+(?:"([^"]*)"\\s+as\\s+)?(${STATE_ID})\\s*\\{$`);
const DECLARATION = new RegExp(`^state\\s+"([^"]*)"\\s+as\\s+(${STATE_ID})$`);
const BARE_STATE = new RegExp(`^state\\s+(${STATE_ID})$`);
const PSEUDO = new RegExp(`^(?:state\\s+)?(${STATE_ID})\\s*<<\\s*(choice|fork|join)\\s*>>$`, 'i');
const DESCRIPTION = new RegExp(`^(${STATE_ID})\\s*:\\s*(.+)$`);
const NOTE_INLINE = new RegExp(`^note\\s+(left of|right of)\\s+(${STATE_ID})\\s*:\\s*(.+)$`, 'i');
const NOTE_BLOCK = new RegExp(`^note\\s+(left of|right of)\\s+(${STATE_ID})$`, 'i');
const LONE_STATE = new RegExp(`^${STATE_ID}$`);

const START_END = '[*]';
/** The id of `[*]` in a scope: `[*]` at the top level, `Scope::[*]` inside a composite. */
const pseudoEndpointId = (scope: string | undefined): string => (scope ? `${scope}::${START_END}` : START_END);

/** Reads a `stateDiagram` body into the IR (through `api`) and returns its notation. */
export function parseStateNotation(
    header: 'stateDiagram' | 'stateDiagram-v2',
    body: string,
    api: NotationParseApi,
    groups: DiagramIR['groups'],
): StateNotation {
    const notation: StateNotation = {
        dialect: 'state', header, composites: [], edgeScopes: {}, pseudostates: {}, unlabeledEdges: [], notes: [], unsupported: [],
    };
    const scopes: Array<{ id: string; childIds: string[] }> = [];
    const scope = (): string | undefined => scopes[scopes.length - 1]?.id;
    // A state belongs to the scope it is first written in, as in Mermaid: a
    // later mention from inside a composite does not move it there.
    const seen = new Set<string>();
    const adopt = (id: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        const top = scopes[scopes.length - 1];
        if (top && id !== top.id) top.childIds.push(id);
    };
    const state = (raw: string, label?: string, shape?: 'rectangle' | 'diamond' | 'tab-box'): string => {
        const id = raw === START_END ? pseudoEndpointId(scope()) : raw;
        const node = api.upsertNode(id, raw === START_END ? START_END : label ?? raw, shape ?? 'rectangle');
        if (label) node.label = label;
        if (shape === 'diamond' || shape === 'tab-box') node.shape = shape;
        adopt(id);
        return id;
    };

    let openNote: { placement: 'left of' | 'right of'; stateId: string; text: string[] } | null = null;
    for (const line of statementsOf(body)) {
        if (openNote) {
            if (/^end note$/i.test(line)) {
                notation.notes.push({ placement: openNote.placement, stateId: openNote.stateId, text: openNote.text.join(' ') });
                openNote = null;
            } else {
                openNote.text.push(line);
            }
            continue;
        }
        const direction = line.match(/^direction\s+(TB|BT|LR|RL)$/i);
        if (direction && scopes.length === 0) {
            notation.direction = direction[1].toUpperCase() as StateNotation['direction'];
            continue;
        }
        const composite = line.match(COMPOSITE_OPEN);
        if (composite) {
            const id = state(composite[2], composite[1], 'tab-box');
            const entry = { id, childIds: [] as string[] };
            notation.composites.push(entry);
            scopes.push(entry);
            continue;
        }
        if (line === '}') {
            if (scopes.length > 0) scopes.pop();
            else notation.unsupported.push(line);
            continue;
        }
        const pseudo = line.match(PSEUDO);
        if (pseudo) {
            const id = state(pseudo[1], undefined, 'diamond');
            notation.pseudostates[id] = pseudo[2].toLowerCase() as 'choice' | 'fork' | 'join';
            continue;
        }
        const declaration = line.match(DECLARATION);
        if (declaration) {
            state(declaration[2], declaration[1]);
            continue;
        }
        const bare = line.match(BARE_STATE) ?? line.match(LONE_STATE);
        if (bare) {
            state(bare[1] ?? bare[0]);
            continue;
        }
        const transition = line.match(TRANSITION);
        if (transition) {
            const [, from, to, label] = transition;
            const edge = api.pushEdge(state(from), state(to), label?.trim() || undefined, 'default');
            if (!label?.trim()) notation.unlabeledEdges.push(edge.id);
            const where = scope();
            if (where) notation.edgeScopes[edge.id] = where;
            continue;
        }
        const noteInline = line.match(NOTE_INLINE);
        if (noteInline) {
            notation.notes.push({ placement: noteInline[1].toLowerCase() as 'left of' | 'right of', stateId: state(noteInline[2]), text: noteInline[3].trim() });
            continue;
        }
        const noteBlock = line.match(NOTE_BLOCK);
        if (noteBlock) {
            openNote = { placement: noteBlock[1].toLowerCase() as 'left of' | 'right of', stateId: state(noteBlock[2]), text: [] };
            continue;
        }
        const description = line.match(DESCRIPTION);
        if (description) {
            state(description[1], unquote(description[2]));
            continue;
        }
        notation.unsupported.push(line);
    }
    if (scopes.length > 0 || openNote) notation.unsupported.push('(bloque sin cerrar)');

    for (const composite of notation.composites) {
        if (composite.childIds.length === 0) continue;
        groups.push({ id: `state_${composite.id}`, label: composite.id, nodeIds: [...composite.childIds], kind: 'cluster' });
    }
    return notation;
}

const isStartEnd = (id: string): boolean => id === START_END || id.endsWith(`::${START_END}`);
const written = (id: string): string => (isStartEnd(id) ? START_END : id);

/**
 * Writes the IR back as a state diagram, or `null` when the IR does not hold
 * the whole text it came from. Each transition is written in the composite
 * it was read from; one a patch added goes at the top level.
 */
export function serializeStateNotation(ir: DiagramIR, notation: StateNotation): string | null {
    if (notation.unsupported.length > 0) return null;
    if (ir.nodes.some((n) => !isStartEnd(n.id) && !new RegExp(`^${STATE_ID}$`).test(n.id))) return null;
    const nodes = new Map(ir.nodes.map((n) => [n.id, n]));
    const composites = new Map(notation.composites.filter((c) => nodes.has(c.id)).map((c) => [c.id, c]));
    const parentOf = new Map<string, string>();
    for (const c of composites.values()) for (const child of c.childIds) parentOf.set(child, c.id);
    const unlabeled = new Set(notation.unlabeledEdges);
    const transitionsIn = new Map<string | undefined, string[]>();
    for (const edge of ir.edges) {
        if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
        const where = notation.edgeScopes[edge.id];
        const scope = where && composites.has(where) ? where : undefined;
        if (!scope && (edge.source.includes('::') || edge.target.includes('::'))) return null;
        const label = unlabeled.has(edge.id) && edge.label === 'Relaciona' ? '' : ` : ${oneLine(edge.label)}`;
        const line = `${written(edge.source)} --> ${written(edge.target)}${label}`;
        transitionsIn.set(scope, [...(transitionsIn.get(scope) ?? []), line]);
    }
    const mentioned = new Set(ir.edges.flatMap((e) => [e.source, e.target]));

    const declare = (id: string): string[] => {
        const node = nodes.get(id);
        if (!node || isStartEnd(id) || composites.has(id)) return [];
        const pseudo = notation.pseudostates[id];
        if (pseudo) return [`state ${id} <<${pseudo}>>`];
        if (node.label && node.label !== id) return [`state "${oneLine(node.label).replace(/"/g, "'")}" as ${id}`];
        return mentioned.has(id) ? [] : [id];
    };
    const notesOf = (scope: string | undefined): string[] => notation.notes
        .filter((n) => nodes.has(n.stateId) && parentOf.get(n.stateId) === scope)
        .map((n) => `note ${n.placement} ${n.stateId} : ${oneLine(n.text)}`);

    const block = (scope: string | undefined, depth: number): string[] => {
        const pad = '    '.repeat(depth);
        const members = ir.nodes.map((n) => n.id).filter((id) => parentOf.get(id) === scope);
        const out: string[] = [];
        for (const id of members) out.push(...declare(id).map((l) => pad + l));
        for (const id of members) {
            const composite = composites.get(id);
            if (!composite) continue;
            const node = nodes.get(id)!;
            const named = node.label && node.label !== id ? `"${oneLine(node.label).replace(/"/g, "'")}" as ` : '';
            out.push(`${pad}state ${named}${id} {`);
            out.push(...block(id, depth + 1));
            out.push(`${pad}}`);
        }
        out.push(...(transitionsIn.get(scope) ?? []).map((l) => pad + l));
        out.push(...notesOf(scope).map((l) => pad + l));
        return out;
    };

    const lines: string[] = [notation.header];
    if (notation.direction) lines.push(`    direction ${notation.direction}`);
    lines.push(...block(undefined, 1));
    return lines.join('\n');
}
