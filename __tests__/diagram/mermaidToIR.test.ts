import { describe, it, expect } from 'vitest';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';

describe('mermaidToIR — flowchart', () => {
    it('parses a simple flowchart with labels and relations', () => {
        const code = `flowchart LR
    A[User] --> B((API Gateway))
    B -->|REST| C[(Database)]`;
        const ir = mermaidToIR(code);
        expect(ir.nodes.length).toBe(3);
        expect(ir.nodes.find(n => n.id === 'A')?.label).toBe('User');
        expect(ir.nodes.find(n => n.id === 'C')?.shape).toBe('cylinder');
        expect(ir.edges.length).toBe(2);
        const restEdge = ir.edges.find(e => e.source === 'B' && e.target === 'C');
        expect(restEdge?.label).toBe('REST');
    });

    it('handles subgraph grouping', () => {
        const code = `flowchart TD
    subgraph core [Core]
        A[Service A]
        B[Service B]
    end
    A --> B`;
        const ir = mermaidToIR(code);
        expect(ir.groups.length).toBe(1);
        expect(ir.groups[0].label).toBe('Core');
        expect(ir.groups[0].nodeIds).toEqual(expect.arrayContaining(['A', 'B']));
    });

    it('parses BPMN-style swimlanes with quoted labels and decision diamonds', () => {
        // Mirrors the deterministic BPMN fallback used by the on-demand
        // pharmacy-claim flow. Asserts the parser produces an IR with both
        // node groups and decision nodes so the canvas does not fall back to
        // the placeholder when the local skeleton kicks in.
        const code = `flowchart LR
    subgraph farmacia_lane ["Farmacia"]
        dispensa["Dispensa medicamento"]
        captura["Captura reclamo en POS"]
        decide{"¿Reclamo aprobado?"}
        entrega["Entrega medicamento"]
    end
    subgraph aseguradora_lane ["Aseguradora"]
        adjudica["Adjudica monto"]
    end
    dispensa --> captura
    captura --> adjudica
    adjudica --> decide
    decide -->|Sí| entrega
    decide -->|No| captura`;
        const ir = mermaidToIR(code);

        expect(ir.nodes.length).toBeGreaterThanOrEqual(5);
        expect(ir.groups.map(g => g.label)).toEqual(expect.arrayContaining(['Farmacia', 'Aseguradora']));
        expect(ir.nodes.find(n => n.id === 'decide')?.shape).toBe('diamond');
        // Every node must carry either an incoming or outgoing edge so the
        // technical audience projection does not strip them.
        const referenced = new Set<string>();
        ir.edges.forEach(e => { referenced.add(e.source); referenced.add(e.target); });
        ir.nodes.forEach(n => expect(referenced.has(n.id) || Boolean(n.group)).toBe(true));
    });

    it('distinguishes async vs sync relations', () => {
        const ir = mermaidToIR(`flowchart LR\n  A --> B\n  A -.-> C\n  A ==> D`);
        const ab = ir.edges.find(e => e.target === 'B');
        const ac = ir.edges.find(e => e.target === 'C');
        const ad = ir.edges.find(e => e.target === 'D');
        expect(ab?.relation).toBe('default');
        expect(ac?.relation).toBe('async');
        expect(ad?.relation).toBe('data-flow');
    });
});

describe('mermaidToIR — sequence', () => {
    it('parses participants and messages', () => {
        const code = `sequenceDiagram
    participant U as User
    participant API as Gateway
    U->>API: Request
    API-->>U: Response`;
        const ir = mermaidToIR(code);
        expect(ir.nodes.map(n => n.id).sort()).toEqual(['API', 'U']);
        expect(ir.edges.length).toBe(2);
        expect(ir.edges[0].label).toBe('Request');
    });

    it('parses relaxed AI sequence syntax with activation markers and implicit participants', () => {
        const code = `sequenceDiagram
    autonumber
    actor Usuario as "Usuario final"
    participant API-Gateway as "API Gateway"
    Usuario->>+API-Gateway: Solicita estado de módulos
    API-Gateway-->>-Usuario: Devuelve interacciones
    "Sistema externo"-)API-Gateway: Notifica evento`;
        const ir = mermaidToIR(code);

        expect(ir.nodes.map(n => n.id)).toEqual(expect.arrayContaining(['Usuario', 'API-Gateway', 'seq_sistema_externo']));
        expect(ir.nodes.find(n => n.id === 'Usuario')?.label).toBe('Usuario final');
        expect(ir.edges).toHaveLength(3);
        expect(ir.edges[0].label).toBe('Solicita estado de módulos');
    });
});

