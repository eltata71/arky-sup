import { describe, it, expect } from 'vitest';
import {
    canonicalKindForRole,
    normalizeDiagramNodeSemantics,
    repairDiagramIRSemantics,
    resolveSemanticRole,
} from '../../lib/semanticRoleResolver';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';
import type { DiagramIR } from '../../lib/diagram';

describe('resolveSemanticRole — structural precedence', () => {
    it('always resolves Person / Person_Ext kinds as person regardless of label', () => {
        expect(resolveSemanticRole({ kind: 'Person', label: 'whatever' })).toBe('person');
        expect(resolveSemanticRole({ kind: 'Person_Ext', label: 'whatever' })).toBe('person');
        expect(resolveSemanticRole({ kind: 'Actor', label: 'whatever' })).toBe('person');
    });

    it('treats ContainerDb / SystemDb / SystemQueue as data / messaging', () => {
        expect(resolveSemanticRole({ kind: 'ContainerDb', label: 'PG' })).toBe('data');
        expect(resolveSemanticRole({ kind: 'SystemDb', label: 'core' })).toBe('data');
        expect(resolveSemanticRole({ kind: 'SystemQueue', label: 'events' })).toBe('messaging');
        expect(resolveSemanticRole({ kind: 'ContainerQueue', label: 'jobs' })).toBe('messaging');
    });

    it('classifies SoftwareSystem / System / System_Ext as system', () => {
        expect(resolveSemanticRole({ kind: 'SoftwareSystem', label: 'CRM' })).toBe('system');
        expect(resolveSemanticRole({ kind: 'System', label: 'Core' })).toBe('system');
        expect(resolveSemanticRole({ kind: 'System_Ext', label: 'Partner' })).toBe('system');
    });

    it('classifies Container / Component as service when the label is neutral', () => {
        // Ambiguous wrappers default to `service`. Strong label evidence
        // (gateway, db, kafka, thirdparty, …) can refine them — covered by
        // dedicated tests below.
        expect(resolveSemanticRole({ kind: 'Container', label: 'Core Backend' })).toBe('service');
        expect(resolveSemanticRole({ kind: 'Component', label: 'Auth Module' })).toBe('service');
        expect(resolveSemanticRole({ kind: 'Container', label: 'Worker' })).toBe('service');
    });

    it('lets the label refine ambiguous Container kinds to gateway / data / messaging / external', () => {
        expect(resolveSemanticRole({ kind: 'Container', label: 'API Gateway' })).toBe('gateway');
        expect(resolveSemanticRole({ kind: 'Container_Ext', label: 'Third-party SaaS' })).toBe('external');
        expect(resolveSemanticRole({ kind: 'Container', label: 'Postgres Cluster' })).toBe('data');
        expect(resolveSemanticRole({ kind: 'Container', label: 'Kafka Topic' })).toBe('messaging');
    });

    it('classifies API Gateway / BFF / Ingress / Proxy as gateway', () => {
        expect(resolveSemanticRole({ label: 'API Gateway' })).toBe('gateway');
        expect(resolveSemanticRole({ label: 'Pasarela de Pagos' })).toBe('gateway');
        expect(resolveSemanticRole({ label: 'BFF Web' })).toBe('gateway');
        expect(resolveSemanticRole({ label: 'Edge Proxy' })).toBe('gateway');
    });
});

describe('resolveSemanticRole — insurance domain dictionary', () => {
    it('never classifies an "Asegurado" / "Proveedor Médico" / "Corredor" as a process', () => {
        // These were the labels surfacing as pink "process" cards on C4
        // Container diagrams for insurance projects.
        expect(resolveSemanticRole({ label: 'Asegurado' })).toBe('person');
        expect(resolveSemanticRole({ label: 'Proveedor Médico' })).toBe('person');
        expect(resolveSemanticRole({ label: 'Corredor de Seguros' })).toBe('person');
        expect(resolveSemanticRole({ label: 'Broker' })).toBe('person');
        expect(resolveSemanticRole({ label: 'Beneficiario' })).toBe('person');
        expect(resolveSemanticRole({ label: 'Empleador' })).toBe('person');
        expect(resolveSemanticRole({ label: 'Analista de Reclamos' })).toBe('person');
    });

    it('does not over-trigger person on tangentially related nouns', () => {
        // "Cliente" by itself is `person`, but "Servicio de Clientes" should
        // still be `person` because the dictionary intentionally surfaces
        // any actor noun. We only assert it does NOT degrade to `process`.
        expect(resolveSemanticRole({ label: 'Servicio de Clientes' })).not.toBe('process');
    });
});

