import { describe, it, expect } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { DiagramIR } from '../../lib/diagram';
import { toDiagramIR, mergeIRMetadata } from '../../services/diagram/quality/diagramQualityService';

const baseNode = (overrides: Partial<Node['data']> & { label: string; kind: string }): Node => ({
    id: overrides.label.toLowerCase().replace(/\s+/g, '-'),
    type: 'custom',
    position: { x: 0, y: 0 },
    data: overrides,
});

describe('Phase 2 — round-trip metadata preservation', () => {
    it('toDiagramIR keeps owner, domain, compliance, dataClassification on nodes', () => {
        const nodes: Node[] = [
            baseNode({
                label: 'Member Portal',
                kind: 'system',
                technology: 'React/Next.js',
                owner: 'Customer Experience',
                domain: 'Member',
                dataClassification: 'phi',
                securityLevel: 'elevated',
                compliance: ['HIPAA', 'SOC2'],
                criticality: 'high',
                trust: 'public',
                businessMeaning: 'Single point of entry for members.',
                technicalMeaning: 'Next.js app behind CloudFront.',
                semanticType: 'portal',
                semanticRole: 'system',
            }),
        ];
        const edges: Edge[] = [];
        const ir = toDiagramIR(nodes, edges);
        const node = ir.nodes[0];
        expect(node.owner).toBe('Customer Experience');
        expect(node.domain).toBe('Member');
        expect(node.dataClassification).toBe('phi');
        expect(node.securityLevel).toBe('elevated');
        expect(node.compliance).toEqual(['HIPAA', 'SOC2']);
        expect(node.criticality).toBe('high');
        expect(node.trust).toBe('public');
        expect(node.businessMeaning).toContain('members');
        expect(node.technicalMeaning).toContain('Next.js');
        expect(node.semanticType).toBe('portal');
        expect(node.semanticRole).toBe('system');
        expect(node.technology).toBe('React/Next.js');
    });

    it('toDiagramIR keeps frequency, security, retry, sla on edges', () => {
        const nodes: Node[] = [
            baseNode({ label: 'A', kind: 'system' }),
            baseNode({ label: 'B', kind: 'system' }),
        ];
        const edges: Edge[] = [
            {
                id: 'e1',
                source: 'a',
                target: 'b',
                label: 'Consulta',
                data: {
                    edgeType: 'sync',
                    protocol: 'REST/HTTPS',
                    direction: 'bidirectional',
                    criticality: 'critical',
                    dataSensitivity: 'phi',
                    frequency: 'real-time',
                    synchrony: 'request-reply',
                    security: 'mTLS + OAuth2',
                    payload: 'FHIR Bundle',
                    trust: 'internal',
                    observability: 'OpenTelemetry',
                    sla: '99.9% / 300ms p95',
                    errorHandling: 'circuit breaker + DLQ',
                    retryPolicy: 'expo 3x',
                    semanticType: 'rest-api',
                },
            },
        ];
        const ir = toDiagramIR(nodes, edges);
        const edge = ir.edges[0];
        expect(edge.protocol).toBe('REST/HTTPS');
        expect(edge.direction).toBe('bidirectional');
        expect(edge.criticality).toBe('critical');
        expect(edge.dataSensitivity).toBe('phi');
        expect(edge.frequency).toBe('real-time');
        expect(edge.synchrony).toBe('request-reply');
        expect(edge.security).toBe('mTLS + OAuth2');
        expect(edge.payload).toBe('FHIR Bundle');
        expect(edge.trust).toBe('internal');
        expect(edge.observability).toBe('OpenTelemetry');
        expect(edge.sla).toContain('99.9');
        expect(edge.errorHandling).toContain('circuit');
        expect(edge.retryPolicy).toBe('expo 3x');
        expect(edge.semanticType).toBe('rest-api');
        expect(edge.relation).toBe('sync');
    });

    it('mergeIRMetadata restores narrative, diagramType and audience from previous IR', () => {
        const previous: DiagramIR = {
            nodes: [
                {
                    id: 'a',
                    label: 'A',
                    kind: 'system',
                    owner: 'Team A',
                    compliance: ['HIPAA'],
                    semanticType: 'application',
                },
            ],
            edges: [
                {
                    id: 'e1',
                    source: 'a',
                    target: 'b',
                    label: 'Sends',
                    relation: 'sync',
                    protocol: 'REST',
                    sla: '99.9%',
                    direction: 'bidirectional',
                },
            ],
            groups: [
                { id: 'g1', label: 'Domain', nodeIds: ['a'], kind: 'system-boundary', purpose: 'Holds member data', owner: 'Domain Team' },
            ],
            metadata: {
                title: 'Original',
                sourceFormat: 'mermaid',
                audience: 'executive',
                diagramType: 'c4-context',
                narrative: { summary: 'High-level view' },
                qualityReview: { score: 88 },
            },
        };

        // Fresh IR coming from the canvas keeps the topology + labels but
        // drops the audience/narrative/qualityReview metadata.
        const fresh: DiagramIR = {
            nodes: [
                { id: 'a', label: 'A renombrado', kind: 'system' },
                { id: 'b', label: 'B', kind: 'system' },
            ],
            edges: [
                { id: 'e1', source: 'a', target: 'b', label: 'Sends', relation: 'sync' },
            ],
            groups: [
                { id: 'g-new', label: 'Domain', nodeIds: ['a'] },
            ],
            metadata: {
                sourceFormat: 'react-flow',
                generatedAt: '2026-05-24T00:00:00Z',
            },
        };

        const merged = mergeIRMetadata(fresh, previous);
        // Node a survives the rename but keeps the owner/compliance/semanticType
        const nodeA = merged.nodes.find((n) => n.id === 'a')!;
        expect(nodeA.label).toBe('A renombrado');
        expect(nodeA.owner).toBe('Team A');
        expect(nodeA.compliance).toEqual(['HIPAA']);
        expect(nodeA.semanticType).toBe('application');
        // Edge keeps protocol/sla/direction
        const edge = merged.edges[0];
        expect(edge.protocol).toBe('REST');
        expect(edge.sla).toBe('99.9%');
        expect(edge.direction).toBe('bidirectional');
        // Group keeps kind/purpose/owner
        const group = merged.groups[0];
        expect(group.kind).toBe('system-boundary');
        expect(group.purpose).toBe('Holds member data');
        expect(group.owner).toBe('Domain Team');
        // Metadata: fresh sourceFormat wins, previous narrative/diagramType/audience survive
        expect(merged.metadata?.sourceFormat).toBe('react-flow');
        expect(merged.metadata?.diagramType).toBe('c4-context');
        expect(merged.metadata?.audience).toBe('executive');
        expect(merged.metadata?.narrative).toBeDefined();
        expect(merged.metadata?.qualityReview?.score).toBe(88);
        expect(merged.metadata?.title).toBe('Original');
    });

    it('mergeIRMetadata does not crash when previous IR is null/undefined', () => {
        const fresh: DiagramIR = {
            nodes: [{ id: 'a', label: 'A', kind: 'system' }],
            edges: [],
            groups: [],
            metadata: { sourceFormat: 'react-flow' },
        };
        expect(mergeIRMetadata(fresh, null)).toBe(fresh);
        expect(mergeIRMetadata(fresh, undefined)).toBe(fresh);
    });

    it('toDiagramIR emits no spurious fields when nodes only carry label/kind (back-compat)', () => {
        const ir = toDiagramIR(
            [{ id: 'a', type: 'custom', position: { x: 0, y: 0 }, data: { label: 'A', kind: 'system' } }],
            [],
        );
        const node = ir.nodes[0];
        expect(node.owner).toBeUndefined();
        expect(node.domain).toBeUndefined();
        expect(node.compliance).toBeUndefined();
        expect(node.dataClassification).toBeUndefined();
        expect(node.criticality).toBeUndefined();
        expect(node.businessMeaning).toBeUndefined();
        expect(node.semanticType).toBeUndefined();
    });
});
