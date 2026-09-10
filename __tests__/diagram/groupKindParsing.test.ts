import { describe, expect, it } from 'vitest';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';

describe('C4 boundary kind parsing', () => {
    it('tags System_Boundary as system-boundary', () => {
        const mermaid = `
C4Container
title PBM
Person(p, "Asegurado", "Beneficiario del plan")
System_Boundary(pbm, "Plataforma PBM") {
    Container(api, "API Gateway", "MuleSoft", "Punto de entrada de tráfico")
    Container(db, "Reclamos DB", "PostgreSQL", "Persistencia de reclamos")
}
Rel(p, api, "consulta", "HTTPS")
Rel(api, db, "almacena", "JDBC")
        `.trim();
        const ir = mermaidToIR(mermaid);
        const group = ir.groups.find((g) => g.label.includes('Plataforma PBM'));
        expect(group).toBeDefined();
        expect(group!.kind).toBe('system-boundary');
    });

    it('tags Enterprise_Boundary as enterprise', () => {
        const mermaid = `
C4Context
title Enterprise overview
Person(p, "Cliente")
Enterprise_Boundary(b, "Empresa") {
    System(s1, "Sistema A")
    System(s2, "Sistema B")
}
Rel(p, s1, "usa")
        `.trim();
        const ir = mermaidToIR(mermaid);
        const group = ir.groups.find((g) => g.label.includes('Empresa'));
        expect(group).toBeDefined();
        expect(group!.kind).toBe('enterprise');
    });

    it('tags container_boundary as cluster', () => {
        const mermaid = `
C4Component
title Backend internals
Container_Boundary(b, "Backend") {
    Component(svc, "Service A")
    Component(db, "Service B")
}
Rel(svc, db, "calls")
        `.trim();
        const ir = mermaidToIR(mermaid);
        const group = ir.groups.find((g) => g.label.includes('Backend'));
        expect(group).toBeDefined();
        expect(group!.kind).toBe('cluster');
    });

    it('tags Deployment_Node with AWS as cloud', () => {
        const mermaid = `
C4Deployment
title Producción AWS
Deployment_Node(prod, "Producción", "AWS us-east-1") {
    Container(api, "API", "Node.js")
    ContainerDb(db, "Postgres", "RDS")
}
Rel(api, db, "lee")
        `.trim();
        const ir = mermaidToIR(mermaid);
        const group = ir.groups.find((g) => g.label.includes('Producción'));
        expect(group).toBeDefined();
        expect(group!.kind).toBe('cloud');
    });
});
