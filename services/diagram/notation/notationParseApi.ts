/**
 * What a dialect reader needs from the parser that owns the IR (8.3b).
 *
 * The readers live beside `mermaidToIR` rather than inside it, and they must
 * not import it back: the parser hands them these two operations, which are
 * the only way a node or an edge enters the IR it is building.
 */
import type { DiagramIREdge, DiagramIRNode, NodeShape } from '../../../lib/diagram';

export interface NotationParseApi {
    upsertNode(id: string, label?: string, shape?: NodeShape): DiagramIRNode;
    pushEdge(source: string, target: string, label: string | undefined, relation: DiagramIREdge['relation']): DiagramIREdge;
    nodeCount(): number;
}

/** Strips one level of matching quotes. */
export function unquote(value: string): string {
    const t = value.trim();
    if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
    return t;
}

/** A body's statements: trimmed, comments removed, blank lines dropped. */
export function statementsOf(body: string): string[] {
    return body
        .split('\n')
        .map((raw) => raw.replace(/\s*%%.*$/, '').trim())
        .filter((line) => line.length > 0);
}

/** Text that is safe on one Mermaid line: no line breaks. */
export function oneLine(text: string): string {
    return text.replace(/\s*\r?\n\s*/g, ' ').trim();
}
