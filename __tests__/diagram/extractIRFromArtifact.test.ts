import { describe, expect, it } from 'vitest';
import { extractIRFromArtifact } from '../../services/diagram';

describe('extractIRFromArtifact', () => {
    it('returns null for empty content', () => {
        expect(extractIRFromArtifact({ content: '', representation: 'diagram', type: 'mermaid-c4-context' })).toBeNull();
    });

    it('parses raw Mermaid (representation=diagram)', () => {
        const mermaid = `flowchart LR\n  A[Usuario] --> B[API Gateway]\n  B --> C[(DB)]`;
        const ir = extractIRFromArtifact({ content: mermaid, representation: 'diagram', type: 'mermaid-graph' });
        expect(ir).not.toBeNull();
        expect(ir!.nodes.length).toBe(3);
        expect(ir!.edges.length).toBe(2);
    });

    it('parses Mermaid embedded in markdown hybrid content', () => {
        const hybrid = `# Summary\n\nSome text.\n\n\`\`\`mermaid\nflowchart TD\n  A --> B\n\`\`\`\n\nMore text.`;
        const ir = extractIRFromArtifact({ content: hybrid, representation: 'hybrid', type: 'hybrid-text-diagram' });
        expect(ir).not.toBeNull();
        expect(ir!.nodes.length).toBe(2);
    });

    it('builds IR from react-flow JSON artifacts', () => {
        const payload = JSON.stringify({
            nodes: [
                { id: 'n1', data: { label: 'Front', type: 'web' } },
                { id: 'n2', data: { label: 'API', type: 'service', group: 'Backend' } },
            ],
            edges: [{ id: 'e1', source: 'n1', target: 'n2', label: 'calls', data: { edgeType: 'sync' } }],
        });
        const ir = extractIRFromArtifact({ content: payload, representation: 'diagram', type: 'react-flow-graph' });
        expect(ir).not.toBeNull();
        expect(ir!.nodes.map(n => n.id).sort()).toEqual(['n1', 'n2']);
        expect(ir!.edges[0]).toMatchObject({ source: 'n1', target: 'n2', label: 'calls', relation: 'sync' });
        expect(ir!.groups.length).toBe(1);
    });

    it('returns null when react-flow JSON is malformed', () => {
        expect(extractIRFromArtifact({ content: '{not json', representation: 'diagram', type: 'react-flow-graph' })).toBeNull();
    });
});
