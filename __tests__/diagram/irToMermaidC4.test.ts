/**
 * El serializador C4 y el que respeta el dialecto (plan de diagramas, 6.1).
 *
 * La prueba que importa es la ida y vuelta: lo que se escribe tiene que leerse
 * igual con `mermaidToIR`, que es lo que el lienzo y la compuerta de
 * renderizado usan. Un serializador que produce C4 válido para Mermaid pero
 * que el parser propio no entiende sería un diagrama vacío en el lienzo.
 */
import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';
import { c4LevelOfArtifactType, irToMermaidC4 } from '../../services/diagram/irToMermaidC4';
import { mermaidDialectOf, serializeIRPreservingDialect } from '../../services/diagram/dialectSerialization';

const containerIR: DiagramIR = {
    nodes: [
        { id: 'asegurado', label: 'Asegurado', kind: 'person', description: 'Titular de la póliza' },
        { id: 'api-reclamaciones', label: 'API Reclamaciones', kind: 'service', technology: 'Spring Boot 3', description: 'Registra reclamaciones' },
        { id: 'bd', label: 'BD Reclamaciones', kind: 'data', technology: 'PostgreSQL 15' },
        { id: 'bus', label: 'Bus de Eventos', kind: 'messaging', technology: 'Kafka 3.6', description: 'Eventos' },
        { id: 'clearinghouse', label: 'Clearinghouse', kind: 'external', trust: 'partner', description: 'EDI con proveedores' },
    ],
    edges: [
        { id: 'e1', source: 'asegurado', target: 'api-reclamaciones', label: 'Consulta estado', protocol: 'HTTPS' },
        { id: 'e2', source: 'api-reclamaciones', target: 'bd', label: 'Persiste · JDBC', protocol: 'JDBC' },
        { id: 'e3', source: 'clearinghouse', target: 'api-reclamaciones', label: 'Envía 837', protocol: 'X12', direction: 'bidirectional' },
        { id: 'e4', source: 'api-reclamaciones', target: 'fantasma', label: 'No existe' },
    ],
    groups: [
        { id: 'plataforma', label: 'Plataforma "Reclamaciones"', nodeIds: ['api-reclamaciones', 'bd', 'bus'], kind: 'system-boundary' },
    ],
    metadata: { title: 'Contenedores de Reclamaciones' },
};

describe('irToMermaidC4', () => {
    it('escribe la cabecera del nivel y el título', () => {
        const text = irToMermaidC4(containerIR, 'container');
        expect(text.split('\n')[0]).toBe('C4Container');
        expect(text).toContain('title Contenedores de Reclamaciones');
        expect(irToMermaidC4(containerIR, 'context').split('\n')[0]).toBe('C4Context');
        expect(irToMermaidC4(containerIR, 'component').split('\n')[0]).toBe('C4Component');
        expect(irToMermaidC4(containerIR, 'deployment').split('\n')[0]).toBe('C4Deployment');
    });

    it('elige la macro por el papel del elemento y el nivel', () => {
        const text = irToMermaidC4(containerIR, 'container');
        expect(text).toContain('Person(asegurado, "Asegurado", "Titular de la póliza")');
        expect(text).toContain('Container(api_reclamaciones, "API Reclamaciones", "Spring Boot 3", "Registra reclamaciones")');
        expect(text).toContain('ContainerDb(bd, "BD Reclamaciones", "PostgreSQL 15", "PostgreSQL 15")');
        expect(text).toContain('ContainerQueue(bus,');
        expect(text).toContain('System_Ext(clearinghouse,');
    });

    it('en contexto nadie es contenedor, y la tecnología de un sistema viaja en su descripción', () => {
        const text = irToMermaidC4(containerIR, 'context');
        expect(text).not.toMatch(/\bContainer/);
        expect(text).toContain('System(api_reclamaciones, "API Reclamaciones", "Registra reclamaciones [Spring Boot 3]")');
        expect(text).toContain('SystemDb(bd,');
    });

    it('agrupa en límites, no repite la etiqueta del protocolo y descarta relaciones sin extremo', () => {
        const text = irToMermaidC4(containerIR, 'container');
        expect(text).toContain(`System_Boundary(plataforma, "Plataforma 'Reclamaciones'") {`);
        expect(text).toContain('Rel(api_reclamaciones, bd, "Persiste · JDBC")');
        expect(text).toContain('BiRel(clearinghouse, api_reclamaciones, "Envía 837", "X12")');
        expect(text).not.toContain('fantasma');
    });

    it('se lee de vuelta con mermaidToIR: mismos elementos, tecnologías y límite', () => {
        const back = mermaidToIR(irToMermaidC4(containerIR, 'container'));
        expect(back.nodes.map((n) => n.label).sort()).toEqual(containerIR.nodes.map((n) => n.label).sort());
        expect(back.nodes.find((n) => n.label === 'API Reclamaciones')?.technology).toBe('Spring Boot 3');
        expect(back.nodes.find((n) => n.label === 'BD Reclamaciones')?.technology).toBe('PostgreSQL 15');
        expect(back.groups.find((g) => g.nodeIds.length === 3)).toBeDefined();
        expect(back.edges.length).toBeGreaterThanOrEqual(3);
    });

    it('da alias únicos aunque dos ids se normalicen igual', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a-b', label: 'Uno', kind: 'service' },
                { id: 'a_b', label: 'Dos', kind: 'service' },
            ],
            edges: [{ id: 'e', source: 'a-b', target: 'a_b', label: 'Llama' }],
            groups: [],
        };
        const back = mermaidToIR(irToMermaidC4(ir, 'container'));
        expect(back.nodes).toHaveLength(2);
        expect(back.edges).toHaveLength(1);
    });

    it('reconoce los cuatro tipos C4 y nada más', () => {
        expect(c4LevelOfArtifactType('mermaid-c4-context')).toBe('context');
        expect(c4LevelOfArtifactType('mermaid-c4-deployment')).toBe('deployment');
        expect(c4LevelOfArtifactType('mermaid-graph')).toBeNull();
    });
});

describe('serializeIRPreservingDialect', () => {
    const ir: DiagramIR = {
        nodes: [{ id: 'a', label: 'A', kind: 'service' }, { id: 'b', label: 'B', kind: 'service' }],
        edges: [{ id: 'e', source: 'a', target: 'b', label: 'Llama' }],
        groups: [],
    };

    it('reescribe un C4 en C4 y un flowchart en flowchart', () => {
        expect(mermaidDialectOf(serializeIRPreservingDialect(ir, 'mermaid-c4-container', 'C4Container\n')!)).toBe('c4container');
        expect(mermaidDialectOf(serializeIRPreservingDialect(ir, 'mermaid-graph', 'graph TD\n A-->B')!)).toBe('flowchart');
    });

    it('no reescribe los dialectos que un IR no puede contener', () => {
        expect(serializeIRPreservingDialect(ir, 'mermaid-sequence', 'sequenceDiagram\n A->>B: Hola')).toBeNull();
        expect(serializeIRPreservingDialect(ir, 'mermaid-erd', '%% comentario\nerDiagram\n A ||--o{ B : tiene')).toBeNull();
        expect(serializeIRPreservingDialect(ir, 'hybrid-text-diagram', 'stateDiagram-v2\n [*] --> A')).toBeNull();
    });

    it('lee el dialecto saltando comentarios y front matter', () => {
        expect(mermaidDialectOf('---\ntitle: X\n---\n%% nota\nflowchart LR\n')).toBe('flowchart');
        expect(mermaidDialectOf('')).toBe('');
    });
});
