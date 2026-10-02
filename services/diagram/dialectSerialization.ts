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
 * So there are exactly two dialects an IR is written back into: C4 (by its
 * own serializer) and flowchart. Anything else returns `null`, and the caller
 * keeps the text it had — the IR still carries the repairs for the canvas.
 */

import type { DiagramIR } from '../../lib/diagram';
import { irToMermaid } from './irToMermaid';
import { irToReactFlow } from './irToReactFlow';
import { c4LevelOfArtifactType, irToMermaidC4 } from './irToMermaidC4';

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
    if (dialect === 'flowchart' || dialect === 'graph' || dialect === '') return irToMermaid(ir);
    return null;
}

/** The IR written for a flowchart (`mermaid-graph`, as Mermaid) or a React Flow artifact (as its JSON). */
export function serializeFlowArtifact(ir: DiagramIR, artifactType: 'mermaid-graph' | 'react-flow-graph'): string {
    return artifactType === 'react-flow-graph' ? JSON.stringify(irToReactFlow(ir)) : irToMermaid(ir);
}
