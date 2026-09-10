import { describe, it, expect } from 'vitest';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';
import { extractMermaidCode } from '../../utils/diagram/extractMermaid';
import { extractIRFromArtifact } from '../../services/diagram';

describe('mermaidToIR — C4 Container realistic output', () => {
    it('parses a complete C4Container with boundary, ContainerDb, and technology arg', () => {
        const code = `C4Container
title Container Diagram — Sistema EMA

Person(opAdm, "Operador EMA", "Personal del back office que aprueba alertas")

System_Boundary(ema, "Sistema EMA") {
    Container(webApp, "Aplicación Web", "Angular 16", "Interfaz de revisión de alertas")
    Container(api, "API EMA", "Java, Spring Boot 3.2", "Servicios REST")
    ContainerDb(db, "Base de Datos EMA", "PostgreSQL 15", "Persistencia de alertas")
}

System_Ext(legacy, "Sistema Legacy", "RPG/AS400")

Rel(opAdm, webApp, "Revisa alertas", "HTTPS")
Rel(webApp, api, "Llama API", "HTTPS/JSON")
Rel(api, db, "Lee/Escribe", "JDBC")
Rel(api, legacy, "Sincroniza", "AMQP")`;

        const ir = mermaidToIR(code);

        // Should NOT count the boundary 'ema' as a regular node
        const ids = ir.nodes.map(n => n.id).sort();
        expect(ids).toEqual(['api', 'db', 'legacy', 'opAdm', 'webApp']);

        // Database should have cylinder shape
        expect(ir.nodes.find(n => n.id === 'db')?.shape).toBe('cylinder');
        // Person should have person shape
        expect(ir.nodes.find(n => n.id === 'opAdm')?.shape).toBe('person');

        // The 4-arg form: technology should be on its own field, description preserved
        const api = ir.nodes.find(n => n.id === 'api');
        expect(api?.label).toBe('API EMA');
        expect(api?.description).toBe('Servicios REST');

        // Edges should all be parsed; the technology hint is appended to the
        // edge label so the canvas tells the story without forcing the reader
        // to open each connection.
        expect(ir.edges.length).toBe(4);
        const restEdge = ir.edges.find(e => e.source === 'webApp' && e.target === 'api');
        expect(restEdge?.label).toBe('Llama API · HTTPS/JSON');

        // Technology hint is preserved so the renderer can show a tech badge.
        expect(api?.technology).toBe('Java, Spring Boot 3.2');

        // Group should contain the children but not the boundary id itself
        expect(ir.groups.length).toBe(1);
        const group = ir.groups[0];
        expect(group.label).toBe('Sistema EMA');
        expect(group.nodeIds.sort()).toEqual(['api', 'db', 'webApp']);
    });

    it('survives stray ```mermaid fence around C4Container body', () => {
        const fenced = '```mermaid\nC4Container\nPerson(u, "User", "")\nContainer(api, "API", "Node", "Backend")\nRel(u, api, "Uses", "HTTPS")\n```';
        const code = extractMermaidCode(fenced, 'diagram');
        expect(code).not.toBeNull();
        const ir = mermaidToIR(code!);
        expect(ir.nodes.map(n => n.id).sort()).toEqual(['api', 'u']);
        expect(ir.edges.length).toBe(1);
    });

    it('extractIRFromArtifact recovers a C4Container artifact stored as raw mermaid', () => {
        const ir = extractIRFromArtifact({
            content: 'C4Container\nPerson(u, "User", "")\nContainer(api, "API", "Java", "Backend")\nRel(u, api, "Uses", "HTTPS")',
            representation: 'diagram',
            type: 'mermaid-c4-container',
        });
        expect(ir).not.toBeNull();
        expect(ir!.nodes.length).toBe(2);
    });

    it('parses C4Container even when wrapped in mermaid fence (representation diagram drift)', () => {
        const ir = extractIRFromArtifact({
            content: '```mermaid\nC4Container\nPerson(u, "User", "")\nContainer(api, "API", "Java", "Backend")\nRel(u, api, "Uses", "HTTPS")\n```',
            representation: 'diagram',
            type: 'mermaid-c4-container',
        });
        expect(ir).not.toBeNull();
        expect(ir!.nodes.length).toBe(2);
    });

    it('accepts semicolon-terminated C4 declarations and relations', () => {
        const code = `C4Context
Person(user, "Usuario", "");
System(main, "Plataforma", "Core");
Rel(user, main, "Usa", "HTTPS");`;

        const ir = mermaidToIR(code);

        expect(ir.nodes.map(n => n.id).sort()).toEqual(['main', 'user']);
        expect(ir.edges).toHaveLength(1);
        expect(ir.edges[0].label).toBe('Usa · HTTPS');
    });

    it('parses boundaries declared with single-quoted labels', () => {
        const code = `C4Container
System_Boundary(core, 'Core Domain') {
  Container(api, "API", "Node.js", "Backend")
  ContainerDb(db, "DB", "PostgreSQL", "Storage")
}
Rel(api, db, "Reads", "TCP")`;

        const ir = mermaidToIR(code);
        expect(ir.nodes.map(n => n.id).sort()).toEqual(['api', 'db']);
        expect(ir.groups).toHaveLength(1);
        expect(ir.groups[0].label).toBe('Core Domain');
        expect(ir.groups[0].nodeIds.sort()).toEqual(['api', 'db']);
    });

    it('parses multiline C4 declarations and relations', () => {
        const code = `C4Context
Person(
  user,
  "Usuario",
  "Cliente final"
)
System(
  main,
  "Plataforma Arky",
  "Sistema principal"
)
Rel(
  user,
  main,
  "Usa",
  "HTTPS"
)`;

        const ir = mermaidToIR(code);
        expect(ir.nodes.map(n => n.id).sort()).toEqual(['main', 'user']);
        expect(ir.nodes.find(n => n.id === 'main')?.description).toBe('Sistema principal');
        expect(ir.edges).toHaveLength(1);
        expect(ir.edges[0].label).toBe('Usa · HTTPS');
    });

    it('parses compact one-line C4 statements separated by semicolons', () => {
        const code = `C4Context
Person(user, "Usuario", "Cliente final"); System(main, "Plataforma Arky", "Sistema principal"); Rel(user, main, "Usa", "HTTPS");`;

        const ir = mermaidToIR(code);
        expect(ir.nodes.map(n => n.id).sort()).toEqual(['main', 'user']);
        expect(ir.edges).toHaveLength(1);
        expect(ir.edges[0].label).toBe('Usa · HTTPS');
    });

    it('parses compact boundaries declared on a single line', () => {
        const code = `C4Container
System_Boundary(core, "Core"){Container(api, "API", "Node.js", "Backend"); ContainerDb(db, "DB", "PostgreSQL", "Storage");} Rel(api, db, "Reads", "TCP");`;

        const ir = mermaidToIR(code);
        expect(ir.nodes.map(n => n.id).sort()).toEqual(['api', 'db']);
        expect(ir.groups).toHaveLength(1);
        expect(ir.groups[0].label).toBe('Core');
        expect(ir.groups[0].nodeIds.sort()).toEqual(['api', 'db']);
        expect(ir.edges).toHaveLength(1);
    });
});
