import { describe, it, expect } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { inferDiagramType, annotateDiagramType } from '../../services/diagram/diagramTypeInference';

const baseIR = (overrides: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: [],
    edges: [],
    groups: [],
    metadata: {},
    ...overrides,
});

describe('Phase 2 — diagramType inference', () => {
    it('honours an existing metadata.diagramType verbatim', () => {
        const ir = baseIR({ metadata: { diagramType: 'value-stream' } });
        expect(inferDiagramType({ ir })).toBe('value-stream');
    });

    it('maps the artifact type when set unambiguously', () => {
        expect(inferDiagramType({ ir: baseIR(), artifactType: 'mermaid-c4-context' })).toBe('c4-context');
        expect(inferDiagramType({ ir: baseIR(), artifactType: 'mermaid-c4-container' })).toBe('c4-container');
        expect(inferDiagramType({ ir: baseIR(), artifactType: 'mermaid-c4-component' })).toBe('c4-component');
        expect(inferDiagramType({ ir: baseIR(), artifactType: 'mermaid-c4-deployment' })).toBe('c4-deployment');
        expect(inferDiagramType({ ir: baseIR(), artifactType: 'mermaid-erd' })).toBe('erd');
        expect(inferDiagramType({ ir: baseIR(), artifactType: 'mermaid-sequence' })).toBe('sequence');
    });

    it('infers BPMN process from title keywords', () => {
        const ir = baseIR({
            metadata: { title: 'Proceso BPMN claims adjudication' },
            nodes: [
                { id: 'start', label: 'Inicio', kind: 'process' },
                { id: 't1', label: 'Task', kind: 'task' },
                { id: 'end', label: 'Fin', kind: 'process' },
            ],
        });
        expect(inferDiagramType({ ir })).toBe('bpmn-process');
    });

    it('infers value stream from title keywords', () => {
        const ir = baseIR({
            metadata: { title: 'Value Stream Map – Onboarding' },
            nodes: [{ id: 'a', label: 'A', kind: 'process' }],
        });
        expect(inferDiagramType({ ir })).toBe('value-stream');
    });

    it('infers integration from labels mentioning iPaaS/Kafka/etc.', () => {
        const ir = baseIR({
            metadata: { title: 'Architecture' },
            nodes: [
                { id: 'kafka', label: 'Kafka Cluster', kind: 'messaging' },
                { id: 'orch', label: 'API Gateway', kind: 'gateway' },
            ],
        });
        expect(inferDiagramType({ ir })).toBe('integration');
    });

    it('infers c4-context from C4 person/system kinds', () => {
        const ir = baseIR({
            nodes: [
                { id: 'p', label: 'Member', kind: 'Person' },
                { id: 's', label: 'Core', kind: 'System' },
            ],
        });
        expect(inferDiagramType({ ir })).toBe('c4-context');
    });

    it('falls back to generic when no signal is found', () => {
        const ir = baseIR({
            nodes: [
                { id: 'x', label: 'Foo', kind: 'thing' },
                { id: 'y', label: 'Bar', kind: 'thing' },
            ],
        });
        expect(inferDiagramType({ ir })).toBe('generic');
    });

    it('annotateDiagramType clones metadata and never mutates the input', () => {
        const ir = baseIR({
            nodes: [{ id: 'p', label: 'Member', kind: 'Person' }],
        });
        const annotated = annotateDiagramType(ir);
        expect(annotated.metadata?.diagramType).toBe('c4-context');
        // input remains untouched
        expect(ir.metadata?.diagramType).toBeUndefined();
    });

    it('annotateDiagramType is a no-op when diagramType is already set', () => {
        const ir = baseIR({ metadata: { diagramType: 'data-flow' } });
        const annotated = annotateDiagramType(ir);
        expect(annotated).toBe(ir);
    });
});
