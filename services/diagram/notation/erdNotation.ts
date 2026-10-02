/**
 * Entity-relationship diagrams: attributes and cardinalities kept, and
 * written back without loss (plan de diagramas, 8.3b).
 *
 * The canvas label of a relation stays what it was — the verb with its
 * cardinality in words, `contiene (1 → 1..*)` — because that is what makes
 * the cardinality visible on a canvas that draws no crow's feet. What the
 * text needs to be rewritten is the written form (`||--|{`), and that lives
 * in the notation.
 */
import type { DiagramIR, ErdAttribute, ErdCardinality, ErdNotation, ErdRelation } from '../../../lib/diagram';
import { oneLine, statementsOf, unquote, type NotationParseApi } from './notationParseApi';

const ENTITY = '[A-Za-z0-9_-]+';
const RELATION = new RegExp(`^(${ENTITY})\\s+([|o}]{2})(--|\\.\\.)([|o{]{2})\\s+(${ENTITY})\\s*:\\s*(.+)$`);
const ENTITY_OPEN = new RegExp(`^(${ENTITY})\\s*\\{\\s*(\\})?$`);
const ATTRIBUTE = /^([A-Za-z][\w()[\],.-]*)\s+([A-Za-z_*][\w-]*)((?:\s+(?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)?)(?:\s+"([^"]*)")?$/;

const CARDINALITIES = new Set<ErdCardinality>(['||', '|o', 'o|', '}o', 'o{', '}|', '|{']);
const IN_WORDS: Record<ErdCardinality, string> = {
    '||': '1', '|o': '0..1', 'o|': '0..1', '}o': '0..*', 'o{': '0..*', '}|': '1..*', '|{': '1..*',
};

/** The canvas label of a relation: its verb and its cardinality in words. */
export function erdRelationLabel(relation: ErdRelation): string {
    return `${relation.label} (${IN_WORDS[relation.left]} → ${IN_WORDS[relation.right]})`;
}

/** Reads an `erDiagram` body into the IR (through `api`) and returns its notation. */
export function parseErdNotation(body: string, api: NotationParseApi): ErdNotation {
    const notation: ErdNotation = { dialect: 'erd', attributes: {}, relations: {}, unsupported: [] };
    let entity: string | null = null;
    for (const line of statementsOf(body)) {
        if (entity) {
            if (line === '}') {
                entity = null;
                continue;
            }
            const attribute = line.match(ATTRIBUTE);
            if (!attribute) {
                notation.unsupported.push(line);
                continue;
            }
            const keys = attribute[3].trim() ? attribute[3].split(',').map((k) => k.trim()) as ErdAttribute['keys'] : undefined;
            notation.attributes[entity].push({
                type: attribute[1],
                name: attribute[2],
                ...(keys ? { keys } : {}),
                ...(attribute[4] !== undefined ? { comment: attribute[4] } : {}),
            });
            continue;
        }
        const open = line.match(ENTITY_OPEN);
        if (open) {
            api.upsertNode(open[1], open[1], 'rectangle');
            notation.attributes[open[1]] ??= [];
            if (!open[2]) entity = open[1];
            continue;
        }
        const relation = line.match(RELATION);
        if (relation && CARDINALITIES.has(relation[2] as ErdCardinality) && CARDINALITIES.has(relation[4] as ErdCardinality)) {
            const [, a, left, link, right, b, rawLabel] = relation;
            const written: ErdRelation = {
                left: left as ErdCardinality,
                right: right as ErdCardinality,
                identifying: link === '--',
                label: unquote(rawLabel.trim()),
            };
            api.upsertNode(a);
            api.upsertNode(b);
            const edge = api.pushEdge(a, b, erdRelationLabel(written), 'data-flow');
            notation.relations[edge.id] = written;
            continue;
        }
        notation.unsupported.push(line);
    }
    if (entity) notation.unsupported.push('(entidad sin cerrar)');
    return notation;
}

/**
 * The verb of a relation as it stands in the IR. A label someone edited on
 * the canvas still ends in the cardinality in words, which is not part of
 * the verb.
 */
const verbOf = (label: string, written: ErdRelation): string => {
    if (label === erdRelationLabel(written)) return written.label;
    return label.replace(/\s*\([^()]*→[^()]*\)\s*$/, '').trim() || written.label;
};

const quoteVerb = (verb: string): string => (/^[A-Za-z0-9_-]+$/.test(verb) ? verb : `"${oneLine(verb).replace(/"/g, "'")}"`);

/**
 * Writes the IR back as an `erDiagram`, or `null` when it cannot: the text
 * held something the reader did not represent, or a relation has no written
 * cardinality (a patch added it) — inventing one would state a business rule
 * nobody wrote.
 */
export function serializeErdNotation(ir: DiagramIR, notation: ErdNotation): string | null {
    if (notation.unsupported.length > 0) return null;
    if (ir.nodes.some((n) => !new RegExp(`^${ENTITY}$`).test(n.id))) return null;
    const nodes = new Set(ir.nodes.map((n) => n.id));
    const lines = ['erDiagram'];
    const related = new Set<string>();
    for (const edge of ir.edges) {
        if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
        const written = notation.relations[edge.id];
        if (!written) return null;
        related.add(edge.source);
        related.add(edge.target);
        lines.push(`    ${edge.source} ${written.left}${written.identifying ? '--' : '..'}${written.right} ${edge.target} : ${quoteVerb(verbOf(edge.label, written))}`);
    }
    for (const node of ir.nodes) {
        const attributes = notation.attributes[node.id];
        if (!attributes && related.has(node.id)) continue;
        lines.push(`    ${node.id} {`);
        for (const a of attributes ?? []) {
            const keys = a.keys?.length ? ` ${a.keys.join(', ')}` : '';
            const comment = a.comment !== undefined ? ` "${oneLine(a.comment).replace(/"/g, "'")}"` : '';
            lines.push(`        ${a.type} ${a.name}${keys}${comment}`);
        }
        lines.push('    }');
    }
    return lines.join('\n');
}
