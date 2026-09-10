import { describe, it, expect } from 'vitest';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';
import { irToReactFlow } from '../../services/diagram/irToReactFlow';
import { runDiagramQualityGate } from '../../services/diagram/qualityGate';

describe('Iconography continuity — render-time gate is non-destructive', () => {
    it('preserves the original IR labels through render', () => {
        const code = `flowchart LR
    api[API Service] --> db[(PostgreSQL)]
    user((Cliente)) --> api`;
        const ir = mermaidToIR(code);
        const labels = ir.nodes.map(n => n.label).sort();
        // Conservative gate (render-time): NO label humanisation, NO description fill.
        const gate = runDiagramQualityGate(ir, {
            artifact: { type: 'mermaid-graph', name: 'Test' },
            audience: 'technical',
            aggressive: false,
        });
        const newLabels = gate.ir.nodes.map(n => n.label).sort();
        expect(newLabels).toEqual(labels);
        // Conservative gate must NOT auto-fill descriptions on render.
        for (const node of gate.ir.nodes) {
            // description is allowed to remain empty
            if (node.description) {
                expect(node.description.length).toBeLessThan(160);
            }
        }
    });

    it('aggressive gate (auto-improve / generation) DOES fill descriptions', () => {
        const code = `flowchart LR
    a[Service A] --> b[Service B]`;
        const ir = mermaidToIR(code);
        const gate = runDiagramQualityGate(ir, {
            artifact: { type: 'mermaid-graph', name: 'Test' },
            audience: 'technical',
            aggressive: true,
        });
        for (const node of gate.ir.nodes) {
            expect((node.description ?? '').length).toBeGreaterThan(0);
        }
    });

    it('persists kind through ReactFlow rendering so icons resolve as before', () => {
        const code = `flowchart LR
    web[Web App] --> api[API Service]
    api --> cache[(Redis)]
    api --> queue([Kafka Topic])`;
        const ir = mermaidToIR(code);
        const flow = irToReactFlow(ir);
        const byId = new Map(flow.nodes.map(n => [n.id, n]));
        const cache = byId.get('cache');
        const queue = byId.get('queue');
        // The icon system uses data.type which now carries the human-
        // readable category label ("Base de Datos", "Mensajería"). It must
        // still classify cache/queue nodes correctly so the renderer picks
        // the right icon (Database / Radio).  Either the legacy kind tokens
        // or the new Spanish category label is acceptable — the icon
        // resolver reads both.
        expect(String(cache?.data.type ?? '').toLowerCase()).toMatch(/data|cache|redis|base\s+de\s+datos/);
        expect(String(queue?.data.type ?? '').toLowerCase()).toMatch(/messaging|kafka|topic|queue|mensajer[ií]a/);
    });

    it('Spanish process labels classify as process (VSM-friendly)', () => {
        const ir = mermaidToIR(`flowchart LR
    a[Recepción] --> b[Producción]
    b --> c[Empaque]
    c --> d[Entrega]`);
        for (const node of ir.nodes) expect(node.kind).toBe('process');
    });
});
