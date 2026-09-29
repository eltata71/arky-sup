/**
 * A diagram artifact's text, rewritten from its IR — or kept, when its dialect
 * cannot hold one (plan de diagramas, 6.1).
 *
 * The generation run and the refinement both normalise a diagram after the
 * quality gate repairs its IR. Both used to write that IR back as a
 * flowchart whatever the artifact was, so sequence diagrams, ERDs and C4 were
 * stored under their type in a notation nobody asked for. One rule, in one
 * place, for both: C4 and flowchart are rewritten, anything else keeps the
 * text and the repairs live in the IR the canvas reads.
 */
import type { DiagramIR } from '../../../lib/diagram';
import { mermaidDialectOf, serializeIRPreservingDialect } from '../../diagram';
import { replaceMermaidBlock } from '../domain/artifactGenerationTrace';

export interface DiagramContentRewrite {
    content: string;
    /** False when the dialect was kept as it came. */
    rewritten: boolean;
    /** The dialect of the diagram text, for the trace. */
    dialect: string;
}

/** `hybrid` rewrites only the fenced ```mermaid block and keeps the prose. */
export function rewriteDiagramContent(
    content: string,
    ir: DiagramIR,
    artifactType: string,
    hybrid: boolean,
): DiagramContentRewrite {
    const body = hybrid ? content.match(/```mermaid\s*([\s\S]*?)```/i)?.[1] ?? '' : content;
    const mermaid = serializeIRPreservingDialect(ir, artifactType, body);
    if (!mermaid) return { content, rewritten: false, dialect: mermaidDialectOf(body) };
    return {
        content: hybrid ? replaceMermaidBlock(content, mermaid) : mermaid,
        rewritten: true,
        dialect: mermaidDialectOf(mermaid),
    };
}
