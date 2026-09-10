import { describe, it, expect } from 'vitest';
import {
    executeAddBpmnStartEndEvents,
    executeAddMissingProtocols,
    executeAddSecurityControls,
    executeApplyElkLayout,
    executeAssignGroupKind,
    executeCreateSwimlanesFromOwners,
    executeDiagramSuggestionAction,
    executeMarkEdgesAsMessageFlow,
    executeMarkEdgesAsSequenceFlow,
    executeRepairBpmnLayout,
    executeSetLayoutDensity,
    executeSetLayoutDirection,
    executeSplitC4Levels,
    executeTagPhiPii,
} from '../../services/diagram/suggestionActionExecutors';
import { selectLayoutPlan } from '../../lib/layoutSelector';
import type { DiagramIR } from '../../lib/diagram';

const baseIR = (over: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: over.nodes ?? [
        { id: 'a', label: 'Portal', kind: 'system' },
        { id: 'b', label: 'API', kind: 'service' },
        { id: 'c', label: 'DB', kind: 'data' },
    ],
    edges: over.edges ?? [{ id: 'e1', source: 'a', target: 'b', label: 'invoca' }],
    groups: over.groups ?? [],
    metadata: over.metadata,
});

describe('executeSetLayoutDirection', () => {
    it('writes the direction and marks userOverride on metadata.layoutPlan', () => {
        const ir = baseIR();
        const next = executeSetLayoutDirection(ir, { direction: 'LR' });
        expect(next).not.toBeNull();
        expect(next!.metadata?.layoutPlan?.direction).toBe('LR');
        expect(next!.metadata?.layoutPlan?.userOverride).toBe(true);
    });

    it('returns null when the same direction is already persisted with userOverride', () => {
        const ir = baseIR({
            metadata: {
                layoutPlan: {
                    backend: 'elk',
                    direction: 'LR',
                    density: 'normal',
                    orthogonal: true,
                    rationale: '',
                    userOverride: true,
                },
            },
        });
        const next = executeSetLayoutDirection(ir, { direction: 'LR' });
        expect(next).toBeNull();
    });

    it('rejects unknown directions', () => {
        const ir = baseIR();
        // @ts-expect-error - intentional bad input
        const next = executeSetLayoutDirection(ir, { direction: 'XX' });
        expect(next).toBeNull();
    });
});

describe('executeSetLayoutDensity', () => {
    it('persists density choice with userOverride', () => {
        const ir = baseIR();
        const next = executeSetLayoutDensity(ir, { density: 'spacious' });
        expect(next).not.toBeNull();
        expect(next!.metadata?.layoutPlan?.density).toBe('spacious');
        expect(next!.metadata?.layoutPlan?.userOverride).toBe(true);
    });

    it('is idempotent when same density is already persisted', () => {
        const ir = baseIR({
            metadata: {
                layoutPlan: {
                    backend: 'elk',
                    direction: 'TB',
                    density: 'compact',
                    orthogonal: true,
                    rationale: '',
                    userOverride: true,
                },
            },
        });
        const next = executeSetLayoutDensity(ir, { density: 'compact' });
        expect(next).toBeNull();
    });
});

describe('executeApplyElkLayout', () => {
    it('forces backend=elk and bumps computedAt', () => {
        const ir = baseIR();
        const next = executeApplyElkLayout(ir);
        expect(next).not.toBeNull();
        expect(next!.metadata?.layoutPlan?.backend).toBe('elk');
        expect(typeof next!.metadata?.layoutPlan?.computedAt).toBe('string');
    });

    it('preserves userOverride when present', () => {
        const ir = baseIR({
            metadata: {
                layoutPlan: {
                    backend: 'elk',
                    direction: 'LR',
                    density: 'spacious',
                    orthogonal: true,
                    rationale: '',
                    userOverride: true,
                },
            },
        });
        const next = executeApplyElkLayout(ir);
        expect(next!.metadata?.layoutPlan?.userOverride).toBe(true);
        expect(next!.metadata?.layoutPlan?.direction).toBe('LR');
    });
});

