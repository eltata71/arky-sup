import { describe, it, expect } from 'vitest';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';
import { runDiagramQualityGate } from '../../services/diagram/qualityGate';
import { irToReactFlow } from '../../services/diagram/irToReactFlow';

describe('Value Stream Map — full pipeline', () => {
    it('parses a Spanish VSM into a renderable IR with process kinds', () => {
        const code = `flowchart LR
    Cliente[Cliente] -->|Solicita producto| Pedido[Recepción de Pedido]
    Pedido -->|LT 1d| Diseno[Diseño]
    Diseno -->|LT 5d| Produccion[Producción]
    Produccion -->|LT 3d| Empaque[Empaque]
    Empaque -->|LT 1d| Entrega[Entrega al Cliente]
    Entrega -->|Feedback| Cliente`;
        const ir = mermaidToIR(code);
        expect(ir.nodes.length).toBe(6);
        expect(ir.edges.length).toBe(6);
        // Process labels are classified as `process` (not `service`).
        const produccion = ir.nodes.find(n => n.id === 'Produccion');
        expect(produccion?.kind).toBe('process');
        const cliente = ir.nodes.find(n => n.id === 'Cliente');
        expect(cliente?.kind).toBe('person');
    });

    it('survives the quality gate with no node loss', () => {
        const code = `flowchart LR
    A[Solicita] --> B[Aprueba]
    B --> C[Produce]
    C --> D[Entrega]`;
        const ir = mermaidToIR(code);
        const gate = runDiagramQualityGate(ir, {
            artifact: { type: 'hybrid-text-diagram', name: 'VSM' },
            audience: 'technical',
        });
        expect(gate.ir.nodes.length).toBeGreaterThanOrEqual(ir.nodes.length);
    });

    it('renders a process flow without dropping nodes through ReactFlow', () => {
        const code = `flowchart LR
    A[Cliente] -->|Solicita| B[Pedido]
    B -->|LT 2d| C[Producción]
    C -->|PT 5d| D[Entrega]`;
        const ir = mermaidToIR(code);
        const flow = irToReactFlow(ir);
        expect(flow.nodes.length).toBe(4);
        expect(flow.edges.length).toBe(3);
    });
});
