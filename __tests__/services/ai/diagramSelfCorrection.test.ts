/**
 * La autocorrección acotada (plan de diagramas, 6.3): cero llamadas sin
 * hallazgos, una como máximo con ellos, y sólo se queda lo que no empeora.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../../types';
import type { DiagramIR } from '../../../lib/diagram';

const proposeEdit = vi.hoisted(() => vi.fn());
vi.mock('../../../services/ai/generation/diagramEdit/diagramEditService', () => ({ diagramEditService: { proposeEdit } }));

const { correctDiagramOnce, diagramFindings } = await import('../../../services/ai/generation/diagram/diagramSelfCorrection');
const { applySemanticPatch } = await import('../../../services/diagram');

const settings = { language: 'es' } as unknown as Settings;
const ir: DiagramIR = {
    nodes: [
        { id: 'web', label: 'Portal Web', kind: 'service', technology: 'Angular', description: 'Interfaz' },
        { id: 'api', label: 'API del Portal', kind: 'service', technology: 'Node.js', description: 'Orquesta' },
    ],
    edges: [{ id: 'e1', source: 'web', target: 'api', label: 'Solicita cobertura', protocol: 'HTTPS' }],
    groups: [{ id: 'g', label: 'Portal', nodeIds: ['web', 'api'], kind: 'system-boundary' }],
};
const request = { userRequest: 'Debe aparecer el «Motor de Reglas»', acceptanceCriteria: ['Cifrar los datos en reposo'] };
const input = { artifactType: 'mermaid-c4-container' as const, audience: 'technical' as const, request };

const proposalFor = (operations: unknown[]) => {
    const patch = { id: 'p', source: 'ai' as const, rationale: 'añade el motor', operations: operations as never };
    return { ok: true, patch, preview: applySemanticPatch(ir, patch) };
};

beforeEach(() => proposeEdit.mockReset());

describe('correctDiagramOnce', () => {
    it('sin hallazgos no llama al modelo', async () => {
        const outcome = await correctDiagramOnce(ir, { ...input, request: undefined }, settings);
        expect(outcome).toMatchObject({ corrected: false, calls: 0 });
        expect(proposeEdit).not.toHaveBeenCalled();
    });

    it('un criterio sin evidencia no gasta una llamada: sólo nombres, audiencia y violaciones graves', () => {
        const findings = diagramFindings(ir, input);
        expect(findings).toEqual(['La solicitud nombra «Motor de Reglas» y el diagrama no lo muestra.']);
    });

    it('aplica el parche que cierra la brecha y conserva los ids', async () => {
        proposeEdit.mockResolvedValue(proposalFor([
            { op: 'add-node', node: { id: 'motor', label: 'Motor de Reglas', kind: 'service', technology: 'Drools' } },
            { op: 'add-edge', edge: { id: 'e2', source: 'api', target: 'motor', label: 'Evalúa cobertura', protocol: 'gRPC' } },
            { op: 'add-to-group', groupId: 'g', nodeIds: ['motor'] },
        ]));
        const outcome = await correctDiagramOnce(ir, input, settings);
        expect(outcome.corrected).toBe(true);
        expect(outcome.calls).toBe(1);
        expect(outcome.ir.nodes.map((n) => n.id)).toEqual(['web', 'api', 'motor']);
        expect(proposeEdit.mock.calls[0][0].instruction).toContain('«Motor de Reglas»');
    });

    it('descarta el parche que no cierra nada y empeora', async () => {
        proposeEdit.mockResolvedValue(proposalFor([{ op: 'remove-edge', edgeId: 'e1' }]));
        const outcome = await correctDiagramOnce(ir, input, settings);
        expect(outcome.corrected).toBe(false);
        expect(outcome.ir).toBe(ir);
        expect(outcome.note).toMatch(/descartó/);
    });

    it('si el modelo no propone nada, el diagrama queda como estaba', async () => {
        proposeEdit.mockResolvedValue({ ok: false, patch: null, preview: null, reason: 'El asistente no está disponible ahora.' });
        const outcome = await correctDiagramOnce(ir, input, settings);
        expect(outcome).toMatchObject({ corrected: false, calls: 1, ir });
    });
});