describe('selectLayoutPlan honours metadata.layoutPlan.userOverride (Gap 3)', () => {
    it('keeps the user-chosen direction even on the heuristic path', () => {
        const ir = baseIR({
            metadata: {
                layoutPlan: {
                    backend: 'elk',
                    direction: 'LR',
                    density: 'spacious',
                    orthogonal: true,
                    rationale: '',
                    userOverride: true,
                },
            },
        });
        const plan = selectLayoutPlan({ ir, artifactType: 'mermaid-graph' });
        expect(plan.direction).toBe('LR');
        expect(plan.density).toBe('spacious');
        expect(plan.userOverride).toBe(true);
    });

    it('does NOT apply override when userOverride is false/absent', () => {
        const ir = baseIR({
            metadata: {
                layoutPlan: {
                    backend: 'elk',
                    direction: 'LR',
                    density: 'spacious',
                    orthogonal: true,
                    rationale: '',
                    // userOverride omitted intentionally
                },
            },
        });
        const plan = selectLayoutPlan({ ir, artifactType: 'mermaid-graph' });
        // The default selector picks LR for small graphs already, but density
        // should NOT be forced to 'spacious'.
        expect(plan.userOverride).toBeUndefined();
    });
});

describe('executeAssignGroupKind', () => {
    it('classifies a security group from label', () => {
        const ir = baseIR({
            groups: [{ id: 'g1', label: 'Trust Zone DMZ', nodeIds: ['a'] }],
        });
        const next = executeAssignGroupKind(ir);
        expect(next).not.toBeNull();
        expect(next!.groups[0].kind).toBe('security');
    });

    it('classifies cloud / data / integration / external-provider / legacy / swimlane', () => {
        const ir = baseIR({
            groups: [
                { id: 'g1', label: 'AWS Production VPC', nodeIds: [] },
                { id: 'g2', label: 'Data Warehouse Zone', nodeIds: [] },
                { id: 'g3', label: 'Integration ESB', nodeIds: [] },
                { id: 'g4', label: 'External Provider PBM', nodeIds: [] },
                { id: 'g5', label: 'Legacy Mainframe', nodeIds: [] },
                { id: 'g6', label: 'Swimlane Claims Adjudicator', nodeIds: [] },
            ],
        });
        const next = executeAssignGroupKind(ir);
        const byId = new Map(next!.groups.map((g) => [g.id, g.kind]));
        expect(byId.get('g1')).toBe('cloud');
        expect(byId.get('g2')).toBe('data');
        expect(byId.get('g3')).toBe('integration');
        expect(byId.get('g4')).toBe('external-provider');
        expect(byId.get('g5')).toBe('legacy');
        expect(byId.get('g6')).toBe('swimlane');
    });

    it('preserves already-classified groups while classifying unclassified ones', () => {
        const ir = baseIR({
            groups: [
                { id: 'g1', label: 'Trust Zone', nodeIds: [], kind: 'enterprise' },
                { id: 'g2', label: 'AWS Production VPC', nodeIds: [] },
            ],
        });
        const next = executeAssignGroupKind(ir);
        expect(next).not.toBeNull();
        expect(next?.groups.find((g) => g.id === 'g1')?.kind).toBe('enterprise');
        expect(next?.groups.find((g) => g.id === 'g2')?.kind).toBe('cloud');
    });

    it('returns null when nothing can be classified', () => {
        const ir = baseIR({ groups: [{ id: 'g1', label: 'Cluster XYZ', nodeIds: [] }] });
        // 'cluster' alone isn't in our keyword catalog and the test label
        // shouldn't match any rule — returns null.
        const next = executeAssignGroupKind(ir);
        // The Spanish word 'cluster' isn't in the kind catalog (it's the
        // fallback). However a label of 'Cluster XYZ' does not match any
        // pattern so we should get null.
        expect(next).toBeNull();
    });
});

