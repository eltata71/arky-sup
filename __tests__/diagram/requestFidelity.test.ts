/**
 * El verificador de fidelidad a la solicitud (plan de diagramas, 6.3): lo que
 * no se puede demostrar se informa como sin evidencia, nunca como cumplido ni
 * como incumplido.
 */
import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { checkRequestFidelity, fidelityLosses, requestedNames, type FidelityCheck } from '../../services/diagram/requestFidelity';

const ir: DiagramIR = {
    nodes: [
        { id: 'api', label: 'API Reclamaciones', kind: 'service', technology: 'Spring Boot 3', description: 'Registra reclamaciones' },
        { id: 'bus', label: 'Bus de Eventos', kind: 'messaging', technology: 'Kafka' },
        { id: 'motor', label: 'Motor de Adjudicación', kind: 'service' },
    ],
    edges: [{ id: 'e', source: 'api', target: 'bus', label: 'Publica reclamación recibida', protocol: 'Kafka' }],
    groups: [],
};

describe('requestedNames', () => {
    it('toma lo entrecomillado y los nombres propios de varias palabras, no la primera palabra de una frase', () => {
        expect(requestedNames('Necesito ver el «Motor de Reglas» junto al Core de Pólizas y "Kafka"'))
            .toEqual(expect.arrayContaining(['Motor de Reglas', 'Core de Pólizas', 'Kafka']));
        expect(requestedNames('Necesito un diagrama de contenedores')).toEqual([]);
    });
});

describe('checkRequestFidelity', () => {
    it('detecta la notación cambiada y el esqueleto', () => {
        const report = checkRequestFidelity({ artifactType: 'mermaid-sequence', content: 'flowchart LR\n a-->b', ir, skeleton: true });
        expect(report.warnings.map((w) => w.kind)).toEqual(['dialect', 'skeleton']);
        expect(report.warnings[0].message).toMatch(/diagrama de secuencia/);
    });

    it('acepta la notación pedida, con comentarios delante', () => {
        const report = checkRequestFidelity({ artifactType: 'mermaid-c4-container', content: '%% nota\nC4Container\n', ir });
        expect(report.warnings).toEqual([]);
        expect(report.score).toBe(1);
    });

    it('avisa de un nombre pedido que falta, sin acentos ni mayúsculas de por medio', () => {
        const report = checkRequestFidelity({
            artifactType: 'mermaid-c4-container', content: 'C4Container', ir,
            request: { userRequest: 'Incluye el Motor de Adjudicacion y el «Registro de Auditoría»' },
        });
        expect(report.checks.filter((c) => c.kind === 'entity').map((c) => [c.target, c.status])).toEqual([
            ['Registro de Auditoría', 'warning'],
            ['Motor de Adjudicacion', 'ok'],
        ]);
    });

    it('un criterio sin palabras en el diagrama es «sin evidencia», no «incumplido»', () => {
        const report = checkRequestFidelity({
            artifactType: 'mermaid-c4-container', content: 'C4Container', ir,
            request: { acceptanceCriteria: ['Mostrar el bus de eventos entre recepción y adjudicación', 'Cifrar los datos en reposo'] },
        });
        const criteria = report.checks.filter((c) => c.kind === 'criterion');
        expect(criteria[0].status).toBe('ok');
        expect(criteria[1].status).toBe('warning');
        expect(criteria[1].message).toMatch(/^Sin evidencia/);
    });

    it('comprueba la audiencia: tamaño ejecutivo y tecnologías técnicas', () => {
        const big: DiagramIR = { ...ir, nodes: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, kind: 'service' })) };
        expect(checkRequestFidelity({ artifactType: 'mermaid-c4-context', content: 'C4Context', ir: big, request: { audience: 'executive' } })
            .warnings.map((w) => w.target)).toEqual(['audiencia ejecutiva']);
        expect(checkRequestFidelity({ artifactType: 'mermaid-c4-container', content: 'C4Container', ir, request: { audience: 'technical' } })
            .warnings.map((w) => w.target)).toEqual(['audiencia técnica']);
    });

    it('sin nada que comprobar no inventa una nota', () => {
        expect(checkRequestFidelity({ artifactType: 'react-flow-graph', content: '{}', ir: null }).score).toBeNull();
    });
});

// Plan de diagramas 8.2d: lo que un cambio perdería frente a la solicitud.
describe('fidelityLosses', () => {
    const report = (checks: Array<[FidelityCheck['kind'], string, FidelityCheck['status']]>) => ({
        checks: checks.map(([kind, target, status]) => ({ kind, target, status, message: target })),
        score: null,
        warnings: [],
    });

    it('devuelve lo que se cumplía y ya no', () => {
        const losses = fidelityLosses(
            report([['entity', 'Core de pólizas', 'ok'], ['criterion', 'Mostrar el pago', 'warning']]),
            report([['entity', 'Core de pólizas', 'warning'], ['criterion', 'Mostrar el pago', 'warning']]),
        );
        expect(losses.map((l) => l.target)).toEqual(['Core de pólizas']);
    });

    it('lo que ya faltaba, o lo que se gana, no es una pérdida', () => {
        expect(fidelityLosses(
            report([['entity', 'A', 'warning']]),
            report([['entity', 'A', 'ok'], ['audience', 'audiencia técnica', 'warning']]),
        )).toEqual([]);
    });
});
