import { describe, it, expect } from 'vitest';
import { extractIRFromArtifact } from '../../services/diagram';

describe('extractIRFromArtifact — react-flow-graph fallback to Mermaid', () => {
    it('falls through to Mermaid when JSON content has zero nodes', () => {
        const ir = extractIRFromArtifact({
            type: 'react-flow-graph',
            representation: 'diagram',
            content: '{"nodes":[],"edges":[]}',
        });
        // Falls through and finds nothing → returns null cleanly.
        expect(ir).toBeNull();
    });

    it('falls through to Mermaid when JSON parsing throws', () => {
        // Malformed JSON in a react-flow-graph artifact whose REAL content
        // happens to be a pasted Mermaid block. The parser must not lose
        // the diagram in this case.
        const ir = extractIRFromArtifact({
            type: 'react-flow-graph',
            representation: 'diagram',
            content: 'flowchart LR\n  A[User] --> B[API]',
        });
        expect(ir).not.toBeNull();
        expect(ir!.nodes.length).toBe(2);
    });

    it('still returns a valid IR for canonical react-flow-graph JSON', () => {
        const ir = extractIRFromArtifact({
            type: 'react-flow-graph',
            representation: 'diagram',
            content: JSON.stringify({
                nodes: [
                    { id: 'n1', data: { label: 'Alpha', type: 'service' } },
                    { id: 'n2', data: { label: 'Beta',  type: 'data' } },
                ],
                edges: [{ id: 'e1', source: 'n1', target: 'n2', label: 'reads' }],
            }),
        });
        expect(ir).not.toBeNull();
        expect(ir!.nodes.map(n => n.id).sort()).toEqual(['n1', 'n2']);
        expect(ir!.edges.length).toBe(1);
    });

    it('returns null only when truly nothing is recoverable', () => {
        const ir = extractIRFromArtifact({
            type: 'react-flow-graph',
            representation: 'diagram',
            content: '   \n   ',
        });
        expect(ir).toBeNull();
    });
});