describe('executeTagPhiPii', () => {
    it('tags a clinical node as PHI', () => {
        const ir = baseIR({
            nodes: [
                { id: 'n1', label: 'EHR Patient Record', kind: 'data' },
            ],
        });
        const next = executeTagPhiPii(ir);
        expect(next).not.toBeNull();
        expect(next!.nodes[0].dataClassification).toBe('phi');
    });

    it('tags a payment node as PCI before falling through to PHI/PII', () => {
        const ir = baseIR({
            nodes: [{ id: 'n1', label: 'Credit Card Token Vault', kind: 'data' }],
        });
        const next = executeTagPhiPii(ir);
        expect(next!.nodes[0].dataClassification).toBe('pci');
    });

    it('tags a member-data node as PII', () => {
        const ir = baseIR({
            nodes: [{ id: 'n1', label: 'Member Demographics Service', kind: 'service' }],
        });
        const next = executeTagPhiPii(ir);
        expect(next!.nodes[0].dataClassification).toBe('pii');
    });

    it('preserves existing classification', () => {
        const ir = baseIR({
            nodes: [{ id: 'n1', label: 'EHR Patient Record', kind: 'data', dataClassification: 'confidential' }],
        });
        const next = executeTagPhiPii(ir);
        // Nothing changed because the node already had a classification.
        expect(next).toBeNull();
    });
});

describe('executeAddMissingProtocols', () => {
    it('infers REST/HTTPS on a critical edge whose label says "invoca API"', () => {
        const ir = baseIR({
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'invoca API REST', criticality: 'critical' }],
        });
        const next = executeAddMissingProtocols(ir);
        expect(next).not.toBeNull();
        expect(next!.edges[0].protocol).toBe('REST/HTTPS');
    });

    it('infers Kafka on a critical edge that mentions event-bus', () => {
        const ir = baseIR({
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'publica al event-bus', criticality: 'critical' }],
        });
        const next = executeAddMissingProtocols(ir);
        expect(next!.edges[0].protocol).toBe('Kafka');
    });

    it('does NOT invent protocols when the evidence is too weak', () => {
        const ir = baseIR({
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'relaciona', criticality: 'critical' }],
        });
        const next = executeAddMissingProtocols(ir);
        expect(next).toBeNull();
    });

    it('only touches critical / high edges', () => {
        const ir = baseIR({
            edges: [
                { id: 'low', source: 'a', target: 'b', label: 'invoca API', criticality: 'low' },
                { id: 'med', source: 'a', target: 'b', label: 'invoca API', criticality: 'medium' },
            ],
        });
        const next = executeAddMissingProtocols(ir);
        expect(next).toBeNull();
    });
});

describe('executeAddSecurityControls', () => {
    it('reads existing security from the label and assigns OAuth2', () => {
        const ir = baseIR({
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'OAuth2 callback', criticality: 'critical' }],
        });
        const next = executeAddSecurityControls(ir);
        expect(next!.edges[0].security).toBe('OAuth2');
    });

    it('suggests OAuth2 + mTLS when the edge is PHI-bearing and crosses trust', () => {
        const ir = baseIR({
            nodes: [
                { id: 'a', label: 'Portal', kind: 'system', trust: 'internal' },
                { id: 'b', label: 'External Provider', kind: 'external', trust: 'external' },
            ],
            edges: [
                { id: 'e1', source: 'a', target: 'b', label: 'envía datos clínicos', criticality: 'critical', dataSensitivity: 'phi' },
            ],
        });
        const next = executeAddSecurityControls(ir);
        expect(next!.edges[0].security).toContain('OAuth2 + mTLS');
        expect(next!.edges[0].security).toContain('sugerido');
    });

    it('preserves edges that already declare security', () => {
        const ir = baseIR({
            edges: [
                { id: 'e1', source: 'a', target: 'b', label: 'invoca', criticality: 'critical', security: 'mTLS' },
            ],
        });
        const next = executeAddSecurityControls(ir);
        expect(next).toBeNull();
    });
});

