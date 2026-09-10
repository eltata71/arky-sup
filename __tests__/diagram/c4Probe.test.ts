import { describe, it, expect } from 'vitest';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';

describe('C4 real-world probe', () => {
    it('parses with UpdateRelStyle/UpdateLayoutConfig directives', () => {
        const code = `C4Container
    title Container Diagram — Sistema
    Person(user, "Cliente", "Realiza reservas")
    System_Boundary(sb, "Sistema") {
        Container(api, "API", "Node.js", "REST API")
        ContainerDb(db, "DB", "PostgreSQL", "Datos")
    }
    Rel(user, api, "Usa", "HTTPS")
    Rel(api, db, "Persiste", "SQL")
    UpdateRelStyle(api, db, "color", "dashArray")
    UpdateLayoutConfig("3", "2")`;
        const ir = mermaidToIR(code);
        console.log('Update directives - nodes:', ir.nodes.length, 'edges:', ir.edges.length);
        expect(ir.nodes.length).toBeGreaterThan(0);
        expect(ir.edges.length).toBeGreaterThan(0);
    });

    it('parses with parens in label arguments (description)', () => {
        const code = `C4Component
    Container_Boundary(api, "API") {
        Component(svc, "Service", "Java", "Lógica de negocio (DDD)")
    }
    ContainerDb(db, "DB", "Postgres", "Datos")
    Rel(svc, db, "SELECT/UPDATE", "JDBC")`;
        const ir = mermaidToIR(code);
        console.log('Parens in description - nodes:', ir.nodes.length, 'edges:', ir.edges.length);
        expect(ir.nodes.length).toBeGreaterThan(0);
    });

    it('parses with extra trailing whitespace lines and indentation', () => {
        const code = `C4Container

    title Container Diagram - Sistema



    Person(user, "Cliente", "Realiza reservas")

    System_Boundary(sb, "Sistema") {

        Container(api, "API", "Node.js", "REST")

    }

    Rel(user, api, "Usa", "HTTPS")
`;
        const ir = mermaidToIR(code);
        console.log('Extra whitespace - nodes:', ir.nodes.length, 'edges:', ir.edges.length);
        expect(ir.nodes.length).toBeGreaterThan(0);
    });

    it('parses Mermaid with %%{init} directive at the top', () => {
        const code = `%%{init: {'theme':'base'}}%%
C4Container
title Container Diagram
Person(user, "Cliente", "Usuario")
Container(api, "API", "Node", "API")
Rel(user, api, "Usa", "HTTPS")`;
        const ir = mermaidToIR(code);
        console.log('init directive - nodes:', ir.nodes.length, 'edges:', ir.edges.length);
        expect(ir.nodes.length).toBeGreaterThan(0);
    });

    it('parses Mermaid C4 wrapped in code fences (defensive)', () => {
        const code = `\`\`\`mermaid
C4Container
Person(user, "Cliente", "Usuario")
Container(api, "API", "Node", "API")
Rel(user, api, "Usa", "HTTPS")
\`\`\``;
        // This case shouldn't happen because extractMermaidCode strips fences,
        // but if a fence sneaks through, the parser shouldn't choke on
        // backticks. (The C4 parser may not recognise this case; we just want
        // to confirm it doesn't throw and produces a sensible IR or empty IR.)
        const ir = mermaidToIR(code);
        console.log('with fences - nodes:', ir.nodes.length, 'edges:', ir.edges.length);
    });

    it('parses Integration diagram (mermaid-graph) flowchart with subgraphs', () => {
        const code = `flowchart LR
    classDef api fill:#ede9fe,stroke:#7c3aed
    classDef external fill:#f1f5f9,stroke:#64748b

    subgraph CRM ["CRM Salesforce"]
        sf[Salesforce]
        sfapi[Salesforce REST API]
    end

    subgraph ERP ["ERP SAP"]
        sap[SAP S/4HANA]
        sapodata[SAP OData]
    end

    subgraph Middleware ["Mulesoft ESB"]
        esb[Mule Runtime]
        connector[Mule Connectors]
    end

    sf --> sfapi
    sfapi -->|REST/HTTPS| esb
    esb --> connector
    connector -->|RFC/IDoc| sap
    sap --> sapodata

    class sfapi,esb api
    class sap,sf external`;
        const ir = mermaidToIR(code);
        console.log('Integration with subgraphs+classDef - nodes:', ir.nodes.length, 'edges:', ir.edges.length, 'groups:', ir.groups.length);
        expect(ir.nodes.length).toBeGreaterThan(0);
    });
});
