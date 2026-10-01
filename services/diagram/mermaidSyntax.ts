/**
 * Is this text valid Mermaid? Asked of Mermaid itself (plan de diagramas, 8.2a).
 *
 * The generation judged a diagram with our own parser (`mermaidToIR`), a
 * pragmatic regex reader built to extract a model, not to validate a grammar.
 * The two disagree both ways: a text our parser accepts can fail when the
 * document, the export or Lucid render it with Mermaid, and a valid Gantt was
 * rejected three times and saved as a skeleton because our parser only knows
 * graphs. The grammar that will draw the diagram is the one that decides.
 *
 * Three verdicts, and the third is not a failure: `unavailable` means this
 * environment cannot ask Mermaid (it is loaded on demand and some dialects
 * need a DOM). The caller then falls back to what it did before, and says so;
 * it never turns "could not check" into "invalid" or into "valid".
 */

export type MermaidSyntaxVerdict =
    | { status: 'valid'; diagramType: string }
    | { status: 'invalid'; message: string }
    | { status: 'unavailable'; reason: string };

/** Mermaid's own wording for a text that is not in its grammar. */
const GRAMMAR_ERROR = /parse error|lexical error|no diagram type detected|unknowndiagram|expecting|syntax error/i;

export async function checkMermaidSyntax(code: string): Promise<MermaidSyntaxVerdict> {
    const text = code.trim();
    if (!text) return { status: 'invalid', message: 'El diagrama está vacío.' };
    let parse: (text: string) => Promise<unknown>;
    try {
        const mermaid = (await import('mermaid')).default;
        parse = (value) => mermaid.parse(value);
    } catch (err) {
        return { status: 'unavailable', reason: err instanceof Error ? err.message : String(err) };
    }
    try {
        const result = await parse(text) as { diagramType?: string } | false;
        return { status: 'valid', diagramType: (result && result.diagramType) || '' };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (GRAMMAR_ERROR.test(message)) return { status: 'invalid', message: firstLines(message) };
        return { status: 'unavailable', reason: firstLines(message) };
    }
}

const firstLines = (message: string): string => message.split('\n').slice(0, 4).join('\n').slice(0, 400);

/**
 * The Mermaid dialects the canonical IR can read and draw on the canvas. Any
 * other dialect (Gantt, journey, mindmap…) is valid as text and has no model:
 * it is shown with Mermaid itself, never forced into boxes and arrows.
 */
const IR_READABLE = /^(flowchart|graph|sequencediagram|classdiagram|erdiagram|c4context|c4container|c4component|c4deployment|statediagram(-v2)?)$/;

export function isIRReadableDialect(dialect: string): boolean {
    return IR_READABLE.test(dialect.trim().toLowerCase());
}

/** Mermaid dialects that are valid text with no graph to model. A word that is not one is not a dialect. */
const TEXT_ONLY = /^(gantt|journey|mindmap|pie|timeline|quadrantchart|gitgraph|requirementdiagram|xychart(-beta)?|sankey(-beta)?|block(-beta)?|kanban|packet(-beta)?|architecture(-beta)?)$/;

export function isTextOnlyDialect(dialect: string): boolean {
    return TEXT_ONLY.test(dialect.trim().toLowerCase());
}