describe('executeSplitC4Levels', () => {
    it('promotes a context diagram with container evidence to c4-container', () => {
        const ir = baseIR({
            nodes: [
                { id: 'a', label: 'Member Portal', kind: 'container' },
                { id: 'b', label: 'Claims Service', kind: 'microservice' },
            ],
            metadata: { diagramType: 'c4-context' },
        });
        const next = executeSplitC4Levels(ir);
        expect(next!.metadata?.diagramType).toBe('c4-container');
    });

    it('promotes a context diagram with component evidence to c4-component', () => {
        const ir = baseIR({
            nodes: [
                { id: 'a', label: 'OrderController', kind: 'component' },
                { id: 'b', label: 'OrderRepository', kind: 'component' },
            ],
            metadata: { diagramType: 'c4-context' },
        });
        const next = executeSplitC4Levels(ir);
        expect(next!.metadata?.diagramType).toBe('c4-component');
    });

    it('returns null when the diagram is not C4', () => {
        const ir = baseIR();
        const next = executeSplitC4Levels(ir);
        expect(next).toBeNull();
    });

    it('returns null when the diagram has no level-mix evidence', () => {
        const ir = baseIR({
            nodes: [
                { id: 'a', label: 'External Bank', kind: 'system' },
                { id: 'b', label: 'Insurance Org', kind: 'system' },
            ],
            metadata: { diagramType: 'c4-context' },
        });
        const next = executeSplitC4Levels(ir);
        expect(next).toBeNull();
    });
});

describe('executeDiagramSuggestionAction dispatcher', () => {
    it('dispatches set-layout-direction with TB default', () => {
        const ir = baseIR();
        const result = executeDiagramSuggestionAction(ir, 'set-layout-direction', { direction: 'LR' });
        expect(result.ir).not.toBeNull();
        expect(result.ir!.metadata?.layoutPlan?.direction).toBe('LR');
    });

    it('returns null IR for unknown kinds with a clear summary', () => {
        const result = executeDiagramSuggestionAction(baseIR(), 'unknown-kind');
        expect(result.ir).toBeNull();
        expect(result.summary).toContain('no implementada');
    });

    it('returns the no-change message when assign-group-kind has nothing to do', () => {
        const ir = baseIR({ groups: [] });
        const result = executeDiagramSuggestionAction(ir, 'assign-group-kind');
        expect(result.ir).toBeNull();
    });
});

