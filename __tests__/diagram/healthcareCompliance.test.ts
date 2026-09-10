import { describe, it, expect } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { validateHealthcareCompliance } from '../../services/diagram/healthcareCompliance';

const baseIR = (overrides: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: [],
    edges: [],
    groups: [],
    ...overrides,
});

describe('Phase 3 — Healthcare / insurance compliance', () => {
    it('returns empty array for non-healthcare diagrams', () => {
        const ir = baseIR({
            nodes: [
                { id: 'a', label: 'Order Service', kind: 'service' },
                { id: 'b', label: 'Payment Gateway', kind: 'gateway' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'sends', relation: 'sync' }],
        });
        expect(validateHealthcareCompliance(ir)).toEqual([]);
    });

    it('flags missing PHI classification on claim/coverage nodes', () => {
        const ir = baseIR({
            nodes: [
                { id: 'm', label: 'Member Service', kind: 'service' },
                { id: 'c', label: 'Claim Engine', kind: 'service', description: 'Handles claim adjudication' },
                { id: 'co', label: 'Coverage Database', kind: 'data' },
            ],
            edges: [
                { id: 'e1', source: 'm', target: 'c', label: 'submit claim' },
                { id: 'e2', source: 'c', target: 'co', label: 'lookup coverage' },
            ],
        });
        const issues = validateHealthcareCompliance(ir);
        const phi = issues.find((i) => i.code === 'HC_MISSING_PHI_CLASSIFICATION');
        expect(phi).toBeDefined();
        expect(phi?.affectedIds?.length).toBeGreaterThan(0);
    });

    it('flags sensitive edges without security or sensitivity declared', () => {
        const ir = baseIR({
            nodes: [
                { id: 'm', label: 'Member Portal', kind: 'system', dataClassification: 'phi' },
                { id: 'c', label: 'Claim Engine', kind: 'service', dataClassification: 'phi' },
            ],
            edges: [{ id: 'e1', source: 'm', target: 'c', label: 'submit', relation: 'sync' }],
        });
        const issues = validateHealthcareCompliance(ir);
        const sec = issues.find((i) => i.code === 'HC_SENSITIVE_EDGE_MISSING_SECURITY');
        const sens = issues.find((i) => i.code === 'HC_SENSITIVE_EDGE_MISSING_SENSITIVITY');
        expect(sec?.affectedIds).toContain('e1');
        expect(sens?.affectedIds).toContain('e1');
    });

    it('recommends FHIR when clinical concepts appear without FHIR payload', () => {
        const ir = baseIR({
            nodes: [
                { id: 'ehr', label: 'EHR System', kind: 'system' },
                { id: 'mp', label: 'Patient Portal', kind: 'system' },
            ],
            edges: [{ id: 'e1', source: 'ehr', target: 'mp', label: 'share encounter', protocol: 'REST' }],
        });
        const issues = validateHealthcareCompliance(ir);
        expect(issues.find((i) => i.code === 'HC_RECOMMEND_FHIR')).toBeDefined();
    });

    it('does NOT recommend FHIR when payload already mentions FHIR', () => {
        const ir = baseIR({
            nodes: [
                { id: 'ehr', label: 'EHR System', kind: 'system' },
                { id: 'mp', label: 'Patient Portal', kind: 'system' },
            ],
            edges: [{ id: 'e1', source: 'ehr', target: 'mp', label: 'share encounter', payload: 'FHIR Bundle' }],
        });
        const issues = validateHealthcareCompliance(ir);
        expect(issues.find((i) => i.code === 'HC_RECOMMEND_FHIR')).toBeUndefined();
    });

    it('recommends X12 when payer-provider eligibility / claims flow lacks X12', () => {
        const ir = baseIR({
            nodes: [
                { id: 'pa', label: 'Payer', kind: 'system' },
                { id: 'pr', label: 'Provider', kind: 'system' },
            ],
            edges: [{ id: 'e1', source: 'pr', target: 'pa', label: 'submit claim', protocol: 'REST/HTTPS' }],
        });
        const issues = validateHealthcareCompliance(ir);
        expect(issues.find((i) => i.code === 'HC_RECOMMEND_X12')).toBeDefined();
    });

    it('recommends NCPDP when PBM/pharmacy flow lacks NCPDP', () => {
        const ir = baseIR({
            nodes: [
                { id: 'pbm', label: 'PBM Service', kind: 'system' },
                { id: 'ph', label: 'Pharmacy', kind: 'external-system' },
            ],
            edges: [{ id: 'e1', source: 'ph', target: 'pbm', label: 'submit prescription', protocol: 'REST' }],
        });
        const issues = validateHealthcareCompliance(ir);
        expect(issues.find((i) => i.code === 'HC_RECOMMEND_NCPDP')).toBeDefined();
    });

    it('flags critical edges without observability', () => {
        const ir = baseIR({
            nodes: [
                { id: 'a', label: 'Claim Engine', kind: 'service', dataClassification: 'phi' },
                { id: 'b', label: 'Adjudication', kind: 'service', dataClassification: 'phi' },
            ],
            edges: [{
                id: 'e1',
                source: 'a',
                target: 'b',
                label: 'adjudicate',
                criticality: 'critical',
                security: 'mTLS',
                dataSensitivity: 'phi',
            }],
        });
        const issues = validateHealthcareCompliance(ir);
        expect(issues.find((i) => i.code === 'HC_MISSING_OBSERVABILITY')).toBeDefined();
    });

    it('flags claim flows without adjudication / remittance trace', () => {
        const ir = baseIR({
            nodes: [
                { id: 'm', label: 'Member Portal', kind: 'system' },
                { id: 'c', label: 'Claim Intake', kind: 'service' },
                { id: 'p', label: 'Provider', kind: 'system' },
            ],
            edges: [
                { id: 'e1', source: 'm', target: 'c', label: 'submit claim' },
                { id: 'e2', source: 'c', target: 'p', label: 'notify' },
            ],
        });
        const issues = validateHealthcareCompliance(ir);
        expect(issues.find((i) => i.code === 'HC_MISSING_ADJUDICATION_TRACE')).toBeDefined();
    });
});
