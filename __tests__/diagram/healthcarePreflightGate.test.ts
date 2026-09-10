import { describe, it, expect } from 'vitest';
import { analyzeDiagramQuality, buildDiagramPreflightReport } from '../../services/diagram/quality/diagramQualityService';
import type { DiagramIR } from '../../lib/diagram';

/**
 * Gap 6 — diagramas de seguros / salud no deben ser exportables como
 * formales si omiten clasificación, seguridad o trazabilidad básica en
 * flujos sensibles. El preflight ahora promueve esos hallazgos a checks
 * con status='fail'.
 */

const baseHealthcareIR = (over: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: over.nodes ?? [
        { id: 'm', label: 'Member Portal', kind: 'system' },
        { id: 'p', label: 'Patient Record (EHR)', kind: 'data' },
        { id: 'c', label: 'Claims Adjudication', kind: 'service' },
    ],
    edges: over.edges ?? [
        { id: 'e1', source: 'm', target: 'p', label: 'lee historia clínica', criticality: 'critical' },
        { id: 'e2', source: 'p', target: 'c', label: 'envía claim 837', criticality: 'critical' },
    ],
    groups: over.groups ?? [],
    metadata: over.metadata ?? { diagramType: 'integration', title: 'Eligibility / Claims / Pharmacy' },
});

describe('buildDiagramPreflightReport — healthcare gates (Gap 6)', () => {
    it('fails when PHI nodes are not classified', () => {
        const ir = baseHealthcareIR();
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality);
        const check = report.checks.find((c) => c.id === 'healthcare-phi-classification');
        expect(check?.status).toBe('fail');
        expect(report.ready).toBe(false);
    });

    it('fails when sensitive edges lack security controls', () => {
        const ir = baseHealthcareIR({
            nodes: [
                { id: 'm', label: 'Member Portal', kind: 'system', dataClassification: 'phi' },
                { id: 'p', label: 'Patient Record', kind: 'data', dataClassification: 'phi' },
            ],
            edges: [
                { id: 'e1', source: 'm', target: 'p', label: 'lee historia clínica', criticality: 'critical' },
            ],
        });
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality);
        const check = report.checks.find((c) => c.id === 'healthcare-edge-security');
        expect(check?.status).toBe('fail');
        expect(report.ready).toBe(false);
    });

    it('fails when critical flows lack observability', () => {
        const ir = baseHealthcareIR({
            nodes: [
                { id: 'm', label: 'Member Portal', kind: 'system', dataClassification: 'phi' },
                { id: 'p', label: 'Patient Record', kind: 'data', dataClassification: 'phi' },
            ],
            edges: [
                { id: 'e1', source: 'm', target: 'p', label: 'lee historia clínica', criticality: 'critical', security: 'OAuth2 + mTLS' },
            ],
        });
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality);
        const check = report.checks.find((c) => c.id === 'healthcare-observability');
        expect(check?.status).toBe('fail');
    });

    it('passes when all sensitive flows are classified, secured and observable', () => {
        const ir = baseHealthcareIR({
            nodes: [
                { id: 'm', label: 'Member Portal', kind: 'system', dataClassification: 'phi' },
                { id: 'p', label: 'Patient Record', kind: 'data', dataClassification: 'phi' },
                { id: 'a', label: 'Adjudication', kind: 'service', dataClassification: 'phi' },
                { id: 'r', label: 'Remittance (835)', kind: 'data', dataClassification: 'phi' },
            ],
            edges: [
                {
                    id: 'e1',
                    source: 'm',
                    target: 'p',
                    label: 'lee historia clínica',
                    criticality: 'critical',
                    security: 'OAuth2 + mTLS',
                    observability: 'OpenTelemetry + audit log',
                    protocol: 'FHIR over HTTPS',
                    dataSensitivity: 'phi',
                },
                {
                    id: 'e2',
                    source: 'p',
                    target: 'a',
                    label: 'envía claim 837',
                    criticality: 'critical',
                    security: 'OAuth2 + mTLS',
                    observability: 'OpenTelemetry + audit log',
                    protocol: 'X12 837',
                    dataSensitivity: 'phi',
                },
                {
                    id: 'e3',
                    source: 'a',
                    target: 'r',
                    label: 'genera remesa',
                    criticality: 'critical',
                    security: 'OAuth2 + mTLS',
                    observability: 'OpenTelemetry + audit log',
                    protocol: 'X12 835',
                },
            ],
        });
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality);
        const phi = report.checks.find((c) => c.id === 'healthcare-phi-classification');
        const sec = report.checks.find((c) => c.id === 'healthcare-edge-security');
        const obs = report.checks.find((c) => c.id === 'healthcare-observability');
        expect(phi?.status).toBe('pass');
        expect(sec?.status).toBe('pass');
        expect(obs?.status).toBe('pass');
    });

    it('skips healthcare checks on non-healthcare diagrams', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'Frontend', kind: 'system' },
                { id: 'b', label: 'API', kind: 'service' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'invoca' }],
            groups: [],
            metadata: { diagramType: 'integration', title: 'Generic Web App' },
        };
        const quality = analyzeDiagramQuality(ir);
        const report = buildDiagramPreflightReport(ir, quality);
        expect(report.checks.some((c) => c.id.startsWith('healthcare-'))).toBe(false);
    });
});
