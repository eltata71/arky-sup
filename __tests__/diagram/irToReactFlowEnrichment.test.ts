/**
 * Tests for the IR → ReactFlow enrichment pass.
 *
 * The serializer used to drop the bulk of the edge metadata on the floor
 * (only `edgeType` was propagated), so the CustomEdge component could not
 * render the protocol badge / criticality glow / direction marker even when
 * the IR carried that information. These tests pin the new contract: every
 * informative field on the IR edge must reach `data` on the ReactFlow edge.
 *
 * They also pin the node enrichment: the badge text must come from the new
 * human-readable category resolver, and `semanticType` must reach the node
 * data so the dynamic legend can list it.
 */

import { describe, it, expect } from 'vitest';
import { irToReactFlow } from '../../services/diagram/irToReactFlow';
import type { DiagramIR } from '../../lib/diagram';

const baseIR = (overrides: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: [
        {
            id: 'mule',
            label: 'MuleSoft Integration',
            kind: 'Container',
            technology: 'MuleSoft',
            semanticRole: 'gateway',
            semanticType: 'integration-platform',
        },
        {
            id: 'gmd',
            label: 'GMD',
            kind: 'System',
            semanticRole: 'system',
            semanticType: 'legacy-system',
        },
    ],
    edges: [
        {
            id: 'e1',
            source: 'mule',
            target: 'gmd',
            label: 'Sincroniza catálogo medicamentos',
            relation: 'data-flow',
            protocol: 'REST/HTTPS',
            criticality: 'critical',
            direction: 'unidirectional',
            dataSensitivity: 'confidential',
            semanticType: 'rest-api',
            retryPolicy: '3 retries · exponential backoff',
        },
    ],
    groups: [],
    ...overrides,
});

describe('irToReactFlow enrichment', () => {
    it('uses the human-readable category for the node badge', () => {
        const { nodes } = irToReactFlow(baseIR());
        const muleNode = nodes.find((n) => n.id === 'mule');
        expect(muleNode).toBeDefined();
        // The technology hint wins over the semantic type label when present.
        expect(muleNode!.data.type).toBe('MuleSoft');
        expect(muleNode!.data.category).toBe('MuleSoft');
        expect(muleNode!.data.semanticType).toBe('integration-platform');

        const gmdNode = nodes.find((n) => n.id === 'gmd');
        // No technology hint → semantic type label takes over.
        expect(gmdNode!.data.type).toBe('Sistema Legacy');
        expect(gmdNode!.data.category).toBe('Sistema Legacy');
    });

    it('propagates every informative edge field to ReactFlow data', () => {
        const { edges } = irToReactFlow(baseIR());
        const edge = edges[0];
        expect(edge).toBeDefined();
        expect(edge.data?.edgeType).toBe('data-flow');
        expect(edge.data?.protocol).toBe('REST/HTTPS');
        expect(edge.data?.criticality).toBe('critical');
        expect(edge.data?.direction).toBe('unidirectional');
        expect(edge.data?.dataSensitivity).toBe('confidential');
        expect(edge.data?.semanticType).toBe('rest-api');
        expect(edge.data?.retryPolicy).toBe('3 retries · exponential backoff');
    });

    it('synthesizes a protocol badge from the semantic type when no protocol is set', () => {
        const ir = baseIR({
            edges: [
                {
                    id: 'e2',
                    source: 'mule',
                    target: 'gmd',
                    label: 'Publica eventos EOB',
                    relation: 'async',
                    semanticType: 'async-messaging',
                },
            ],
        });
        const { edges } = irToReactFlow(ir);
        expect(edges[0].data?.protocol).toBe('Mensajería Asíncrona');
    });

    it('falls back to the role-derived category badge when semanticType is missing', () => {
        const ir = baseIR({
            nodes: [
                { id: 'svc', label: 'pricing-service', kind: 'Container', semanticRole: 'service' },
            ],
            edges: [],
        });
        const { nodes } = irToReactFlow(ir);
        expect(nodes[0].data.category).toBe('Servicio');
        expect(nodes[0].data.type).toBe('Servicio');
    });
});
