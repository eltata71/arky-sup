/**
 * Tests for `lib/diagramCategoryLabels` — the resolver that maps semantic
 * IR fields into the user-facing badge text. The screenshots that motivated
 * this work showed every node badged as "GENERIC" because the raw `kind`
 * was bleeding through; these tests pin the new contract so the regression
 * cannot return silently.
 */

import { describe, it, expect } from 'vitest';
import {
    resolveNodeCategoryLabel,
    resolveEdgeCategoryLabel,
    getNodeCategoryLabel,
    getEdgeCategoryLabel,
} from '../../lib/diagramCategoryLabels';
import { normalizeDiagramNodeSemantics } from '../../lib/semanticRoleResolver';
import type { DiagramIRNode } from '../../lib/diagram';

const node = (overrides: Partial<DiagramIRNode> = {}): DiagramIRNode => ({
    id: 'n1',
    label: 'Componente',
    kind: 'system',
    ...overrides,
});

describe('resolveNodeCategoryLabel', () => {
    it('returns the technology hint verbatim when present', () => {
        expect(resolveNodeCategoryLabel(node({ technology: 'MuleSoft 4' }))).toBe('MuleSoft 4');
        expect(resolveNodeCategoryLabel(node({ technology: 'PostgreSQL 15' }))).toBe('PostgreSQL 15');
    });

    it('ignores placeholder technology strings ("generic", "n/a", …)', () => {
        const result = resolveNodeCategoryLabel(node({ technology: 'generic', semanticType: 'database' }));
        expect(result).toBe('Base de Datos');
    });

    it('uses the human-readable semanticType when set', () => {
        expect(resolveNodeCategoryLabel(node({ semanticType: 'legacy-system' }))).toBe('Sistema Legacy');
        expect(resolveNodeCategoryLabel(node({ semanticType: 'integration-platform' }))).toBe('Integración');
        expect(resolveNodeCategoryLabel(node({ semanticType: 'cloud-service' }))).toBe('Servicio Cloud');
        expect(resolveNodeCategoryLabel(node({ semanticType: 'document-repository' }))).toBe('Repositorio Doc.');
        expect(resolveNodeCategoryLabel(node({ semanticType: 'portal' }))).toBe('Portal / Canal');
        expect(resolveNodeCategoryLabel(node({ semanticType: 'human-actor' }))).toBe('Actor');
    });

    it('falls back to the semantic role when semanticType is missing or "generic"', () => {
        expect(resolveNodeCategoryLabel(node({ semanticRole: 'data', semanticType: 'generic' }))).toBe('Base de Datos');
        expect(resolveNodeCategoryLabel(node({ semanticRole: 'system' }))).toBe('Sistema');
        expect(resolveNodeCategoryLabel(node({ semanticRole: 'process' }))).toBe('Proceso');
    });

    it('never returns the literal string "GENERIC" when the role carries information', () => {
        const samples = [
            node({ semanticRole: 'system', kind: 'Generic' }),
            node({ semanticRole: 'data',   kind: 'Generic' }),
            node({ semanticRole: 'person', kind: 'Generic' }),
        ];
        for (const n of samples) {
            expect(resolveNodeCategoryLabel(n).toLowerCase()).not.toBe('generic');
        }
    });

    it('produces a friendly badge for the PBM/insurance domain', () => {
        // End-to-end: ask the normalizer to classify, then ask the labeller.
        const cases = [
            { input: { id: 'a', label: 'GMD', kind: 'System' },              expected: 'Sistema Legacy' },
            { input: { id: 'b', label: 'Simasec', kind: 'System' },          expected: 'Sistema Legacy' },
            { input: { id: 'c', label: 'MuleSoft Integration', kind: 'Container' }, expected: 'Integración' },
            { input: { id: 'd', label: 'AWS Lambda', kind: 'service' },      expected: 'Servicio Cloud' },
            { input: { id: 'e', label: 'Amazon SES', kind: 'service' },      expected: 'Notificaciones' },
            { input: { id: 'f', label: 'Benefits Direct', kind: 'System' },  expected: 'Portal / Canal' },
            { input: { id: 'g', label: 'Asegurado', kind: 'person' },        expected: 'Actor' },
            { input: { id: 'h', label: 'Médico prescriptor', kind: 'person' }, expected: 'Actor' },
            { input: { id: 'i', label: 'Box', kind: 'System' },              expected: 'Repositorio Doc.' },
            { input: { id: 'j', label: 'farmacia-dispensador', kind: 'System' }, expected: 'Proveedor Externo' },
            { input: { id: 'k', label: 'palic-gmd', kind: 'System' },         expected: 'Sistema Legacy' },
        ];

        for (const { input, expected } of cases) {
            const { node: classified } = normalizeDiagramNodeSemantics(input as DiagramIRNode);
            const label = resolveNodeCategoryLabel(classified, { preferTechnology: false });
            expect(label, `label for ${input.label}`).toBe(expected);
        }
    });

    it('supports an English variant for the technical-en audience', () => {
        expect(resolveNodeCategoryLabel(node({ semanticType: 'legacy-system' }), { language: 'en' })).toBe('Legacy System');
        expect(resolveNodeCategoryLabel(node({ semanticType: 'integration-platform' }), { language: 'en' })).toBe('Integration');
    });
});

describe('resolveEdgeCategoryLabel', () => {
    it('prefers the protocol field when set', () => {
        expect(resolveEdgeCategoryLabel({ protocol: 'REST/HTTPS', relation: 'sync' })).toBe('REST/HTTPS');
        expect(resolveEdgeCategoryLabel({ protocol: 'Kafka' })).toBe('Kafka');
    });

    it('falls back to the human label for the semantic type', () => {
        expect(resolveEdgeCategoryLabel({ semanticType: 'async-messaging' })).toBe('Mensajería Asíncrona');
        expect(resolveEdgeCategoryLabel({ semanticType: 'rest-api' })).toBe('REST API');
        expect(resolveEdgeCategoryLabel({ semanticType: 'event' })).toBe('Evento');
    });

    it('falls back to the relation when nothing better is available', () => {
        expect(resolveEdgeCategoryLabel({ relation: 'async' })).toBe('Asíncrono');
        expect(resolveEdgeCategoryLabel({ relation: 'data-flow' })).toBe('Flujo de Datos');
        expect(resolveEdgeCategoryLabel({ relation: 'sync' })).toBe('Sincrónico');
    });

    it('returns null when there is no metadata to fall back on', () => {
        expect(resolveEdgeCategoryLabel({ relation: 'default' })).toBeNull();
        expect(resolveEdgeCategoryLabel({})).toBeNull();
    });
});

describe('getNodeCategoryLabel / getEdgeCategoryLabel', () => {
    it('lookup helpers used by the legend', () => {
        expect(getNodeCategoryLabel('legacy-system')).toBe('Sistema Legacy');
        expect(getNodeCategoryLabel('legacy-system', 'en')).toBe('Legacy System');
        expect(getEdgeCategoryLabel('async-messaging')).toBe('Mensajería Asíncrona');
        expect(getEdgeCategoryLabel('event')).toBe('Evento');
    });
});
