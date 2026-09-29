/**
 * Los paquetes de dominio de seguros (plan de diagramas, 6.4): cuándo se
 * activan y por qué, qué le dicen al modelo, y qué comprueba el validador de
 * vida — sin que un diagrama de vida reciba consejos de salud.
 */
import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { DOMAIN_PACKS, resolveDomainPacks } from '../../lib/domainPacks';
import { buildDomainPackBlock } from '../../services/ai/prompts/domainPackPrompt';
import { validateHealthcareCompliance } from '../../services/diagram/healthcareCompliance';
import { isLifeInsuranceContext, validateLifeInsuranceCompliance } from '../../services/diagram/lifeInsuranceCompliance';

const motivation = (over: Partial<{ title: string; need: string; regulatoryDrivers: string[]; objectives: string[] }>) => ({
    title: 'Iniciativa', need: '', objectives: [], expectedOutcomes: [], kpis: [], regulatoryDrivers: [], ...over,
});

describe('resolveDomainPacks', () => {
    it('un impulsor regulatorio de la iniciativa activa el paquete por sí solo, y lo dice', () => {
        const [resolved] = resolveDomainPacks({ motivations: [motivation({ regulatoryDrivers: ['HIPAA'] })], texts: [] });
        expect(resolved.pack.id).toBe('health-insurance');
        expect(resolved.source).toBe('iniciativa');
        expect(resolved.evidence).toEqual(['HIPAA']);
    });

    it('en texto libre hacen falta dos términos distintos: una palabra suelta no es una industria', () => {
        expect(resolveDomainPacks({ texts: ['Portal para el hospital'] })).toEqual([]);
        const resolved = resolveDomainPacks({ texts: ['Portal para el hospital', 'consulta de elegibilidad'] });
        expect(resolved.map((r) => [r.pack.id, r.source, r.evidence])).toEqual([['health-insurance', 'proyecto', ['hospital', 'elegibilidad']]]);
    });

    it('reconoce vida y puede activar los dos paquetes a la vez', () => {
        const resolved = resolveDomainPacks({
            texts: ['Seguros de vida individual con designación de beneficiarios', 'Gastos médicos mayores y red de proveedores de salud'],
        });
        expect(resolved.map((r) => r.pack.id).sort()).toEqual(['health-insurance', 'life-insurance']);
    });

    it('cada paquete declara estándares con su uso, no sólo su nombre', () => {
        for (const pack of DOMAIN_PACKS) {
            expect(pack.standards.length).toBeGreaterThan(0);
            for (const standard of pack.standards) expect(standard.use.length, standard.name).toBeGreaterThan(20);
        }
    });
});

describe('buildDomainPackBlock', () => {
    it('dice qué paquete y por qué, y limita su alcance a nombrar y clasificar', () => {
        const block = buildDomainPackBlock(resolveDomainPacks({ motivations: [motivation({ regulatoryDrivers: ['AML', 'ACORD'] , need: 'Pagar siniestros de vida' })], texts: [] }));
        expect(block).toMatch(/^PAQUETE DE DOMINIO — Seguros de vida \(activado por la iniciativa: ACORD/);
        expect(block).toMatch(/no añadas lo que la solicitud no pide/);
        expect(block).toContain('screening AML');
        expect(buildDomainPackBlock([])).toBe('');
    });
});

const lifeIR = (nodes: DiagramIR['nodes'], edges: DiagramIR['edges'] = []): DiagramIR => ({ nodes, edges, groups: [], metadata: { title: 'Siniestros de vida' } });

describe('validateLifeInsuranceCompliance', () => {
    it('marca un pago de suma asegurada sin control AML, y no lo marca si lo hay', () => {
        const base = [
            { id: 'aviso', label: 'Aviso de fallecimiento', kind: 'service' },
            { id: 'liq', label: 'Servicio de Liquidación', kind: 'service', description: 'Ordena el pago de la suma asegurada' },
        ];
        const codes = (ir: DiagramIR) => validateLifeInsuranceCompliance(ir).map((i) => i.code);
        expect(codes(lifeIR(base))).toContain('LI_PAYOUT_WITHOUT_AML');
        expect(codes(lifeIR([...base, { id: 'aml', label: 'Screening AML', kind: 'service' }]))).not.toContain('LI_PAYOUT_WITHOUT_AML');
    });

    it('pide PHI para la evidencia médica de suscripción y PII para los datos de beneficiarios', () => {
        const issues = validateLifeInsuranceCompliance(lifeIR([
            { id: 'lab', label: 'Laboratorio Externo', kind: 'external' },
            { id: 'bd', label: 'BD de Beneficiarios', kind: 'data' },
            { id: 'sus', label: 'Motor de Suscripción', kind: 'service' },
        ]));
        expect(issues.map((i) => [i.code, i.affectedIds])).toEqual(expect.arrayContaining([
            ['LI_UNDERWRITING_EVIDENCE_NOT_PHI', ['lab']],
            ['LI_PARTY_DATA_NOT_CLASSIFIED', ['bd']],
        ]));
    });

    it('no se enciende con una sola señal de vida', () => {
        const ir: DiagramIR = { nodes: [{ id: 'a', label: 'Beneficios', kind: 'service' }], edges: [], groups: [] };
        expect(isLifeInsuranceContext(ir)).toBe(false);
        expect(validateLifeInsuranceCompliance(ir)).toEqual([]);
    });
});

describe('un diagrama de vida no recibe consejos de salud', () => {
    it('sin X12, adjudicación ni PHI por palabras que en vida son PII', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'admin', label: 'Administración de Pólizas', kind: 'system', dataClassification: 'pii' },
                { id: 'liq', label: 'Liquidación de Siniestros', kind: 'service', description: 'Paga al beneficiario' },
                { id: 'prov', label: 'Proveedor de Listas', kind: 'external' },
            ],
            edges: [{ id: 'e', source: 'liq', target: 'prov', label: 'Consulta listas', protocol: 'REST/HTTPS' }],
            groups: [],
        };
        const codes = validateHealthcareCompliance(ir).map((i) => i.code);
        expect(codes).not.toContain('HC_RECOMMEND_X12');
        expect(codes).not.toContain('HC_MISSING_ADJUDICATION_TRACE');
        expect(codes).not.toContain('HC_MISSING_PHI_CLASSIFICATION');
    });
});