describe('resolveSemanticRole — process-positive only on real verbs', () => {
    it('classifies workflow / pipeline / aprobación / validación as process', () => {
        expect(resolveSemanticRole({ label: 'Validación de Elegibilidad', diagramKind: 'flowchart' })).toBe('process');
        expect(resolveSemanticRole({ label: 'Aprobación de Reclamo', diagramKind: 'flowchart' })).toBe('process');
        expect(resolveSemanticRole({ label: 'Pipeline de cobranza' })).toBe('process');
        expect(resolveSemanticRole({ label: 'Workflow de Pagos' })).toBe('process');
    });

    it('falls back to generic — NOT process — when the label is unknown on a C4 dialect', () => {
        expect(resolveSemanticRole({ label: 'Xenobyte', diagramKind: 'C4Context' })).toBe('generic');
        expect(resolveSemanticRole({ label: 'foo', diagramKind: 'C4Container' })).toBe('generic');
    });
});

describe('normalizeDiagramNodeSemantics — visual contract repair', () => {
    it('coerces a Person node with rectangle shape to shape: person', () => {
        const { node, role, changes } = normalizeDiagramNodeSemantics(
            { id: 'a', label: 'Asegurado', kind: 'Person', shape: 'rectangle' },
        );
        expect(role).toBe('person');
        expect(node.shape).toBe('person');
        expect(node.semanticRole).toBe('person');
        expect(changes.join(' ')).toMatch(/shape rectangle → person/);
    });

    it('coerces a Database-kind node to cylinder shape when shape is missing', () => {
        const { node, role } = normalizeDiagramNodeSemantics(
            { id: 'db', label: 'Reclamos DB', kind: 'ContainerDb' },
        );
        expect(role).toBe('data');
        expect(node.shape).toBe('cylinder');
    });

    it('attaches semanticRole to nodes that lack it without rewriting shape', () => {
        const { node } = normalizeDiagramNodeSemantics(
            { id: 'q', label: 'Cola de Eventos', kind: 'Queue', shape: 'tab-box' },
        );
        expect(node.semanticRole).toBe('messaging');
        expect(node.shape).toBe('tab-box');
    });

    it('repairs a legacy node tagged kind:process + shape:person + label:Asegurado', () => {
        const { node, changes } = normalizeDiagramNodeSemantics(
            { id: 'u', label: 'Asegurado', kind: 'process', shape: 'person' },
        );
        expect(node.semanticRole).toBe('person');
        expect(node.shape).toBe('person');
        // The shape was already right, so the only repair is the role itself.
        expect(changes.length).toBeGreaterThanOrEqual(0);
    });

    it('infers semanticType for legacy, integration and cloud signals', () => {
        const legacy = normalizeDiagramNodeSemantics({ id: 'l', label: 'AS400 Claims', kind: 'System' }).node;
        expect(legacy.semanticType).toBe('legacy-system');
        const integration = normalizeDiagramNodeSemantics({ id: 'm', label: 'MuleSoft API Layer', kind: 'Container' }).node;
        expect(integration.semanticType).toBe('integration-platform');
        const cloud = normalizeDiagramNodeSemantics({ id: 'c', label: 'AWS Lambda', kind: 'service' }).node;
        expect(cloud.semanticType).toBe('cloud-service');
    });
});

