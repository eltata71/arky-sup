import { describe, it, expect } from 'vitest';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';

describe('mermaidToIR — extended flowchart syntaxes', () => {
    it('parses inline label syntax "A -- label --> B"', () => {
        const ir = mermaidToIR(`flowchart LR
    A[Cliente] -- Solicita --> B[API]`);
        expect(ir.nodes.length).toBe(2);
        expect(ir.edges.length).toBe(1);
        expect(ir.edges[0].label).toBe('Solicita');
    });

    it('parses dotted inline label syntax "A -. label .-> B"', () => {
        const ir = mermaidToIR(`flowchart LR
    A[Cliente] -. Notifica .-> B[Worker]`);
        expect(ir.edges.length).toBe(1);
        expect(ir.edges[0].label).toBe('Notifica');
        expect(ir.edges[0].relation).toBe('async');
    });

    it('parses thick equals link "A === B"', () => {
        const ir = mermaidToIR(`flowchart LR
    A === B`);
        expect(ir.edges.length).toBe(1);
        expect(ir.edges[0].relation).toBe('data-flow');
    });
});

describe('mermaidToIR — extended sequence operators', () => {
    it('treats "-)" as async messages', () => {
        const ir = mermaidToIR(`sequenceDiagram
    participant A
    participant B
    A-)B: Notifica`);
        expect(ir.edges.length).toBe(1);
        expect(ir.edges[0].relation).toBe('async');
    });

    it('treats "--)" as async messages', () => {
        const ir = mermaidToIR(`sequenceDiagram
    participant A
    participant B
    A--)B: Confirma async`);
        expect(ir.edges.length).toBe(1);
        expect(ir.edges[0].relation).toBe('async');
    });
});

describe('mermaidToIR — state machine pseudo-states', () => {
    it('renders <<choice>> as a diamond node', () => {
        const ir = mermaidToIR(`stateDiagram-v2
    [*] --> Idle
    Idle --> decide
    decide <<choice>>
    decide --> Approved
    decide --> Rejected`);
        const decide = ir.nodes.find((n) => n.id === 'decide');
        expect(decide?.shape).toBe('diamond');
    });
});

describe('mermaidToIR — canonical kind classification', () => {
    it('infers canonical service kind for unknown labels in flowcharts', () => {
        const ir = mermaidToIR(`flowchart LR
    OrderService[Order Service] --> Payments[Payments Worker]`);
        const order = ir.nodes.find((n) => n.id === 'OrderService');
        const payments = ir.nodes.find((n) => n.id === 'Payments');
        expect(order?.kind).toBe('service');
        expect(payments?.kind).toBe('service');
    });

    it('infers canonical data kind for database-like labels', () => {
        const ir = mermaidToIR(`flowchart LR
    A[(PostgreSQL Orders)] --> B[(Redis Cache)]`);
        for (const node of ir.nodes) expect(node.kind).toBe('data');
    });
});