describe('BPMN visual maturity executors', () => {
    const bpmnIR = (over: Partial<DiagramIR> = {}): DiagramIR => ({
        nodes: over.nodes ?? [
            { id: 'taskA', label: 'Registrar solicitud', kind: 'user_task' },
            { id: 'taskB', label: 'Validar pago', kind: 'service_task' },
            { id: 'taskC', label: 'Enviar notificación', kind: 'service_task' },
        ],
        edges: over.edges ?? [
            { id: 'e1', source: 'taskA', target: 'taskB', label: 'pasa a' },
            { id: 'e2', source: 'taskB', target: 'taskC', label: 'envía evento' },
        ],
        groups: over.groups ?? [
            { id: 'laneCliente', label: 'Cliente', nodeIds: ['taskA'], kind: 'swimlane' },
            { id: 'laneOperaciones', label: 'Operaciones', nodeIds: ['taskB', 'taskC'], kind: 'swimlane' },
        ],
        metadata: over.metadata ?? { diagramType: 'bpmn-process' },
    });

    it('marks cross-lane edges as message flow', () => {
        const ir = bpmnIR();
        const result = executeMarkEdgesAsMessageFlow(ir);
        expect(result.ir).not.toBeNull();
        expect(result.changed).toBe(1);
        const crossEdge = result.ir!.edges.find((e) => e.id === 'e1');
        expect(crossEdge?.relation).toBe('async');
        expect(crossEdge?.semanticType).toBe('async-messaging');
        const inLane = result.ir!.edges.find((e) => e.id === 'e2');
        expect(inLane?.relation).not.toBe('async');
    });

    it('returns null when there are no swimlanes to compare', () => {
        const ir = bpmnIR({ groups: [] });
        const result = executeMarkEdgesAsMessageFlow(ir);
        expect(result.ir).toBeNull();
        expect(result.changed).toBe(0);
    });

    it('restores within-lane message flows to sequence flow', () => {
        const ir = bpmnIR({
            edges: [
                { id: 'e1', source: 'taskB', target: 'taskC', label: 'evento', relation: 'async', semanticType: 'async-messaging' },
            ],
        });
        const result = executeMarkEdgesAsSequenceFlow(ir);
        expect(result.ir).not.toBeNull();
        expect(result.changed).toBe(1);
        const edge = result.ir!.edges.find((e) => e.id === 'e1');
        expect(edge?.relation).toBeUndefined();
        expect(edge?.semanticType).toBe('business-flow');
    });

    it('adds missing Start / End events without duplicating existing ones', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'taskA', label: 'Registrar', kind: 'user_task' },
                { id: 'taskB', label: 'Cerrar', kind: 'service_task' },
            ],
            edges: [{ id: 'e1', source: 'taskA', target: 'taskB', label: 'pasa a' }],
            groups: [],
            metadata: { diagramType: 'bpmn-process' },
        };
        const result = executeAddBpmnStartEndEvents(ir);
        expect(result.ir).not.toBeNull();
        expect(result.added).toBe(2);
        const kinds = result.ir!.nodes.map((n) => n.kind);
        expect(kinds).toContain('start_event');
        expect(kinds).toContain('end_event');
    });

    it('is a no-op when the process already has start and end events', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'start', label: 'Inicio', kind: 'start_event' },
                { id: 'taskA', label: 'Registrar', kind: 'task' },
                { id: 'end', label: 'Fin', kind: 'end_event' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'taskA', label: '' },
                { id: 'e2', source: 'taskA', target: 'end', label: '' },
            ],
            groups: [],
            metadata: { diagramType: 'bpmn-process' },
        };
        const result = executeAddBpmnStartEndEvents(ir);
        expect(result.ir).toBeNull();
        expect(result.added).toBe(0);
    });

    it('materialises swimlanes from owner metadata', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'Solicitar', kind: 'user_task', owner: 'Cliente' },
                { id: 'b', label: 'Aprobar', kind: 'user_task', owner: 'Comité' },
                { id: 'c', label: 'Cobrar', kind: 'service_task', owner: 'Comité' },
            ],
            edges: [],
            groups: [],
            metadata: { diagramType: 'bpmn-process' },
        };
        const result = executeCreateSwimlanesFromOwners(ir);
        expect(result.ir).not.toBeNull();
        expect(result.lanes).toBe(2);
        const lanes = result.ir!.groups.filter((g) => g.kind === 'swimlane');
        expect(lanes).toHaveLength(2);
        expect(lanes.map((l) => l.label).sort()).toEqual(['Cliente', 'Comité']);
    });

    it('does not duplicate swimlanes when the IR already has them', () => {
        const ir = bpmnIR();
        const result = executeCreateSwimlanesFromOwners(ir);
        expect(result.ir).toBeNull();
        expect(result.lanes).toBe(0);
    });

    it('repairs the layout plan to ELK layered LR for BPMN', () => {
        const ir: DiagramIR = {
            nodes: [{ id: 'a', label: 'A', kind: 'task' }],
            edges: [],
            groups: [],
            metadata: { diagramType: 'bpmn-process', layoutPlan: { backend: 'elk', direction: 'TB', density: 'normal', orthogonal: false, rationale: '' } },
        };
        const next = executeRepairBpmnLayout(ir);
        expect(next).not.toBeNull();
        expect(next!.metadata?.layoutPlan?.direction).toBe('LR');
        expect(next!.metadata?.layoutPlan?.algorithm).toBe('layered');
        expect(next!.metadata?.layoutPlan?.orthogonal).toBe(true);
    });

    it('dispatcher returns a clear summary for each BPMN action', () => {
        const ir = bpmnIR();
        const messageResult = executeDiagramSuggestionAction(ir, 'mark-edges-as-message-flow');
        expect(messageResult.summary).toMatch(/message flow/);
        const sequenceResult = executeDiagramSuggestionAction(ir, 'mark-edges-as-sequence-flow');
        expect(sequenceResult.summary).toMatch(/within-lane|sequence|corregir/i);
        const startEnd = executeDiagramSuggestionAction(ir, 'add-bpmn-start-end-events');
        expect(startEnd.summary.length).toBeGreaterThan(0);
        const swimlanes = executeDiagramSuggestionAction(ir, 'create-swimlanes-from-owners');
        expect(swimlanes.summary.length).toBeGreaterThan(0);
        const repair = executeDiagramSuggestionAction(ir, 'repair-bpmn-layout');
        expect(repair.summary.length).toBeGreaterThan(0);
    });
});
