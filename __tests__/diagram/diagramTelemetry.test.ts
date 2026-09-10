/**
 * Tests for the diagram telemetry snapshot. The shape of the snapshot is
 * part of the observability contract — consumers (debug panel, logging,
 * `lastDiagramError`) read the same field names.
 */

import { describe, it, expect } from 'vitest';
import { buildDiagramTelemetry, formatTelemetrySnapshot } from '../../services/diagram/diagramTelemetry';
import type { DiagramIR } from '../../lib/diagram';
import type { DiagramQualityReport } from '../../services/diagram/quality/diagramQualityService';

const sampleIR: DiagramIR = {
    nodes: [
        { id: 'a', label: 'Asegurado', kind: 'Person', semanticType: 'human-actor', semanticRole: 'person' },
        { id: 'b', label: 'MuleSoft', kind: 'Container', semanticType: 'integration-platform', semanticRole: 'gateway', technology: 'MuleSoft' },
        { id: 'c', label: 'GMD', kind: 'System', semanticType: 'legacy-system', semanticRole: 'system' },
        { id: 'd', label: 'Stranded', kind: 'System', semanticType: 'generic', semanticRole: 'generic' },
    ],
    edges: [
        { id: 'e1', source: 'a', target: 'b', label: 'Consulta', protocol: 'REST/HTTPS', criticality: 'critical', direction: 'unidirectional', semanticType: 'rest-api' },
        { id: 'e2', source: 'b', target: 'c', label: 'Sincroniza catálogo', protocol: 'JDBC' },
        { id: 'e3', source: 'b', target: 'c', label: '' },
    ],
    groups: [{ id: 'g1', label: 'PALIC', nodeIds: ['b', 'c'] }],
    metadata: { sourceFormat: 'mermaid', title: 'Diagrama de Integración' },
};

describe('buildDiagramTelemetry', () => {
    it('returns deterministic counts for nodes and edges', () => {
        const snap = buildDiagramTelemetry(sampleIR);
        expect(snap.nodeCount).toBe(4);
        expect(snap.edgeCount).toBe(3);
        expect(snap.groupCount).toBe(1);
        expect(snap.genericNodes).toBe(1);
        expect(snap.nodesWithSemanticType).toBe(3);
        expect(snap.nodesWithTechnology).toBe(1);
        // None of the sample nodes declares `group` on the node itself; the
        // sample IR's group only lives in `metadata.groups`, which the
        // telemetry intentionally ignores (it counts per-node ownership).
        expect(snap.nodesWithoutGroup).toBe(4);
        expect(snap.orphanNodes).toBe(1); // d
    });

    it('summarises edge classification quality', () => {
        const snap = buildDiagramTelemetry(sampleIR);
        expect(snap.edgesWithProtocol).toBe(2);
        expect(snap.edgesWithCriticality).toBe(1);
        expect(snap.edgesWithDirection).toBe(1);
        expect(snap.edgesWithSemanticType).toBe(1);
        expect(snap.edgesMissingLabel).toBe(1);
    });

    it('detects the archetype from metadata.title', () => {
        const snap = buildDiagramTelemetry(sampleIR);
        expect(snap.archetype).toBe('integration');
    });

    it('captures degradation flags', () => {
        const placeholderIR: DiagramIR = {
            nodes: [{ id: 'placeholder-info', label: 'Marcador', kind: 'Placeholder' }],
            edges: [],
            groups: [],
            metadata: { degradationReason: 'no-parseable-content', title: 'Marcador de posición' },
        };
        const snap = buildDiagramTelemetry(placeholderIR);
        expect(snap.isPlaceholder).toBe(true);
        expect(snap.degradationReason).toBe('no-parseable-content');
    });

    it('includes quality summary when provided', () => {
        const quality: DiagramQualityReport = {
            score: 72,
            breakdown: {} as DiagramQualityReport['breakdown'],
            issues: [
                { id: 'i1', code: 'X', severity: 'critical', message: '', recommendation: '' },
                { id: 'i2', code: 'Y', severity: 'high', message: '', recommendation: '' },
                { id: 'i3', code: 'Z', severity: 'low', message: '', recommendation: '' },
            ],
            summary: '',
            suggestions: [
                { id: 's1', archetype: 'integration', severity: 'medium', category: 'integration-contract', title: '', justification: '', recommendedAction: '' },
            ],
        };
        const snap = buildDiagramTelemetry(sampleIR, { quality });
        expect(snap.qualityScore).toBe(72);
        expect(snap.qualityIssues).toBe(3);
        expect(snap.qualityCritical).toBe(1);
        expect(snap.qualityHigh).toBe(1);
        expect(snap.qualitySuggestions).toBe(1);
    });
});

describe('formatTelemetrySnapshot', () => {
    it('produces a multi-line human-readable string', () => {
        const snap = buildDiagramTelemetry(sampleIR);
        const text = formatTelemetrySnapshot(snap);
        expect(text).toContain('integration');
        expect(text).toContain('4 nodos');
        expect(text).toContain('3 aristas');
        expect(text).toContain('huérfanos');
    });
});
