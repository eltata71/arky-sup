import { describe, it, expect } from 'vitest';
import { resolveRenderableDiagram } from '../../services/diagram/resolveRenderableDiagram';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';
import type { Artifact } from '../../lib/artifacts';

const baseArtifact = (content: string, type: Artifact['type'] = 'mermaid-c4-container'): Artifact => ({
    id: 'a1',
    versionGroupId: 'vg1',
    name: 'Diagrama de Contenedores (C4-N2)',
    type,
    content,
    phase: 'Fase 2: Diseño Conceptual y Lógico',
    architecturalView: 'Vista Lógica y de Diseño',
    objective: 'Test',
    keyConcepts: [],
    representation: 'diagram',
    createdAt: new Date().toISOString(),
    version: 1,
});

describe('C4 Container — render-time pipeline', () => {
    it('renders nodes for a typical C4 Container Mermaid output', () => {
        const code = `C4Container
    title Container Diagram — Reservas
    Person(user, "Cliente", "Realiza reservas")
    System_Boundary(sb, "Sistema Reservas") {
        Container(web, "Portal Web", "React 19", "Frontend de reservas")
        Container(api, "API Reservas", "Node.js", "Servicios de negocio")
        ContainerDb(db, "DB Reservas", "PostgreSQL", "Persistencia")
        ContainerQueue(q, "Eventos", "Kafka", "Bus de eventos")
    }
    Rel(user, web, "Usa", "HTTPS")
    Rel(web, api, "Llama", "HTTPS/JSON")
    Rel(api, db, "Lee/escribe", "TCP/5432")
    Rel(api, q, "Publica eventos", "Kafka")`;
        const result = resolveRenderableDiagram(baseArtifact(code), { audience: 'technical' });
        expect(result.status).toBe('ready');
        expect(result.counters.renderNodes).toBeGreaterThanOrEqual(5);
        expect(result.reactFlow.nodes.length).toBeGreaterThanOrEqual(5);
    });

    it('renders nodes when persisted IR is loaded directly (no gate mutation)', () => {
        // Simulate a persisted artifact that already went through the
        // generation gate. The render path must trust it and never strip nodes.
        const code = `C4Container
    Container(web, "Web", "React", "UI")
    ContainerDb(db, "DB", "Postgres", "Datos")
    Rel(web, db, "Consulta", "SQL")`;
        const ir = mermaidToIR(code);
        const artifact = { ...baseArtifact(code), ir };
        const result = resolveRenderableDiagram(artifact, { audience: 'technical' });
        expect(result.reactFlow.nodes.length).toBe(2);
    });

    it('Integration diagram (mermaid-graph) renders all nodes', () => {
        const code = `flowchart LR
    crm[Salesforce CRM] -->|REST/HTTPS| esb[Mulesoft ESB]
    esb -->|JDBC| erp[(SAP ERP)]
    esb -->|SOAP| billing[Sistema de Facturación]
    crm -->|OAuth2| auth[Identity Provider]`;
        const ir = mermaidToIR(code);
        expect(ir.nodes.length).toBe(5);
        const result = resolveRenderableDiagram(
            { ...baseArtifact(code, 'mermaid-graph'), ir },
            { audience: 'technical' },
        );
        expect(result.status).toBe('ready');
        expect(result.reactFlow.nodes.length).toBe(5);
    });

    it('renders C4 Component diagram without losing nodes through projection', () => {
        const code = `C4Component
    title Component Diagram — API Reservas
    Container_Boundary(api, "API Reservas") {
        Component(ctrl, "Reservation Controller", "Spring REST", "Orquesta peticiones")
        Component(svc, "Reservation Service", "Java", "Lógica de negocio")
        Component(repo, "Reservation Repository", "JPA", "Acceso a datos")
        Component(map, "DTO Mapper", "MapStruct", "Conversión")
    }
    ContainerDb(db, "Reservations DB", "PostgreSQL", "Persistencia")
    Rel(ctrl, svc, "Invoca", "method call")
    Rel(svc, repo, "Lee/escribe", "method call")
    Rel(svc, map, "Mapea", "method call")
    Rel(repo, db, "Persiste", "JDBC")`;
        const ir = mermaidToIR(code);
        const result = resolveRenderableDiagram(
            { ...baseArtifact(code, 'mermaid-c4-component'), ir },
            { audience: 'technical' },
        );
        expect(result.status).toBe('ready');
        expect(result.reactFlow.nodes.length).toBeGreaterThanOrEqual(5);
    });
});