describe('mermaidToIR — c4', () => {
    it('parses c4 aliases with hyphen/dot and BiRel relationships', () => {
        const code = `C4Context
title System Context Diagram — Payments
Person(user.web, "Usuario Web", "Cliente final")
System(api-gateway, "API Gateway", "Punto de entrada")
System_Ext(core.erp, "ERP Core", "Sistema legado")
Rel(user.web, api-gateway, "Consulta saldo", "HTTPS")
BiRel(api-gateway, core.erp, "Sincroniza datos", "AMQP")`;
        const ir = mermaidToIR(code);
        expect(ir.nodes.map(n => n.id).sort()).toEqual(['api-gateway', 'core.erp', 'user.web']);
        // 1 Rel + BiRel split into 2 directed edges so arrowheads render correctly.
        expect(ir.edges.length).toBe(3);
        // Technology hint is appended to the edge label so reviewers see the
        // protocol on the canvas without opening a side panel.
        expect(ir.edges.find(e => e.source === 'api-gateway' && e.target === 'core.erp')?.label)
            .toBe('Sincroniza datos · AMQP');
        expect(ir.edges.find(e => e.source === 'core.erp' && e.target === 'api-gateway')?.label)
            .toBe('Sincroniza datos · AMQP');
    });

    it('supports single-quoted C4 arguments and directional relation variants', () => {
        const code = `C4Container
System_Boundary(sys, "Sistema de Reclamaciones") {
  Container(web, 'Portal Web', 'React 19', 'Frontend para usuarios')
  Container(api, 'API Claims', 'Node.js', 'Orquesta reglas de negocio')
}
ContainerDb(db, 'Claims DB', 'PostgreSQL', 'Persistencia operativa')
Rel_R(web, api, 'Invoca API', 'HTTPS/JSON')
Rel_D(api, db, 'Consulta y guarda', 'TCP/5432')`;
        const ir = mermaidToIR(code);
        expect(ir.nodes.map(n => n.id).sort()).toEqual(['api', 'db', 'web']);
        expect(ir.edges.length).toBe(2);
        expect(ir.edges.find(e => e.source === 'web' && e.target === 'api')?.label).toBe('Invoca API · HTTPS/JSON');
        expect(ir.edges.find(e => e.source === 'api' && e.target === 'db')?.label).toBe('Consulta y guarda · TCP/5432');
    });

    it('parses C4Deployment with Deployment_Node/Node, Container_Instance and compact semicolon syntax', () => {
        const code = `C4Deployment
Deployment_Node(cloud, "AWS Cloud", "AWS", "Cloud principal") {
  Deployment_Node(vpc, "VPC Privada", "10.0.0.0/16", "Segmento interno") {
    Node(eks, "EKS Cluster", "Kubernetes", "Control plane + workers") {
      Container_Instance(api_i, "API Instance", "Replica de API", "Spring Boot");
      Container_Instance(worker_i, "Worker Instance", "Replica Worker", "Node.js");
    }
  }
}
ContainerDb(db, "Orders DB", "PostgreSQL", "Datos de pedidos")
%% inline comment should be ignored
Rel(api_i, db, "Lee pedidos", "TCP/5432");
Rel(worker_i, db, "Actualiza estado", "TCP/5432")`;
        const ir = mermaidToIR(code);
        expect(ir.nodes.map(n => n.id)).toEqual(expect.arrayContaining(['cloud', 'vpc', 'eks', 'api_i', 'worker_i', 'db']));
        expect(ir.groups.map(g => g.id)).toEqual(expect.arrayContaining(['cloud', 'vpc', 'eks']));
        expect(ir.edges.find(e => e.source === 'api_i' && e.target === 'db')?.label).toBe('Lee pedidos · TCP/5432');
        expect(ir.edges.find(e => e.source === 'worker_i' && e.target === 'db')?.label).toBe('Actualiza estado · TCP/5432');
    });
});

describe('mermaidToIR — degraded input', () => {
    it('returns empty IR for gibberish', () => {
        const ir = mermaidToIR('this is not mermaid');
        expect(ir.nodes.length).toBe(0);
        expect(ir.edges.length).toBe(0);
    });
});

describe('mermaidToIR — flowchart lanes', () => {
    it('parses flowchart LR subgraphs as lanes with nodes and edges', () => {
        const ir = mermaidToIR(`flowchart LR
    subgraph farmacia_lane ["Farmacia"]
        dispensa_receta["Dispensa medicamento"]
        captura_reclamo["Captura reclamo"]
    end
    subgraph aseguradora_lane ["Aseguradora"]
        valida_cobertura["Valida cobertura"]
        autoriza_pago{"¿Autoriza pago?"}
    end
    dispensa_receta --> captura_reclamo
    captura_reclamo --> valida_cobertura
    valida_cobertura --> autoriza_pago`);

        expect(ir.nodes.map(node => node.id)).toEqual(expect.arrayContaining(['dispensa_receta', 'captura_reclamo', 'valida_cobertura', 'autoriza_pago']));
        expect(ir.groups.map(group => group.label)).toEqual(expect.arrayContaining(['Farmacia', 'Aseguradora']));
        expect(ir.edges.length).toBe(3);
    });
});
