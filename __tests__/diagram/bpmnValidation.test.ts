import { describe, it, expect } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { validateBPMN } from '../../services/diagram/bpmnValidation';

const baseIR = (overrides: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: [],
    edges: [],
    groups: [],
    metadata: { diagramType: 'bpmn-process' },
    ...overrides,
});

describe('Phase 3 — BPMN formal validation', () => {
    it('returns empty array for tiny diagrams (< 3 nodes)', () => {
        const ir = baseIR({
            nodes: [
                { id: 'a', label: 'A', kind: 'task' },
                { id: 'b', label: 'B', kind: 'task' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: '' }],
        });
        expect(validateBPMN(ir)).toEqual([]);
    });

    it('flags missing start and end events', () => {
        const ir = baseIR({
            nodes: [
                { id: 't1', label: 'Validar', kind: 'task' },
                { id: 't2', label: 'Procesar', kind: 'task' },
                { id: 't3', label: 'Notificar', kind: 'task' },
            ],
            edges: [
                { id: 'e1', source: 't1', target: 't2', label: 'next' },
                { id: 'e2', source: 't2', target: 't3', label: 'next' },
            ],
        });
        const issues = validateBPMN(ir);
        const codes = issues.map((i) => i.code);
        expect(codes).toContain('BPMN_MISSING_START_EVENT');
        expect(codes).toContain('BPMN_MISSING_END_EVENT');
    });

    it('accepts processes with explicit Inicio/Fin labels', () => {
        const ir = baseIR({
            nodes: [
                { id: 's', label: 'Inicio', kind: 'process' },
                { id: 't', label: 'Validar', kind: 'task' },
                { id: 'e', label: 'Fin', kind: 'process' },
            ],
            edges: [
                { id: 'e1', source: 's', target: 't', label: '' },
                { id: 'e2', source: 't', target: 'e', label: '' },
            ],
        });
        const issues = validateBPMN(ir);
        const codes = issues.map((i) => i.code);
        expect(codes).not.toContain('BPMN_MISSING_START_EVENT');
        expect(codes).not.toContain('BPMN_MISSING_END_EVENT');
    });

    it('flags tasks with multiple outgoing edges that are not gateways', () => {
        const ir = baseIR({
            nodes: [
                { id: 's', label: 'Inicio', kind: 'process' },
                { id: 't', label: 'Validar', kind: 'task' },
                { id: 'a', label: 'Aprobar', kind: 'task' },
                { id: 'r', label: 'Rechazar', kind: 'task' },
                { id: 'e', label: 'Fin', kind: 'process' },
            ],
            edges: [
                { id: 'e1', source: 's', target: 't', label: '' },
                { id: 'e2', source: 't', target: 'a', label: '' },
                { id: 'e3', source: 't', target: 'r', label: '' },
                { id: 'e4', source: 'a', target: 'e', label: '' },
                { id: 'e5', source: 'r', target: 'e', label: '' },
            ],
        });
        const issues = validateBPMN(ir);
        expect(issues.find((i) => i.code === 'BPMN_MISSING_GATEWAY')?.affectedIds).toContain('t');
    });

    it('accepts diamond-shaped gateways without flagging them', () => {
        const ir = baseIR({
            nodes: [
                { id: 's', label: 'Inicio', kind: 'process' },
                { id: 'g', label: 'Decisión', kind: 'gateway', shape: 'diamond' },
                { id: 'a', label: 'Aprobar', kind: 'task' },
                { id: 'r', label: 'Rechazar', kind: 'task' },
                { id: 'e', label: 'Fin', kind: 'process' },
            ],
            edges: [
                { id: 'e1', source: 's', target: 'g', label: '' },
                { id: 'e2', source: 'g', target: 'a', label: 'Sí' },
                { id: 'e3', source: 'g', target: 'r', label: 'No' },
                { id: 'e4', source: 'a', target: 'e', label: '' },
                { id: 'e5', source: 'r', target: 'e', label: '' },
            ],
        });
        const issues = validateBPMN(ir);
        const codes = issues.map((i) => i.code);
        expect(codes).not.toContain('BPMN_MISSING_GATEWAY');
        expect(codes).not.toContain('BPMN_GATEWAY_BRANCH_UNLABELED');
    });

    it('flags unlabeled gateway branches', () => {
        const ir = baseIR({
            nodes: [
                { id: 's', label: 'Inicio', kind: 'process' },
                { id: 'g', label: 'Decisión', kind: 'gateway' },
                { id: 'a', label: 'Aprobar', kind: 'task' },
                { id: 'r', label: 'Rechazar', kind: 'task' },
                { id: 'e', label: 'Fin', kind: 'process' },
            ],
            edges: [
                { id: 'e1', source: 's', target: 'g', label: '' },
                { id: 'e2', source: 'g', target: 'a', label: '' },
                { id: 'e3', source: 'g', target: 'r', label: 'No' },
                { id: 'e4', source: 'a', target: 'e', label: '' },
                { id: 'e5', source: 'r', target: 'e', label: '' },
            ],
        });
        const issues = validateBPMN(ir);
        const branchIssue = issues.find((i) => i.code === 'BPMN_GATEWAY_BRANCH_UNLABELED');
        expect(branchIssue).toBeDefined();
        expect(branchIssue?.affectedIds).toContain('e2');
    });

    it('recommends swimlanes when multiple owners are present', () => {
        const ir = baseIR({
            nodes: [
                { id: 's', label: 'Inicio', kind: 'process', owner: 'Member' },
                { id: 't1', label: 'Submit', kind: 'task', owner: 'Member' },
                { id: 't2', label: 'Validate', kind: 'task', owner: 'Carrier' },
                { id: 'e', label: 'Fin', kind: 'process', owner: 'Carrier' },
            ],
            edges: [
                { id: 'e1', source: 's', target: 't1', label: '' },
                { id: 'e2', source: 't1', target: 't2', label: '' },
                { id: 'e3', source: 't2', target: 'e', label: '' },
            ],
        });
        const issues = validateBPMN(ir);
        expect(issues.find((i) => i.code === 'BPMN_SWIMLANE_MISSING')).toBeDefined();
    });

    it('flags cross-lane edges typed as sequence flow', () => {
        const ir = baseIR({
            nodes: [
                { id: 's', label: 'Inicio', kind: 'process' },
                { id: 't1', label: 'Submit', kind: 'task' },
                { id: 't2', label: 'Validate', kind: 'task' },
                { id: 'e', label: 'Fin', kind: 'process' },
            ],
            edges: [
                { id: 'e1', source: 's', target: 't1', label: '', relation: 'sync' },
                { id: 'e2', source: 't1', target: 't2', label: 'sends', relation: 'sync' },
                { id: 'e3', source: 't2', target: 'e', label: '', relation: 'sync' },
            ],
            groups: [
                { id: 'g1', label: 'Member', nodeIds: ['s', 't1'], kind: 'swimlane' },
                { id: 'g2', label: 'Carrier', nodeIds: ['t2', 'e'], kind: 'swimlane' },
            ],
        });
        const issues = validateBPMN(ir);
        const cross = issues.find((i) => i.code === 'BPMN_CROSSLANE_AS_SEQUENCE');
        expect(cross).toBeDefined();
        expect(cross?.affectedIds).toContain('e2');
    });

    it('flags unlabeled loops', () => {
        const ir = baseIR({
            nodes: [
                { id: 's', label: 'Inicio', kind: 'process' },
                { id: 'a', label: 'Procesar', kind: 'task' },
                { id: 'b', label: 'Validar', kind: 'task' },
                { id: 'e', label: 'Fin', kind: 'process' },
            ],
            edges: [
                { id: 'e1', source: 's', target: 'a', label: '' },
                { id: 'e2', source: 'a', target: 'b', label: '' },
                { id: 'e3', source: 'b', target: 'a', label: '' }, // loop back, no label
                { id: 'e4', source: 'b', target: 'e', label: '' },
            ],
        });
        const issues = validateBPMN(ir);
        expect(issues.find((i) => i.code === 'BPMN_LOOP_WITHOUT_LABEL')).toBeDefined();
    });

    it('flags long vertical processes', () => {
        const nodes: DiagramIR['nodes'] = Array.from({ length: 12 }, (_, i) => ({
            id: `n${i}`,
            label: i === 0 ? 'Inicio' : i === 11 ? 'Fin' : `Tarea ${i}`,
            kind: i === 0 || i === 11 ? 'process' : 'task',
        }));
        const edges: DiagramIR['edges'] = nodes.slice(0, -1).map((n, i) => ({
            id: `e${i}`,
            source: n.id,
            target: nodes[i + 1].id,
            label: '',
        }));
        const ir = baseIR({
            nodes,
            edges,
            metadata: { diagramType: 'bpmn-process', layoutPlan: { backend: 'elk', direction: 'TB' } },
        });
        const issues = validateBPMN(ir);
        expect(issues.find((i) => i.code === 'BPMN_PROCESS_TOO_LONG_VERTICAL')).toBeDefined();
    });

    it('flags gateways with a single output and empty swimlanes', () => {
        const ir = baseIR({
            nodes: [
                { id: 's', label: 'Inicio', kind: 'process' },
                { id: 'gw', label: 'Decisión', kind: 'gateway' },
                { id: 'a', label: 'Procesar', kind: 'task', owner: 'Ventas' },
                { id: 'e', label: 'Fin', kind: 'process' },
            ],
            edges: [
                { id: 'e1', source: 's', target: 'gw', label: '' },
                { id: 'e2', source: 'gw', target: 'a', label: '' },
                { id: 'e3', source: 'a', target: 'e', label: '' },
            ],
            groups: [
                { id: 'laneVentas', label: 'Ventas', nodeIds: ['a'], kind: 'swimlane' },
                { id: 'laneOps', label: 'Operaciones', nodeIds: [], kind: 'swimlane' },
            ],
        });
        const codes = validateBPMN(ir).map((i) => i.code);
        expect(codes).toContain('BPMN_GATEWAY_SINGLE_OUTPUT');
        expect(codes).toContain('BPMN_SWIMLANE_EMPTY');
    });

    it('flags message flow used within the same swimlane', () => {
        const ir = baseIR({
            nodes: [
                { id: 's', label: 'Inicio', kind: 'process' },
                { id: 'a', label: 'A', kind: 'task' },
                { id: 'b', label: 'B', kind: 'task' },
                { id: 'e', label: 'Fin', kind: 'process' },
            ],
            edges: [
                { id: 'e1', source: 's', target: 'a', label: '' },
                { id: 'e2', source: 'a', target: 'b', label: 'evento', semanticType: 'async-messaging' },
                { id: 'e3', source: 'b', target: 'e', label: '' },
            ],
            groups: [
                { id: 'lane1', label: 'Ventas', nodeIds: ['a', 'b'], kind: 'swimlane' },
                { id: 'lane2', label: 'Operaciones', nodeIds: ['e'], kind: 'swimlane' },
            ],
        });
        const codes = validateBPMN(ir).map((i) => i.code);
        expect(codes).toContain('BPMN_MESSAGE_WITHIN_LANE');
    });

    it('flags orphan data objects', () => {
        const ir = baseIR({
            nodes: [
                { id: 's', label: 'Inicio', kind: 'process' },
                { id: 'a', label: 'Procesar', kind: 'task' },
                { id: 'e', label: 'Fin', kind: 'process' },
                { id: 'd', label: 'Documento', kind: 'data_object' },
            ],
            edges: [
                { id: 'e1', source: 's', target: 'a', label: '' },
                { id: 'e2', source: 'a', target: 'e', label: '' },
            ],
        });
        const codes = validateBPMN(ir).map((i) => i.code);
        expect(codes).toContain('BPMN_DATA_OBJECT_WITHOUT_ASSOCIATION');
    });

    it('flags tasks outside any lane and missing-owner inside lanes', () => {
        const ir = baseIR({
            nodes: [
                { id: 's', label: 'Inicio', kind: 'process' },
                { id: 'a', label: 'Procesar', kind: 'task' }, // outside any lane
                { id: 'b', label: 'Validar', kind: 'task' },  // inside lane, no owner
                { id: 'e', label: 'Fin', kind: 'process' },
            ],
            edges: [
                { id: 'e1', source: 's', target: 'a', label: '' },
                { id: 'e2', source: 'a', target: 'b', label: '' },
                { id: 'e3', source: 'b', target: 'e', label: '' },
            ],
            groups: [
                { id: 'lane1', label: 'Ventas', nodeIds: ['b'], kind: 'swimlane' },
                { id: 'lane2', label: 'Operaciones', nodeIds: ['e'], kind: 'swimlane' },
            ],
        });
        const codes = validateBPMN(ir).map((i) => i.code);
        expect(codes).toContain('BPMN_NODE_OUTSIDE_LANE');
        expect(codes).toContain('BPMN_TASK_WITHOUT_OWNER');
    });
});
