/**
 * Tests for the archetype-specific quality gates and suggestions.
 *
 * The general quality service returns a single 10-dimension rubric — these
 * gates layer archetype-aware checks on top so the suggestion panel can
 * tell the user *why* an integration diagram is incomplete vs. why a
 * context diagram has too much technical detail.
 */

import { describe, it, expect } from 'vitest';
import {
    buildArchetypeSuggestions,
    detectDiagramArchetype,
} from '../../services/diagram/diagramTypeQualityGates';
import type { DiagramIR } from '../../lib/diagram';

const emptyIR = (overrides: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: [],
    edges: [],
    groups: [],
    ...overrides,
});

describe('detectDiagramArchetype', () => {
    it('reads the title hint first', () => {
        const ir = emptyIR({ metadata: { title: 'Diagrama de Contexto C4' } });
        expect(detectDiagramArchetype(ir)).toBe('context');
        const ir2 = emptyIR({ metadata: { title: 'Diagrama de Integración PBM' } });
        expect(detectDiagramArchetype(ir2)).toBe('integration');
        const ir3 = emptyIR({ metadata: { title: 'Diagrama de Contenedores · Wee Company' } });
        expect(detectDiagramArchetype(ir3)).toBe('container');
        const ir4 = emptyIR({ metadata: { title: 'Proceso BPMN de Reclamaciones' } });
        expect(detectDiagramArchetype(ir4)).toBe('process');
    });

    it('falls back to C4 kinds when the title is silent', () => {
        const ir = emptyIR({
            nodes: [
                { id: 'a', label: 'Asegurado', kind: 'Person' },
                { id: 'b', label: 'PBM', kind: 'SoftwareSystem' },
            ],
        });
        expect(detectDiagramArchetype(ir)).toBe('context');
    });

    it('detects integration when integration / messaging / cloud nodes dominate', () => {
        const ir = emptyIR({
            nodes: [
                { id: 'mule', label: 'MuleSoft', kind: 'Container', semanticType: 'integration-platform' },
                { id: 'queue', label: 'Kafka EOB', kind: 'Container', semanticType: 'messaging' },
                { id: 's3', label: 'AWS S3', kind: 'Container', semanticType: 'cloud-service' },
                { id: 'core', label: 'Core PBM', kind: 'Container', semanticType: 'internal-system' },
            ],
        });
        expect(detectDiagramArchetype(ir)).toBe('integration');
    });

    it('returns generic when there is no signal', () => {
        const ir = emptyIR({
            nodes: [
                { id: 'a', label: 'Foo', kind: 'Unknown' },
                { id: 'b', label: 'Bar', kind: 'Unknown' },
            ],
        });
        expect(detectDiagramArchetype(ir)).toBe('generic');
    });
});

describe('buildArchetypeSuggestions — context diagram', () => {
    it('warns when there are too many nodes for a context view', () => {
        const ir = emptyIR({
            metadata: { title: 'Diagrama de Contexto' },
            nodes: Array.from({ length: 18 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, kind: 'SoftwareSystem' })),
        });
        const suggestions = buildArchetypeSuggestions(ir);
        expect(suggestions.some((s) => s.id === 'context-too-many-nodes')).toBe(true);
    });

    it('warns when there are no actors / external systems', () => {
        const ir = emptyIR({
            metadata: { title: 'Diagrama de Contexto' },
            nodes: [
                { id: 'a', label: 'PBM Core', kind: 'SoftwareSystem', semanticType: 'internal-system' },
                { id: 'b', label: 'Claims Engine', kind: 'SoftwareSystem', semanticType: 'internal-system' },
            ],
        });
        const suggestions = buildArchetypeSuggestions(ir);
        expect(suggestions.some((s) => s.id === 'context-missing-actors')).toBe(true);
    });

    it('warns when the context diagram contains technical noise', () => {
        const ir = emptyIR({
            metadata: { title: 'Diagrama de Contexto' },
            nodes: [
                { id: 'a', label: 'Asegurado', kind: 'Person', semanticType: 'human-actor' },
                { id: 'b', label: 'Sidecar Istio', kind: 'Container', semanticType: 'service' },
            ],
        });
        const suggestions = buildArchetypeSuggestions(ir);
        expect(suggestions.some((s) => s.id === 'context-technical-noise')).toBe(true);
    });
});

