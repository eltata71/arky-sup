import { describe, it, expect } from 'vitest';
import { detectBpmnElement, detectBpmnFlowType, BPMN_PALETTE, BPMN_FLOW_TOKENS } from '../../lib/diagramBpmn';

describe('detectBpmnElement (Gap 10)', () => {
    it('detects start events via explicit kind', () => {
        expect(detectBpmnElement({ kind: 'start_event', label: 'Inicio' })).toBe('start-event');
        expect(detectBpmnElement({ kind: 'start-event', label: 'Start' })).toBe('start-event');
    });

    it('detects end events via explicit kind or semanticType', () => {
        expect(detectBpmnElement({ kind: 'end_event', label: 'Fin' })).toBe('end-event');
        expect(detectBpmnElement({ semanticType: 'end-event', label: 'End' })).toBe('end-event');
    });

    it('detects exclusive / parallel / inclusive gateways', () => {
        expect(detectBpmnElement({ kind: 'exclusive_gateway', label: 'Decisión' })).toBe('gateway-exclusive');
        expect(detectBpmnElement({ kind: 'parallel-gateway', label: 'Fork' })).toBe('gateway-parallel');
        expect(detectBpmnElement({ kind: 'inclusive_gateway', label: 'Or' })).toBe('gateway-inclusive');
    });

    it('detects user and service tasks', () => {
        expect(detectBpmnElement({ kind: 'user_task', label: 'Revisar' })).toBe('user-task');
        expect(detectBpmnElement({ kind: 'service-task', label: 'Cobrar' })).toBe('service-task');
    });

    it('falls back to label heuristics when kind is missing', () => {
        expect(detectBpmnElement({ label: 'Inicio proceso' })).toBe('start-event');
        expect(detectBpmnElement({ label: 'Fin del proceso' })).toBe('end-event');
        expect(detectBpmnElement({ label: 'Decisión exclusiva' })).toBe('gateway-exclusive');
    });

    it('returns null for non-BPMN elements', () => {
        expect(detectBpmnElement({ kind: 'database', label: 'PostgreSQL' })).toBeNull();
        expect(detectBpmnElement({ kind: 'system', label: 'Customer Portal' })).toBeNull();
    });

    it('exports a colour palette for every BPMN kind', () => {
        for (const k of ['start-event', 'end-event', 'gateway-exclusive', 'gateway-parallel', 'gateway-inclusive', 'task', 'user-task', 'service-task', 'intermediate-event'] as const) {
            const palette = BPMN_PALETTE[k];
            expect(palette.stroke).toMatch(/^#/);
            expect(palette.bg).toMatch(/^#/);
            expect(palette.label.length).toBeGreaterThan(0);
        }
    });

    it('detects manual, business-rule tasks and event-based gateways', () => {
        expect(detectBpmnElement({ kind: 'manual_task', label: 'Firmar contrato' })).toBe('manual-task');
        expect(detectBpmnElement({ kind: 'business-rule-task', label: 'Aplicar DMN' })).toBe('business-rule-task');
        expect(detectBpmnElement({ kind: 'event-based-gateway', label: 'Esperar evento' })).toBe('gateway-event-based');
    });

    it('detects data objects, data stores and annotations', () => {
        expect(detectBpmnElement({ kind: 'data_object', label: 'Solicitud' })).toBe('data-object');
        expect(detectBpmnElement({ kind: 'data_store', label: 'Historia clínica' })).toBe('data-store');
        expect(detectBpmnElement({ kind: 'annotation', label: 'Nota: revisar SLA' })).toBe('annotation');
    });
});

describe('detectBpmnFlowType', () => {
    it('returns null when there is no BPMN signal at all', () => {
        expect(detectBpmnFlowType({})).toBeNull();
        expect(detectBpmnFlowType({ label: 'depende de' })).toBeNull();
    });

    it('honours explicit bpmnFlowType metadata first', () => {
        expect(detectBpmnFlowType({ bpmnFlowType: 'message-flow' })).toBe('message-flow');
        expect(detectBpmnFlowType({ bpmnFlowType: 'sequence' })).toBe('sequence-flow');
        expect(detectBpmnFlowType({ bpmnFlowType: 'conditional' })).toBe('conditional-flow');
        expect(detectBpmnFlowType({ bpmnFlowType: 'default-flow' })).toBe('default-flow');
        expect(detectBpmnFlowType({ bpmnFlowType: 'association' })).toBe('association');
    });

    it('honours boolean toggles when explicit type is missing', () => {
        expect(detectBpmnFlowType({ messageFlow: true })).toBe('message-flow');
        expect(detectBpmnFlowType({ sequenceFlow: true })).toBe('sequence-flow');
        expect(detectBpmnFlowType({ association: true })).toBe('association');
        expect(detectBpmnFlowType({ defaultFlow: true })).toBe('default-flow');
    });

    it('treats edges with a condition as conditional flow', () => {
        expect(detectBpmnFlowType({ condition: 'monto > 10000' })).toBe('conditional-flow');
    });

    it('infers message-flow from async / messaging semantics', () => {
        expect(detectBpmnFlowType({ semanticType: 'async-messaging' })).toBe('message-flow');
        expect(detectBpmnFlowType({ semanticType: 'event' })).toBe('message-flow');
        expect(detectBpmnFlowType({ relation: 'async' })).toBe('message-flow');
    });

    it('promotes cross-lane edges to message-flow when no other signal is given', () => {
        expect(detectBpmnFlowType({ crossLane: true })).toBe('message-flow');
    });

    it('exports visual tokens for every BPMN flow type', () => {
        for (const k of ['sequence-flow', 'message-flow', 'association', 'conditional-flow', 'default-flow'] as const) {
            const tokens = BPMN_FLOW_TOKENS[k];
            expect(tokens.label.length).toBeGreaterThan(0);
            expect(tokens.light).toMatch(/^#/);
            expect(tokens.dark).toMatch(/^#/);
        }
    });
});
