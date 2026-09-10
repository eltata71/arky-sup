import { describe, it, expect } from 'vitest';
import { mermaidToReactFlow, mermaidToExcalidraw, parseMermaidDeterministic } from '../../services/diagram';

interface ExBase {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    points?: [number, number][];
    text?: string;
}

describe('mermaidToReactFlow', () => {
    it('produces ReactFlow nodes and edges with stable ids', () => {
        const code = `flowchart LR\n  A[User] --> B[API]\n  B --> C[(DB)]`;
        const { nodes, edges } = mermaidToReactFlow(code);
        expect(nodes).toHaveLength(3);
        expect(edges).toHaveLength(2);
        expect(nodes.every(n => n.type === 'custom')).toBe(true);
        expect(nodes.every(n => typeof n.position.x === 'number' && typeof n.position.y === 'number')).toBe(true);
        expect(edges.every(e => e.type === 'custom')).toBe(true);
    });

    it('drops edges that reference missing nodes', () => {
        const ir = parseMermaidDeterministic(`flowchart LR\n  A --> B`);
        ir.edges.push({ id: 'ghost', source: 'ZZZ', target: 'A', label: 'Relaciona' });
        const { edges } = mermaidToReactFlow(`flowchart LR\n  A --> B`);
        expect(edges.find(e => e.id === 'ghost')).toBeUndefined();
    });

    it('reserves node space matching the real CustomNode footprint (no overlap)', () => {
        // Enough nodes to force TB layout. Verify that between-rank separation
        // accommodates the 160px-tall CustomNode footprint.
        const code = `flowchart TB\n  A[Frontend] --> B[API]\n  B --> C[Worker]\n  C --> D[(DB)]\n  B --> E[Cache]\n  B --> F[Queue]\n  F --> G[Audit]\n  G --> H[Archive]\n  H --> I[Report]`;
        const { nodes } = mermaidToReactFlow(code);
        const positions = nodes.map(n => n.position.y).sort((a, b) => a - b);
        const gaps: number[] = [];
        for (let i = 1; i < positions.length; i++) {
            const gap = positions[i] - positions[i - 1];
            if (gap > 1) gaps.push(gap);
        }
        const maxGap = Math.max(...gaps);
        expect(maxGap).toBeGreaterThanOrEqual(160);
    });

    it('propagates C4 kind metadata into node data', () => {
        const code = `C4Context\n  Person(u, "Auditor")\n  System(s, "EMA")\n  Rel(u, s, "Usa")`;
        const { nodes } = mermaidToReactFlow(code);
        const person = nodes.find(n => n.id === 'u')!;
        const system = nodes.find(n => n.id === 's')!;
        expect(person.data.kind).toBe('Person');
        expect(system.data.kind).toBe('System');
    });
});

