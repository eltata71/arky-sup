/**
 * Sequence diagrams: read with their order, and written back without loss
 * (plan de diagramas, 8.3b).
 *
 * The graph half — participants as nodes, messages as edges — is what the
 * parser always produced. The notation half is the rest of what a sequence
 * says: the order of the messages, the `loop`/`alt`/`opt`/`par`/`critical`/
 * `break`/`rect` fragments around them, notes, activations and `autonumber`.
 *
 * A statement the reader does not know (`box`, `create participant`,
 * `destroy`, `link`…) is recorded in `unsupported`, and the writer refuses to
 * write a text from that IR: the original text stays the source.
 */
import type { DiagramIR, DiagramIRNode, SequenceArrow, SequenceFragmentKind, SequenceNotation, SequenceStep } from '../../../lib/diagram';
import { oneLine, statementsOf, unquote, type NotationParseApi } from './notationParseApi';

const ARROW = /^(.+?)\s*(-->>|->>|--\)|-\)|--x|-x|-->|->)([+-]?)\s*(.+?)\s*:\s*(.*)$/;
const FRAGMENT_OPEN = /^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/i;
const FRAGMENT_BRANCH = /^(else|and|option)\b\s*(.*)$/i;
const NOTE = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i;
const PARTICIPANT = /^(participant|actor)\s+(.+)$/i;
const ACTIVATION = /^(activate|deactivate)\s+(.+)$/i;

const RELATION_OF_ARROW: Record<SequenceArrow, NonNullable<DiagramIR['edges'][number]['relation']>> = {
    '->>': 'default',
    '-->>': 'async',
    '->': 'default',
    '-->': 'default',
    '-)': 'async',
    '--)': 'async',
    '-x': 'dependency',
    '--x': 'dependency',
};

