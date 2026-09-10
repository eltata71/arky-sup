import { describe, it, expect } from 'vitest';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';

describe('C4 AI failure modes — what the parser does with imperfect input', () => {
    it('parses C4 even when System_Boundary has no closing brace (defensive)', () => {
        const code = `C4Container
    Person(user, "Cliente", "Usuario")
    System_Boundary(sb, "Sistema") {
        Container(api, "API", "Node", "API")
        ContainerDb(db, "DB", "Postgres", "Datos")
    Rel(user, api, "Usa", "HTTPS")
    Rel(api, db, "Persiste", "SQL")`;
        const ir = mermaidToIR(code);
        console.log('Missing brace - nodes:', ir.nodes.length, 'edges:', ir.edges.length);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(2);
    });

    it('parses C4 with double quotes inside descriptions (escaped or not)', () => {
        const code = `C4Container
    Person(user, "Cliente \\"Premium\\"", "Usuario")
    Container(api, "API", "Node", "Sirve \\"endpoints\\" REST")
    Rel(user, api, "Usa", "HTTPS")`;
        const ir = mermaidToIR(code);
        console.log('Escaped quotes - nodes:', ir.nodes.length, 'edges:', ir.edges.length);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(2);
    });

    it('parses Mermaid with %%{init} directive followed by C4', () => {
        const code = `%%{ init: { 'theme': 'default', 'themeVariables': { 'fontFamily': 'Arial' } } }%%
C4Container
title Container Diagram - Sistema
Person(user, "Cliente", "Usuario")
Container(api, "API", "Node", "REST")
Rel(user, api, "Usa", "HTTPS")`;
        const ir = mermaidToIR(code);
        console.log('init directive - nodes:', ir.nodes.length, 'edges:', ir.edges.length);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(2);
    });

    it('parses C4 when AI emits Container() declarations split across multiple lines', () => {
        const code = `C4Container
Person(user, "Cliente",
    "Usuario que hace reservas")
Container(api,
    "API de Reservas",
    "Node.js + Express",
    "Maneja reservas")
ContainerDb(db,
    "Base de Datos",
    "PostgreSQL 15",
    "Persistencia")
Rel(user, api, "Crea reserva", "HTTPS/JSON")
Rel(api, db, "Persiste", "JDBC")`;
        const ir = mermaidToIR(code);
        console.log('Multiline declarations - nodes:', ir.nodes.length, 'edges:', ir.edges.length);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(2);
    });

    it('parses C4 when nested System_Boundary uses System_Boundary inside System_Boundary', () => {
        const code = `C4Container
System_Boundary(outer, "Plataforma") {
    System_Boundary(inner, "Núcleo") {
        Container(api, "API", "Node", "REST")
        ContainerDb(db, "DB", "Postgres", "Datos")
    }
    Container(web, "Web", "React", "Frontend")
}
Rel(web, api, "Usa", "HTTPS")
Rel(api, db, "Persiste", "SQL")`;
        const ir = mermaidToIR(code);
        console.log('Nested boundaries - nodes:', ir.nodes.length, 'edges:', ir.edges.length, 'groups:', ir.groups.length);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(3);
    });

    it('parses Mermaid graph when AI uses class assignments at the top', () => {
        const code = `flowchart LR
classDef api fill:#ede9fe,stroke:#7c3aed
classDef db fill:#d1fae5,stroke:#059669
classDef ext fill:#f1f5f9,stroke:#64748b

class crm,esb,sap api
class billing db

crm[Salesforce CRM] -->|REST| esb[Mulesoft ESB]
esb -->|JDBC| sap[(SAP ERP)]
esb -->|SOAP| billing[Sistema de Facturación]`;
        const ir = mermaidToIR(code);
        console.log('class assignments first - nodes:', ir.nodes.length, 'edges:', ir.edges.length);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(3);
    });

    it('parses Mermaid graph with inline styles in flowchart syntax', () => {
        const code = `flowchart LR
    style A fill:#e0e7ff,stroke:#4f46e5
    A[Frontend] -->|REST| B[API]
    B -->|JDBC| C[(DB)]
    style B fill:#ede9fe,stroke:#7c3aed`;
        const ir = mermaidToIR(code);
        console.log('inline styles - nodes:', ir.nodes.length, 'edges:', ir.edges.length);
        expect(ir.nodes.length).toBe(3);
    });

    it('handles empty content gracefully', () => {
        const ir = mermaidToIR('');
        expect(ir.nodes.length).toBe(0);
    });

    it('handles content with only header gracefully', () => {
        const ir = mermaidToIR('C4Container');
        expect(ir.nodes.length).toBe(0);
    });
});
