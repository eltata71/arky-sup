import { describe, it, expect } from 'vitest';
import {
    buildDiagramIRSchema,
    buildDialectInstruction,
    buildIRDirectGenerationPrompt,
    DIAGRAM_SYSTEM_INSTRUCTION,
} from '../../services/ai/prompts/diagramPrompts';
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';

describe('DIAGRAM_SYSTEM_INSTRUCTION', () => {
    it('declares the canonical 9 semantic roles', () => {
        ['person', 'system', 'gateway', 'data', 'messaging', 'external', 'service', 'process', 'generic']
            .forEach(role => expect(DIAGRAM_SYSTEM_INSTRUCTION).toContain(role));
    });

    it('encodes audience sizing rules so prompts can stay terse', () => {
        expect(DIAGRAM_SYSTEM_INSTRUCTION).toMatch(/executive/i);
        expect(DIAGRAM_SYSTEM_INSTRUCTION).toMatch(/technical/i);
        expect(DIAGRAM_SYSTEM_INSTRUCTION).toMatch(/operations/i);
    });

    it('lists the 10-dimension rubric verbatim so call sites can rely on it', () => {
        ['claridadSemantica', 'narrativa', 'preparacionEjecutiva', 'mantenibilidadPipeline']
            .forEach(d => expect(DIAGRAM_SYSTEM_INSTRUCTION).toContain(d));
    });
});

describe('buildDiagramIRSchema', () => {
    it('produces a schema with required nodes/edges arrays and a review block by default', () => {
        const schema = buildDiagramIRSchema() as any;
        expect(schema.type).toBe('object');
        expect(schema.required).toEqual(['nodes', 'edges']);
        expect(schema.properties.nodes.type).toBe('array');
        expect(schema.properties.edges.type).toBe('array');
        expect(schema.properties.review).toBeDefined();
    });

    it('drops the review block when withReview is false', () => {
        const schema = buildDiagramIRSchema({ withReview: false }) as any;
        expect(schema.properties.review).toBeUndefined();
    });

    it('locks node.kind to the canonical role taxonomy', () => {
        const schema = buildDiagramIRSchema() as any;
        const kindEnum = schema.properties.nodes.items.properties.kind.enum;
        expect(kindEnum).toEqual(expect.arrayContaining([
            'person', 'system', 'gateway', 'data', 'messaging', 'external', 'service', 'process', 'generic',
        ]));
    });

    it('locks edge.relation to the renderer vocabulary', () => {
        const schema = buildDiagramIRSchema() as any;
        const relationEnum = schema.properties.edges.items.properties.relation.enum;
        expect(relationEnum).toEqual(expect.arrayContaining([
            'sync', 'async', 'data-flow', 'dependency', 'inheritance', 'default',
        ]));
    });

    it('marks edge.label as required so the model cannot emit blank narratives', () => {
        const schema = buildDiagramIRSchema() as any;
        const required = schema.properties.edges.items.required;
        expect(required).toEqual(expect.arrayContaining(['source', 'target', 'label']));
    });
});

describe('buildDialectInstruction', () => {
    it('returns dialect-specific rules for known artifact types', () => {
        expect(buildDialectInstruction('mermaid-c4-container')).toMatch(/C4/);
        expect(buildDialectInstruction('mermaid-sequence')).toMatch(/sequenceDiagram/);
        expect(buildDialectInstruction('mermaid-erd')).toMatch(/erDiagram/);
        expect(buildDialectInstruction('react-flow-graph')).toMatch(/ReactFlow/);
        expect(buildDialectInstruction('hybrid-text-diagram')).toMatch(/Hybrid/i);
    });

    it('returns empty string for non-diagram types so callers can append unconditionally', () => {
        expect(buildDialectInstruction('markdown')).toBe('');
        expect(buildDialectInstruction('sdd-brd')).toBe('');
    });
});

describe('buildIRDirectGenerationPrompt', () => {
    const project = {
        description: 'Plataforma SaaS para arquitectos.',
    } as Project;
    const artifact = {
        name: 'Contexto C4',
        type: 'mermaid-c4-context',
        objective: 'Mostrar usuarios y sistemas externos.',
    } as Artifact;
    const settings = {} as Settings;

    it('embeds project, artifact, objective and audience in upper-case', () => {
        const prompt = buildIRDirectGenerationPrompt({ artifact, project, audience: 'executive', settings });
        expect(prompt).toContain('Plataforma SaaS');
        expect(prompt).toContain('Contexto C4');
        expect(prompt).toContain('mermaid-c4-context');
        expect(prompt).toContain('EXECUTIVE');
    });

    it('asks for DiagramIR and explicitly forbids Mermaid output', () => {
        const prompt = buildIRDirectGenerationPrompt({ artifact, project, audience: 'technical', settings });
        expect(prompt).toMatch(/DiagramIR/);
        expect(prompt).toMatch(/Do NOT emit Mermaid/i);
    });

    it('includes the previous IR JSON when evolving an existing diagram', () => {
        const previousIR = { nodes: [{ id: 'a', label: 'A', kind: 'service' }], edges: [], groups: [] };
        const prompt = buildIRDirectGenerationPrompt({
            artifact, project, audience: 'technical', settings, previousIR,
        });
        expect(prompt).toMatch(/Previous IR/);
        expect(prompt).toContain('"id": "a"');
    });
});