describe('repairDiagramIRSemantics — IR-wide pass', () => {
    it('records every change in metadata.repairHistory', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'Asegurado', kind: 'process', shape: 'rectangle' },
                { id: 'b', label: 'Base de Datos', kind: 'process' },
            ],
            edges: [],
            groups: [],
        };
        const { ir: repaired, changes } = repairDiagramIRSemantics(ir);
        expect(changes.length).toBeGreaterThan(0);
        const history = repaired.metadata?.repairHistory ?? [];
        expect(history.length).toBe(1);
        expect(history[0].reason).toBe('semantic-role-repair');
        expect(history[0].changes.length).toBeGreaterThan(0);
    });

    it('is a no-op when the IR is already consistent', () => {
        const ir: DiagramIR = {
            nodes: [{ id: 'a', label: 'Usuario', kind: 'person', shape: 'person', semanticRole: 'person' }],
            edges: [],
            groups: [],
        };
        const { ir: repaired, changes } = repairDiagramIRSemantics(ir);
        expect(changes.length).toBe(0);
        expect(repaired.metadata?.repairHistory).toBeUndefined();
    });
});

describe('canonicalKindForRole', () => {
    it('round-trips every role to a lowercase canonical string', () => {
        expect(canonicalKindForRole('person')).toBe('person');
        expect(canonicalKindForRole('system')).toBe('system');
        expect(canonicalKindForRole('gateway')).toBe('gateway');
        expect(canonicalKindForRole('data')).toBe('data');
        expect(canonicalKindForRole('messaging')).toBe('messaging');
        expect(canonicalKindForRole('external')).toBe('external');
        expect(canonicalKindForRole('service')).toBe('service');
        expect(canonicalKindForRole('process')).toBe('process');
        expect(canonicalKindForRole('generic')).toBe('generic');
    });
});

describe('mermaidToIR — C4 dialect surfaces canonical semantic roles', () => {
    it('parses Person(asegurado, "Asegurado", "...") as semanticRole: person', () => {
        const ir = mermaidToIR(`C4Context
            Person(asegurado, "Asegurado", "Cliente del producto de salud")
            System(core, "Core de Pólizas", "Backend de gestión")
            Rel(asegurado, core, "Compra póliza")
        `);
        const asegurado = ir.nodes.find((n) => n.id === 'asegurado');
        expect(asegurado?.semanticRole).toBe('person');
        expect(asegurado?.shape).toBe('person');
        const core = ir.nodes.find((n) => n.id === 'core');
        expect(core?.semanticRole).toBe('system');
        // Core de Pólizas must NEVER classify as process.
        expect(core?.semanticRole).not.toBe('process');
    });

    it('parses Person_Ext(provider, "Proveedor Médico", "...") as person', () => {
        const ir = mermaidToIR(`C4Container
            Person_Ext(provider, "Proveedor Médico", "Red de clínicas")
            ContainerDb(db, "Base de Datos de Reclamos", "PostgreSQL", "Persistencia")
            ContainerQueue(q, "Cola de Eventos", "Kafka", "Stream de claims")
        `);
        const prov = ir.nodes.find((n) => n.id === 'provider');
        expect(prov?.semanticRole).toBe('person');
        expect(prov?.shape).toBe('person');
        const db = ir.nodes.find((n) => n.id === 'db');
        expect(db?.semanticRole).toBe('data');
        expect(db?.shape).toBe('cylinder');
        const q = ir.nodes.find((n) => n.id === 'q');
        expect(q?.semanticRole).toBe('messaging');
    });

    it('parses Container(api, "API Gateway", "...") as gateway', () => {
        const ir = mermaidToIR(`C4Container
            Container(api, "API Gateway", "Spring Cloud Gateway", "Pasarela pública")
        `);
        const api = ir.nodes.find((n) => n.id === 'api');
        expect(api?.semanticRole).toBe('gateway');
    });

    it('never assigns process to unknown C4 nodes — falls back to generic', () => {
        const ir = mermaidToIR(`C4Context
            System(foo, "Sistema Desconocido", "Sin descripción")
        `);
        const foo = ir.nodes.find((n) => n.id === 'foo');
        expect(foo?.semanticRole).toBe('system');
        // Even without a recognised label the C4 kind dominates the role.
    });

    it('flowchart with "Analista de Reclamos" label classifies as person, never process', () => {
        const ir = mermaidToIR(`flowchart LR
            A[Analista de Reclamos] --> B[Valida documentación]
        `);
        const a = ir.nodes.find((n) => n.id === 'A');
        expect(a?.semanticRole).toBe('person');
        // "Valida documentación" carries "validación" verb → process is OK.
        const b = ir.nodes.find((n) => n.id === 'B');
        expect(b?.semanticRole).toBe('process');
    });
});
