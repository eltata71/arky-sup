import { describe, it, expect } from 'vitest';
import {
    analyzeDiagramQuality,
    buildDiagramPreflightReport,
} from '../../services/diagram/quality/diagramQualityService';
import type { DiagramIR } from '../../lib/diagram';

/**
 * Hardening: a structurally valid IR (≥2 nodes, ≥1 edge) used to be exportable
 * even if it was a placeholder ("Diagrama no disponible"), a deterministic
 * skeleton fallback, or carried an explicit `metadata.degradationReason`.
 *
 * The preflight now emits a dedicated `generation-state` check that hard-fails
 * on placeholder/skeleton IRs and warns on other degradation markers, so
 * formal exports cannot ship the fallback content.
 */

const baseIR = (extras: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: [
        { id: 'a', label: 'Cliente', kind: 'person', description: 'Asegurado.' },
        { id: 'b', label: 'API Reservas', kind: 'service', description: 'API REST.' },
    ],
    edges: [
        { id: 'e1', source: 'a', target: 'b', label: 'Crea reserva REST/HTTPS', relation: 'sync' },
    ],
    groups: [],
    metadata: {
        title: 'Reservas',
        narrative: 'Resumen ejecutivo del flujo.',
        generatedAt: new Date().toISOString(),
    },
    ...extras,
});

describe('preflight · estado de generación', () => {
    it('blocks export when IR is the resolver placeholder ("no-parseable-content")', () => {
        const ir = baseIR({
            nodes: [
                { id: 'placeholder-info', label: 'Diagrama no disponible', kind: 'system' },
                { id: 'placeholder-action', label: 'Generar de nuevo', kind: 'process' },
            ],
            edges: [
                { id: 'placeholder-edge', source: 'placeholder-info', target: 'placeholder-action', label: 'Acción sugerida' },
            ],
            metadata: {
                title: 'Marcador de posición',
                degradationReason: 'no-parseable-content',
            },
        });
        const report = buildDiagramPreflightReport(ir, analyzeDiagramQuality(ir));
        const check = report.checks.find((c) => c.id === 'generation-state');
        expect(check?.status).toBe('fail');
        expect(check?.detail).toMatch(/Marcador de posición/);
        expect(report.ready).toBe(false);
    });

    it('blocks export when the IR is a deterministic skeleton fallback', () => {
        const ir = baseIR({
            metadata: {
                ...baseIR().metadata,
                fallback: 'skeleton',
                degradationReason: 'modelo agotó reintentos',
            },
        });
        const report = buildDiagramPreflightReport(ir, analyzeDiagramQuality(ir));
        const check = report.checks.find((c) => c.id === 'generation-state');
        expect(check?.status).toBe('fail');
        expect(check?.detail).toMatch(/Esqueleto base/);
        expect(report.ready).toBe(false);
    });

    it('warns (does not block by itself) when an unrelated degradationReason is set', () => {
        const ir = baseIR({
            metadata: {
                ...baseIR().metadata,
                degradationReason: 'audiencia ejecutiva proyectó vista limitada',
            },
        });
        const report = buildDiagramPreflightReport(ir, analyzeDiagramQuality(ir));
        const check = report.checks.find((c) => c.id === 'generation-state');
        expect(check?.status).toBe('warn');
        expect(check?.detail).toMatch(/degradado/);
    });

    it('passes when there are no degradation markers', () => {
        const ir = baseIR();
        const report = buildDiagramPreflightReport(ir, analyzeDiagramQuality(ir));
        const check = report.checks.find((c) => c.id === 'generation-state');
        expect(check?.status).toBe('pass');
    });

    it('detects placeholder by node-id signature even without degradationReason metadata', () => {
        // Defence-in-depth: persisted artefacts authored by older builds may
        // still carry the placeholder nodes without the metadata flag.
        const ir = baseIR({
            nodes: [
                { id: 'placeholder-info', label: 'Diagrama no disponible', kind: 'system' },
                { id: 'placeholder-action', label: 'Generar de nuevo', kind: 'process' },
            ],
            edges: [
                { id: 'edge1', source: 'placeholder-info', target: 'placeholder-action', label: 'x' },
            ],
            metadata: { title: 'sin marcador' },
        });
        const report = buildDiagramPreflightReport(ir, analyzeDiagramQuality(ir));
        const check = report.checks.find((c) => c.id === 'generation-state');
        expect(check?.status).toBe('fail');
        expect(report.ready).toBe(false);
    });
});
