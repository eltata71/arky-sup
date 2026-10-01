/**
 * Is a generated diagram text usable? (plan de diagramas, 8.2a)
 *
 * Two questions, asked in this order, and the order matters:
 *
 * 1. **Is it Mermaid?** Asked of Mermaid's grammar (`checkMermaidSyntax`), the
 *    one that will draw it in the document, the export and Lucid. Its error
 *    message travels to the corrective retry, so the model is told what was
 *    wrong instead of "regenerate ensuring the syntax is official".
 * 2. **Does it carry a diagram?** Counted with the IR parser — but only for
 *    the dialects the IR can read. A Gantt, a journey or a mindmap has no
 *    model to count: valid text is the whole answer, and it is drawn by
 *    Mermaid. Counting its "nodes" is how a valid Gantt was rejected three
 *    times and saved as a skeleton.
 *
 * When this environment cannot ask Mermaid (`unavailable`), the count decides,
 * as it did before; a dialect the IR cannot read is then accepted unverified,
 * and the assessment says so.
 */
import { mermaidDialectOf, mermaidToIR } from '../../../diagram';
import { checkMermaidSyntax, isTextOnlyDialect } from '../../../diagram/mermaidSyntax';

export interface DiagramTextAssessment {
    ok: boolean;
    /** Why not, in words the corrective prompt can quote. */
    reason?: string;
    nodeCount: number;
    edgeCount: number;
    /** The grammar could not be asked: the verdict rests on the count alone. */
    unverified?: boolean;
}

/** The Mermaid a diagram artifact carries: the fenced block of a hybrid, or the text. */
export function diagramBodyOf(raw: string, templateType: string): string | null {
    if (templateType === 'hybrid-text-diagram') {
        const match = raw.match(/```mermaid\s*([\s\S]*?)\s*```/i);
        return match ? match[1] : null;
    }
    // Diagram artifacts: tolerate a stray fence the model may add anyway.
    const fenced = raw.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
    if (fenced && /^(graph|flowchart|sequenceDiagram|classDiagram|C4|stateDiagram|erDiagram|gantt|journey|mindmap)/im.test(fenced[1])) {
        return fenced[1];
    }
    return raw;
}

/**
 * The post-generation check. `minNodes`/`minEdges` apply to the dialects the
 * IR reads: C4, hybrid and React Flow need a relation; the rest one element.
 */
export async function assessDiagramText(raw: string, templateType: string): Promise<DiagramTextAssessment> {
    if (!raw || !raw.trim()) return { ok: false, reason: 'empty response', nodeCount: 0, edgeCount: 0 };
    const body = diagramBodyOf(raw, templateType);
    if (body === null) {
        return { ok: false, reason: 'hybrid response missing ```mermaid fence', nodeCount: 0, edgeCount: 0 };
    }

    const syntax = await checkMermaidSyntax(body);
    if (syntax.status === 'invalid') {
        return { ok: false, reason: `Mermaid rejected the syntax: ${syntax.message}`, nodeCount: 0, edgeCount: 0 };
    }
    const unverified = syntax.status === 'unavailable';
    const dialect = mermaidDialectOf(body);

    if (isTextOnlyDialect(dialect)) {
        // Valid text is the whole answer for a dialect with no model.
        return unverified
            ? { ok: true, nodeCount: 1, edgeCount: 0, unverified, reason: `dialect «${dialect}» accepted without a grammar check` }
            : { ok: true, nodeCount: 1, edgeCount: 0 };
    }

    let nodeCount = 0;
    let edgeCount = 0;
    try {
        const ir = mermaidToIR(body);
        nodeCount = ir.nodes.length;
        edgeCount = ir.edges.length;
    } catch (err) {
        return { ok: false, reason: `parser threw: ${(err as Error).message}`, nodeCount: 0, edgeCount: 0, unverified };
    }
    const requiresRelation = templateType.startsWith('mermaid-c4-')
        || templateType === 'hybrid-text-diagram'
        || templateType === 'react-flow-graph';
    const minNodes = requiresRelation ? 2 : 1;
    const minEdges = requiresRelation ? 1 : 0;
    if (nodeCount < minNodes) {
        return { ok: false, reason: `parsed only ${nodeCount} node(s); need ≥ ${minNodes}`, nodeCount, edgeCount, unverified };
    }
    if (edgeCount < minEdges) {
        return { ok: false, reason: `parsed ${nodeCount} nodes but only ${edgeCount} edge(s); need ≥ ${minEdges}`, nodeCount, edgeCount, unverified };
    }
    return { ok: true, nodeCount, edgeCount, ...(unverified ? { unverified } : {}) };
}

/**
 * The last-mile renderability check before a diagram is saved: a text the
 * canvas would show empty is replaced by a skeleton. A dialect the IR cannot
 * read is renderable when Mermaid accepts it — the document view draws it.
 */
export async function isRenderableDiagramText(body: string): Promise<DiagramTextAssessment> {
    const dialect = mermaidDialectOf(body);
    if (isTextOnlyDialect(dialect)) {
        const syntax = await checkMermaidSyntax(body);
        if (syntax.status === 'invalid') return { ok: false, reason: syntax.message, nodeCount: 0, edgeCount: 0 };
        return { ok: true, nodeCount: 1, edgeCount: 0, ...(syntax.status === 'unavailable' ? { unverified: true } : {}) };
    }
    const ir = mermaidToIR(body);
    const nodeCount = ir?.nodes?.length ?? 0;
    const edgeCount = ir?.edges?.length ?? 0;
    // Even a system-context diagram needs an actor and a system to mean anything.
    return nodeCount < 2
        ? { ok: false, reason: `contenido parseó a ${nodeCount} nodo(s)`, nodeCount, edgeCount }
        : { ok: true, nodeCount, edgeCount };
}