const looseKey = (value: string): string => unquote(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Reads a `sequenceDiagram` body into the IR (through `api`) and returns its
 * notation. Participants written only in messages get a stable, canvas-safe
 * id and keep their written name as label — the behaviour of before.
 */
export function parseSequenceNotation(body: string, api: NotationParseApi): SequenceNotation {
    const aliases = new Map<string, string>();
    const notation: SequenceNotation = { dialect: 'sequence', actors: [], steps: [], unsupported: [] };
    const stack: Array<{ steps: SequenceStep[]; fragment: Extract<SequenceStep, { kind: 'fragment' }> }> = [];
    const current = (): SequenceStep[] => {
        const top = stack[stack.length - 1];
        return top ? top.fragment.branches[top.fragment.branches.length - 1].steps : notation.steps;
    };

    const endpoint = (raw: string): string => {
        const token = unquote(raw.trim());
        const known = aliases.get(token) ?? aliases.get(looseKey(token));
        if (known) return known;
        const id = /^[A-Za-z0-9_.:-]+$/.test(token)
            ? token
            : `seq_${looseKey(token).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `node_${api.nodeCount() + 1}`}`;
        aliases.set(token, id);
        aliases.set(looseKey(token), id);
        api.upsertNode(id, token);
        return id;
    };

    for (const line of statementsOf(body)) {
        if (/^autonumber\b/i.test(line)) {
            notation.autonumber = true;
            continue;
        }
        const participant = line.match(PARTICIPANT);
        if (participant) {
            const declared = participant[2].trim();
            const asMatch = declared.match(/^(.+?)\s+as\s+(.+)$/i);
            const idToken = unquote((asMatch ? asMatch[1] : declared).trim());
            const label = unquote((asMatch ? asMatch[2] : declared).trim());
            const id = endpoint(idToken);
            for (const key of [idToken, label]) {
                aliases.set(key, id);
                aliases.set(looseKey(key), id);
            }
            const isActor = participant[1].toLowerCase() === 'actor';
            const node = api.upsertNode(id, label, isActor ? 'person' : 'rectangle');
            node.label = label;
            node.shape = isActor ? 'person' : 'rectangle';
            if (isActor && !notation.actors.includes(id)) notation.actors.push(id);
            continue;
        }
        const open = line.match(FRAGMENT_OPEN);
        if (open) {
            const fragment: Extract<SequenceStep, { kind: 'fragment' }> = {
                kind: 'fragment',
                fragment: open[1].toLowerCase() as SequenceFragmentKind,
                branches: [{ label: open[2].trim(), steps: [] }],
            };
            current().push(fragment);
            stack.push({ steps: current(), fragment });
            continue;
        }
        const branch = line.match(FRAGMENT_BRANCH);
        if (branch && stack.length > 0) {
            stack[stack.length - 1].fragment.branches.push({ label: branch[2].trim(), steps: [] });
            continue;
        }
        if (/^end$/i.test(line)) {
            if (stack.length > 0) stack.pop();
            else notation.unsupported.push(line);
            continue;
        }
        const note = line.match(NOTE);
        if (note) {
            current().push({
                kind: 'note',
                placement: note[1].toLowerCase() as 'left of' | 'right of' | 'over',
                participants: note[2].split(',').map((p) => endpoint(p)),
                text: note[3].trim(),
            });
            continue;
        }
        const activation = line.match(ACTIVATION);
        if (activation) {
            current().push({ kind: activation[1].toLowerCase() as 'activate' | 'deactivate', participant: endpoint(activation[2]) });
            continue;
        }
        const message = line.match(ARROW);
        if (message) {
            const arrow = message[2] as SequenceArrow;
            const edge = api.pushEdge(endpoint(message[1]), endpoint(message[4]), unquote(message[5].trim()), RELATION_OF_ARROW[arrow]);
            current().push({
                kind: 'message',
                edgeId: edge.id,
                arrow,
                ...(message[3] ? { activation: message[3] as '+' | '-' } : {}),
            });
            continue;
        }
        notation.unsupported.push(line);
    }
    if (stack.length > 0) notation.unsupported.push('(fragmento sin cerrar)');
    return notation;
}

const participantLine = (node: DiagramIRNode, actors: Set<string>): string => {
    const keyword = actors.has(node.id) || node.shape === 'person' ? 'actor' : 'participant';
    const label = oneLine(node.label || node.id);
    return label === node.id ? `    ${keyword} ${node.id}` : `    ${keyword} ${node.id} as ${label}`;
};

/**
 * Writes the IR back as a `sequenceDiagram`, or `null` when the IR does not
 * hold the whole text it came from. Steps whose edge or participants no
 * longer exist are skipped; edges no step mentions (a patch added them) are
 * appended in IR order as synchronous messages.
 */
export function serializeSequenceNotation(ir: DiagramIR, notation: SequenceNotation): string | null {
    if (notation.unsupported.length > 0) return null;
    const nodes = new Set(ir.nodes.map((n) => n.id));
    const edges = new Map(ir.edges.map((e) => [e.id, e]));
    const mentioned = new Set<string>();
    const lines = ['sequenceDiagram'];
    if (notation.autonumber) lines.push('    autonumber');
    const actors = new Set(notation.actors);
    for (const node of ir.nodes) lines.push(participantLine(node, actors));

    const render = (steps: SequenceStep[], depth: number): string[] => {
        const pad = '    '.repeat(depth);
        const out: string[] = [];
        for (const step of steps) {
            if (step.kind === 'message') {
                const edge = edges.get(step.edgeId);
                if (!edge || !nodes.has(edge.source) || !nodes.has(edge.target)) continue;
                mentioned.add(edge.id);
                out.push(`${pad}${edge.source}${step.arrow}${step.activation ?? ''}${edge.target}: ${oneLine(edge.label)}`);
            } else if (step.kind === 'note') {
                const who = step.participants.filter((p) => nodes.has(p));
                if (who.length === 0) continue;
                out.push(`${pad}Note ${step.placement} ${who.join(',')}: ${oneLine(step.text)}`);
            } else if (step.kind === 'activate' || step.kind === 'deactivate') {
                if (nodes.has(step.participant)) out.push(`${pad}${step.kind} ${step.participant}`);
            } else if (step.kind === 'fragment') {
                const branches = step.branches.map((b) => ({ label: b.label, body: render(b.steps, depth + 1) }));
                if (branches.every((b) => b.body.length === 0)) continue;
                const keep = branches.filter((b, i) => i === 0 || b.body.length > 0);
                const separator = step.fragment === 'par' ? 'and' : step.fragment === 'critical' ? 'option' : 'else';
                keep.forEach((b, i) => {
                    const head = i === 0 ? step.fragment : separator;
                    out.push(`${pad}${head}${b.label ? ` ${oneLine(b.label)}` : ''}`);
                    out.push(...b.body);
                });
                out.push(`${pad}end`);
            }
        }
        return out;
    };

    const body = render(notation.steps, 1);
    lines.push(...body);
    for (const edge of ir.edges) {
        if (mentioned.has(edge.id) || !nodes.has(edge.source) || !nodes.has(edge.target)) continue;
        lines.push(`    ${edge.source}->>${edge.target}: ${oneLine(edge.label)}`);
    }
    return lines.join('\n');
}
