/**
 * Write an IR back as Mermaid **only in a dialect that can hold it**
 * (plan de diagramas, 6.1).
 *
 * The generation run and the refinement both "normalised" a diagram by
 * serialising its repaired IR with `irToMermaid`, which only writes
 * flowcharts. For a flowchart that is a normalisation; for anything else it
 * was a change of notation nobody asked for: a sequence diagram lost its
 * lifelines and messages order, an ERD its attributes and cardinalities, a
 * C4 its technologies — and all were stored under the type the user chose.
 * The diagram evaluation bench caught the sequence and ERD cases on its first
 * run.
 *
 * So an IR is written back only into a dialect that can hold it: C4 (by its
 * own serializer), flowchart, and — since 8.3b — sequence, ER and state
 * diagrams, whose order, fragments, attributes and composites now travel in
 * `DiagramIR.notation`. Those three are rewritten only when the IR holds the
 * whole text (`unsupported` is empty) and says something the text does not:
 * an IR that still says what the text says keeps the text the model wrote.
 * Anything else returns `null`, and the caller keeps the text it had — the IR
 * still carries the repairs for the canvas.
 */

import type { DiagramIR } from '../../lib/diagram';
import { irToMermaid } from './irToMermaid';
import { c4LevelOfArtifactType, irToMermaidC4 } from './irToMermaidC4';
import { mermaidToIR } from './mermaidToIR';
import { hasArchimateMarker } from './notation/archimateNotation';
import { attachNotationFromSource, notationFingerprint, notationMatchesDialect, serializeNotation } from './notation';

/** The first statement of a Mermaid text: its dialect keyword (`flowchart`, `erDiagram`…). */
export function mermaidDialectOf(mermaid: string): string {
    let inFrontMatter = false;
    for (const raw of mermaid.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('%%')) continue;
        if (line === '---') {
            inFrontMatter = !inFrontMatter;
            continue;
        }
        if (inFrontMatter) continue;
        return line.split(/\s+/)[0].toLowerCase();
    }
    return '';
}
/**
 * The IR as Mermaid in the artifact's own dialect, or `null` when that
 * dialect cannot be written from an IR without losing what makes it that
 * dialect. `currentMermaid` is the diagram text as it stands (the fenced
 * block, for a hybrid artifact).
 */
export function serializeIRPreservingDialect(
    ir: DiagramIR,
    artifactType: string,
    currentMermaid: string,
): string | null {
    const c4Level = c4LevelOfArtifactType(artifactType);
    if (c4Level) return irToMermaidC4(ir, c4Level);
    const dialect = mermaidDialectOf(currentMermaid);
    if (ir.notation?.dialect === 'archimate' || hasArchimateMarker(currentMermaid)) {
        return serializeWithNotation(ir, 'flowchart', currentMermaid);
    }
    if (dialect === 'flowchart' || dialect === 'graph' || dialect === '') return irToMermaid(ir);
    return serializeWithNotation(ir, dialect, currentMermaid);
}

/**
 * Sequence, ER and state (8.3b). An IR stored before 8.3b has no notation:
 * it is recovered from the current text when the ids still match, and
 * otherwise the text is kept, exactly as before.
 */
function serializeWithNotation(ir: DiagramIR, dialect: string, currentMermaid: string): string | null {
    const current = mermaidToIR(currentMermaid);
    const notated = ir.notation ? ir : attachNotationFromSource(ir, current);
    if (!notated.notation || !notationMatchesDialect(notated.notation, dialect)) return null;
    if (notated.notation.unsupported.length > 0 || current.notation?.unsupported.length) return null;
    if (notationFingerprint(notated) === notationFingerprint(current)) return null;
    const written = serializeNotation(notated);
    if (!written) return null;
    // The guarantee, checked rather than assumed: what was written reads back
    // as the graph it was written from. (The notation itself may differ: the
    // writer drops references to what a patch removed.)
    return notationFingerprint(mermaidToIR(written), { graphOnly: true }) === notationFingerprint(notated, { graphOnly: true }) ? written : null;
}
