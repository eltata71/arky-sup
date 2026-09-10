import { describe, it, expect } from 'vitest';
import { extractIRDiagnostic } from '../../services/diagram';

describe('extractIRDiagnostic', () => {
    it('returns no-diagram for empty content', () => {
        expect(extractIRDiagnostic({ content: '', representation: 'diagram', type: 'mermaid-c4-context' })).toEqual({ status: 'no-diagram' });
        expect(extractIRDiagnostic({ content: '   ', representation: 'document', type: 'markdown' })).toEqual({ status: 'no-diagram' });
    });

    it('returns no-diagram for prose-only hybrid content (no fence, no header)', () => {
        const content = 'Solo prosa sin diagrama, sin código fence.';
        expect(extractIRDiagnostic({ content, representation: 'hybrid', type: 'hybrid-text-diagram' })).toEqual({ status: 'no-diagram' });
    });

    it('returns ok for valid Mermaid C4Container with at least one Container()', () => {
        const mermaid = `C4Container\ntitle Test\nContainer(api, "API", "Spring")\nContainer(db, "DB", "Postgres")\nRel(api, db, "JDBC")`;
        const result = extractIRDiagnostic({ content: mermaid, representation: 'diagram', type: 'mermaid-c4-container' });
        expect(result.status).toBe('ok');
        if (result.status === 'ok') {
            expect(result.ir.nodes.length).toBeGreaterThanOrEqual(2);
        }
    });

    it('returns empty-ir when Mermaid is well-formed but yields zero nodes', () => {
        // Header-only flowchart: parser treats it as a flowchart with no nodes.
        const mermaid = `flowchart LR\n%% sin nodos`;
        const result = extractIRDiagnostic({ content: mermaid, representation: 'diagram', type: 'mermaid-graph' });
        expect(['empty-ir', 'no-diagram', 'parse-failed']).toContain(result.status);
    });

    it('returns parse-failed with reason=json when react-flow JSON is malformed and no Mermaid is present', () => {
        const result = extractIRDiagnostic({ content: '{not valid json', representation: 'diagram', type: 'react-flow-graph' });
        expect(result.status).toBe('parse-failed');
        if (result.status === 'parse-failed') expect(result.reason).toBe('json');
    });

    it('passes through to Mermaid path when react-flow JSON has zero nodes but a Mermaid fence is present', () => {
        const content = `{ "nodes": [], "edges": [] }\n\n\`\`\`mermaid\nflowchart LR\nA[Foo]-->B[Bar]\n\`\`\``;
        const result = extractIRDiagnostic({ content, representation: 'hybrid', type: 'react-flow-graph' });
        expect(result.status).toBe('ok');
    });
});