describe('mermaidToExcalidraw', () => {
    it('emits rectangles, arrows and labels for a small graph', () => {
        const bundle = mermaidToExcalidraw(`flowchart LR\n  A[User] --> B[API]`, false);
        const types = (bundle.elements as ExBase[]).map(e => e.type);
        expect(types).toContain('rectangle');
        expect(types).toContain('arrow');
        expect(types).toContain('text');
    });

    it('respects dark-mode palette when flag is set', () => {
        const light = mermaidToExcalidraw(`flowchart LR\n  A --> B`, false);
        const dark = mermaidToExcalidraw(`flowchart LR\n  A --> B`, true);
        // Find the first semantic node rectangle (id begins with "node-") — group
        // / accent shapes come first and share bg with the canvas.
        const lightNode = (light.elements as ExBase[]).find(e => e.id.startsWith('node-') && !e.id.startsWith('node-label') && !e.id.startsWith('node-accent') && !e.id.startsWith('node-kind') && !e.id.startsWith('node-desc'))!;
        const darkNode  = (dark.elements  as ExBase[]).find(e => e.id.startsWith('node-') && !e.id.startsWith('node-label') && !e.id.startsWith('node-accent') && !e.id.startsWith('node-kind') && !e.id.startsWith('node-desc'))!;
        expect((lightNode as unknown as { backgroundColor: string }).backgroundColor)
            .not.toBe((darkNode as unknown as { backgroundColor: string }).backgroundColor);
    });

    it('routes arrows with ≥2 polyline points, not a single straight segment through node centres', () => {
        const bundle = mermaidToExcalidraw(`flowchart TB\n  A[User] --> B[Gateway]\n  B --> C[Service]\n  B --> D[Queue]`, false);
        const arrows = (bundle.elements as ExBase[]).filter(e => e.type === 'arrow');
        expect(arrows.length).toBe(3);
        for (const arrow of arrows) {
            expect(Array.isArray(arrow.points)).toBe(true);
            expect(arrow.points!.length).toBeGreaterThanOrEqual(2);
        }
    });

    it('fans multiple edges sharing a target across distinct endpoints', () => {
        // Three edges all end at D — the end point of each must differ so they
        // don't visually collide at the node centre.
        const bundle = mermaidToExcalidraw(`flowchart TB\n  A --> D\n  B --> D\n  C --> D`, false);
        const arrows = (bundle.elements as ExBase[]).filter(e => e.type === 'arrow');
        expect(arrows.length).toBe(3);
        const endPoints = arrows.map(a => {
            const last = a.points![a.points!.length - 1];
            return [a.x + last[0], a.y + last[1]] as const;
        });
        const unique = new Set(endPoints.map(p => `${Math.round(p[0])}:${Math.round(p[1])}`));
        expect(unique.size).toBeGreaterThanOrEqual(2);
    });

    it('places edge labels with background pills for legibility', () => {
        const bundle = mermaidToExcalidraw(`flowchart LR\n  A -->|Envía datos| B`, false);
        const hasLabelBg = (bundle.elements as ExBase[]).some(e => e.id.startsWith('edge-label-bg-'));
        const hasLabelText = (bundle.elements as ExBase[]).some(e => e.id.startsWith('edge-label-') && !e.id.includes('-bg-'));
        expect(hasLabelBg).toBe(true);
        expect(hasLabelText).toBe(true);
    });

    it('keeps group labels above their member nodes (breathing room)', () => {
        const code = `flowchart TB\n  subgraph core [Core]\n    A[Service A]\n    B[Service B]\n  end\n  A --> B`;
        const bundle = mermaidToExcalidraw(code, false);
        const groupRect = (bundle.elements as ExBase[]).find(e => e.id.startsWith('group-') && e.type === 'rectangle')!;
        const groupLabel = (bundle.elements as ExBase[]).find(e => e.id.startsWith('group-label-'))!;
        const nodeRects = (bundle.elements as ExBase[]).filter(e => e.id.startsWith('node-') && e.type === 'rectangle' && !e.id.startsWith('node-accent'));
        // Group starts above first node, with enough top padding so the label
        // does not intrude on the top row (≥ ~40px difference).
        const firstNodeY = Math.min(...nodeRects.map(n => n.y));
        expect(firstNodeY - groupRect.y).toBeGreaterThanOrEqual(40);
        // Label sits inside the group rectangle top band.
        expect(groupLabel.y).toBeGreaterThanOrEqual(groupRect.y);
        expect(groupLabel.y).toBeLessThan(firstNodeY);
    });

    it('renders distinct palette for C4 Person vs C4 System', () => {
        const code = `C4Context\n  Person(u, "Auditor")\n  System(s, "EMA")\n  Rel(u, s, "Usa")`;
        const bundle = mermaidToExcalidraw(code, false);
        const personRect = (bundle.elements as ExBase[]).find(e => e.id === 'node-u')!;
        const systemRect = (bundle.elements as ExBase[]).find(e => e.id === 'node-s')!;
        expect((personRect as unknown as { backgroundColor: string }).backgroundColor)
            .not.toBe((systemRect as unknown as { backgroundColor: string }).backgroundColor);
    });
});