describe('buildArchetypeSuggestions — integration diagram', () => {
    it('warns when there is no integration platform on an integration diagram', () => {
        const ir = emptyIR({
            metadata: { title: 'Diagrama de Integración' },
            nodes: [
                { id: 'a', label: 'Core PBM', kind: 'Container', semanticType: 'internal-system' },
                { id: 'b', label: 'Pharmacy', kind: 'SoftwareSystem', semanticType: 'external-system' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'Procesa dispensación', protocol: 'REST/HTTPS' }],
        });
        const suggestions = buildArchetypeSuggestions(ir);
        expect(suggestions.some((s) => s.id === 'integration-missing-platform')).toBe(true);
    });

    it('warns when relations are missing protocol', () => {
        const ir = emptyIR({
            metadata: { title: 'Diagrama de Integración' },
            nodes: [
                { id: 'mule', label: 'MuleSoft', kind: 'Container', semanticType: 'integration-platform' },
                { id: 'core', label: 'Core', kind: 'Container', semanticType: 'internal-system' },
            ],
            edges: [
                { id: 'e1', source: 'core', target: 'mule', label: 'Envía datos' },
            ],
        });
        const suggestions = buildArchetypeSuggestions(ir);
        expect(suggestions.some((s) => s.id === 'integration-edges-without-protocol')).toBe(true);
    });

    it('warns when critical relations have no security hint', () => {
        const ir = emptyIR({
            metadata: { title: 'Diagrama de Integración' },
            nodes: [
                { id: 'mule', label: 'MuleSoft', kind: 'Container', semanticType: 'integration-platform' },
                { id: 'core', label: 'Core', kind: 'Container', semanticType: 'internal-system' },
            ],
            edges: [
                { id: 'e1', source: 'core', target: 'mule', label: 'Consulta póliza', protocol: 'REST/HTTPS', criticality: 'critical' },
            ],
        });
        const suggestions = buildArchetypeSuggestions(ir);
        expect(suggestions.some((s) => s.id === 'integration-edges-without-security')).toBe(true);
    });

    it('warns when async messaging has no retry policy', () => {
        const ir = emptyIR({
            metadata: { title: 'Diagrama de Integración' },
            nodes: [
                { id: 'mule', label: 'MuleSoft', kind: 'Container', semanticType: 'integration-platform' },
                { id: 'core', label: 'Core', kind: 'Container', semanticType: 'internal-system' },
            ],
            edges: [
                { id: 'e1', source: 'mule', target: 'core', label: 'Publica EOB', protocol: 'Kafka', semanticType: 'async-messaging' },
            ],
        });
        const suggestions = buildArchetypeSuggestions(ir);
        expect(suggestions.some((s) => s.id === 'integration-async-no-retry')).toBe(true);
    });
});

describe('buildArchetypeSuggestions — process diagram', () => {
    it('warns when there is no start / end / lanes', () => {
        const ir = emptyIR({
            metadata: { title: 'Proceso BPMN' },
            nodes: [
                { id: 'a', label: 'Captura datos', kind: 'process' },
                { id: 'b', label: 'Valida elegibilidad', kind: 'process' },
                { id: 'c', label: 'Notifica resultado', kind: 'process' },
                { id: 'd', label: 'Cierra ticket', kind: 'process' },
            ],
        });
        const suggestions = buildArchetypeSuggestions(ir);
        const ids = suggestions.map((s) => s.id);
        expect(ids).toContain('process-missing-start');
        expect(ids).toContain('process-missing-end');
        expect(ids).toContain('process-no-lanes');
    });
});

describe('buildArchetypeSuggestions — cross-archetype rules', () => {
    it('always flags generic nodes regardless of archetype', () => {
        const ir = emptyIR({
            metadata: { title: 'Diagrama de Contenedores' },
            nodes: [
                { id: 'a', label: 'Foo', kind: 'Generic', semanticRole: 'generic', semanticType: 'generic' },
                { id: 'b', label: 'Bar', kind: 'Generic', semanticRole: 'generic', semanticType: 'generic' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'Llama', protocol: 'REST' }],
        });
        const suggestions = buildArchetypeSuggestions(ir);
        expect(suggestions.some((s) => s.id === 'classification-generic-nodes')).toBe(true);
    });
});
