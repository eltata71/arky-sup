import { describe, it, expect } from 'vitest';
import { resolveRenderableDiagram } from '../../services/diagram/resolveRenderableDiagram';
import type { Artifact } from '../../types';
import type { DiagramIR } from '../../lib/diagram';

const baseArtifact: Pick<Artifact, 'id' | 'type' | 'content' | 'representation' | 'ir'> = {
    id: 'artifact-1',
    type: 'mermaid-c4-container',
    content: '',
    representation: 'diagram',
};

describe('resolveRenderableDiagram defensive paths', () => {
    it('renders even when an IR node has an empty label (falls back to id)', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'svc', label: 'API', kind: 'service' },
                { id: 'orphan', label: '', kind: 'service' },
            ],
            edges: [{ id: 'e1', source: 'svc', target: 'orphan', label: 'Llama HTTPS' }],
            groups: [],
        };
        const result = resolveRenderableDiagram({ ...baseArtifact, ir }, { audience: 'technical' });
        expect(result.status).toBe('ready');
        // Both nodes survive — the empty-label one was patched, not dropped.
        expect(result.reactFlow.nodes.length).toBe(2);
        const patched = result.reactFlow.nodes.find((n) => n.id === 'orphan');
        // The conservative render-time gate fills empty labels (with id) but
        // does NOT humanise them (no visual surprise on every render). Auto-
        // mejorar can polish them later.
        expect(patched?.data.label).toBe('orphan');
    });

    it('never returns an empty canvas when the IR has nodes', () => {
        const ir: DiagramIR = {
            nodes: Array.from({ length: 3 }).map((_, i) => ({
                id: `n${i}`,
                label: `Node ${i}`,
                kind: 'service',
            })),
            edges: [],
            groups: [],
        };
        const result = resolveRenderableDiagram({ ...baseArtifact, ir }, { audience: 'technical' });
        expect(result.reactFlow.nodes.length).toBe(3);
        expect(result.status).toBe('ready');
    });

    it('falls back to baseIR when the audience projection is empty', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'Solo node', kind: 'generic' },
            ],
            edges: [],
            groups: [],
        };
        const result = resolveRenderableDiagram({ ...baseArtifact, ir }, { audience: 'technical' });
        expect(result.reactFlow.nodes.length).toBeGreaterThan(0);
    });
});
