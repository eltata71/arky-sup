/**
 * Regression coverage for the C4 generation/rendering stability fixes.
 *
 *  - audienceProjector keeps ContainerDb / ContainerQueue / SystemDb /
 *    ComponentDb / ComponentQueue nodes even when they are isolated, so the
 *    technical view never silently empties on a real C4 Container/Component
 *    diagram (the most common "blank canvas" failure mode in production).
 *
 *  - mermaidToIR.detectHeader extracts the bare `title <text>` directive used
 *    by C4 / Gantt / Journey dialects, so the diagram metadata round-trips
 *    correctly and the parser does not stumble on the title line.
 *
 *  - buildDeterministicDiagramSkeleton always produces parseable C4 Mermaid
 *    so the canvas has something to render when every Gemini attempt fails.
 */
import { describe, it, expect } from 'vitest';
import { projectIR } from '../../services/diagram/audienceProjector';
import { mermaidToIR } from '../../services/diagram/mermaidToIR';
import { buildDeterministicDiagramSkeleton } from '../../services/artifacts/deterministicArtifactFallbacks';
import type { ArtifactTemplate, Project } from '../../types';
import type { DiagramIR } from '../../lib/diagram';

const project: Project = {
    id: 'p1',
    name: 'PBM Pharmacy Module',
    description: 'Implementación del módulo de Administración de Beneficios de Farmacia',
    projectContext: [],
    artifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

const template = (type: ArtifactTemplate['type'], name: string): ArtifactTemplate => ({
    name,
    type,
    phase: 'Fase 1: Estratégica y de Visión de Negocio',
    architecturalView: 'Vista de Contexto y Negocio',
    objective: 'Recorrido del usuario hasta el sistema',
    keyConcepts: [],
    representation: 'diagram',
});

describe('C4 audience projection — Db/Queue variants survive technical view', () => {
    it('keeps an isolated ContainerDb node alive in technical projection', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'db', label: 'Postgres', kind: 'ContainerDb' },
                { id: 'web', label: 'Web', kind: 'Container' },
            ],
            edges: [
                { id: 'e1', source: 'web', target: 'db', label: 'SQL' },
            ],
            groups: [],
        };
        const projected = projectIR(ir, 'technical');
        expect(projected.nodes.find(n => n.id === 'db')).toBeDefined();
        expect(projected.nodes.find(n => n.id === 'web')).toBeDefined();
    });

    it('keeps a fully disconnected SystemDb / ContainerQueue in technical view', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'p', label: 'Person', kind: 'Person' },
                { id: 'sys', label: 'System', kind: 'System' },
                { id: 'queue', label: 'Events', kind: 'ContainerQueue' },
                { id: 'sysdb', label: 'Legacy DB', kind: 'SystemDb' },
            ],
            edges: [{ id: 'e1', source: 'p', target: 'sys', label: 'Usa' }],
            groups: [],
        };
        const projected = projectIR(ir, 'technical');
        const ids = projected.nodes.map(n => n.id);
        expect(ids).toContain('queue');
        expect(ids).toContain('sysdb');
    });
});

describe('mermaidToIR — C4 title directive', () => {
    it('extracts the bare "title <text>" directive emitted by Mermaid C4', () => {
        const code = `C4Context
    title System Context — PBM
    Person(u, "Usuario", "Cliente final")
    System(s, "PBM", "Módulo")
    Rel(u, s, "Usa", "HTTPS")`;
        const ir = mermaidToIR(code);
        expect(ir.metadata?.title).toBe('System Context — PBM');
        expect(ir.nodes.length).toBe(2);
        expect(ir.edges.length).toBe(1);
    });

    it('still parses a C4 diagram that omits the title line', () => {
        const code = `C4Context
    Person(u, "Usuario", "Cliente final")
    System(s, "PBM", "Módulo")
    Rel(u, s, "Usa", "HTTPS")`;
        const ir = mermaidToIR(code);
        expect(ir.nodes.length).toBe(2);
        expect(ir.edges.length).toBe(1);
    });
});

describe('buildDeterministicDiagramSkeleton — last-resort C4 fallback', () => {
    it('emits a parseable C4 Context skeleton with at least 2 nodes and 1 edge', () => {
        const skeleton = buildDeterministicDiagramSkeleton(
            project,
            template('mermaid-c4-context', 'Context'),
        );
        const ir = mermaidToIR(skeleton);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(2);
        expect(ir.edges.length).toBeGreaterThanOrEqual(1);
        expect(skeleton).toMatch(/^C4Context/);
    });

    it('emits a parseable C4 Container skeleton', () => {
        const skeleton = buildDeterministicDiagramSkeleton(
            project,
            template('mermaid-c4-container', 'Container'),
        );
        const ir = mermaidToIR(skeleton);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(2);
        expect(ir.edges.length).toBeGreaterThanOrEqual(1);
        expect(skeleton).toMatch(/^C4Container/);
    });

    it('emits a parseable C4 Component skeleton', () => {
        const skeleton = buildDeterministicDiagramSkeleton(
            project,
            template('mermaid-c4-component', 'Component'),
        );
        const ir = mermaidToIR(skeleton);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(2);
        expect(ir.edges.length).toBeGreaterThanOrEqual(1);
        expect(skeleton).toMatch(/^C4Component/);
    });

    it('emits a parseable C4 Deployment skeleton', () => {
        const skeleton = buildDeterministicDiagramSkeleton(
            project,
            template('mermaid-c4-deployment', 'Deployment'),
        );
        const ir = mermaidToIR(skeleton);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(2);
        expect(ir.edges.length).toBeGreaterThanOrEqual(1);
        expect(skeleton).toMatch(/^C4Deployment/);
    });

    it('falls back to a flowchart for non-C4 diagram types', () => {
        const skeleton = buildDeterministicDiagramSkeleton(
            project,
            template('mermaid-graph', 'Flow'),
        );
        const ir = mermaidToIR(skeleton);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(2);
        expect(ir.edges.length).toBeGreaterThanOrEqual(1);
    });

    it('sanitises malicious project names before embedding them in Mermaid', () => {
        const tainted: Project = {
            ...project,
            name: 'PBM "DROP TABLE" `whoami`',
        };
        const skeleton = buildDeterministicDiagramSkeleton(
            tainted,
            template('mermaid-c4-context', 'Context'),
        );
        // Quotes and backticks must not survive — otherwise they'd break the
        // Mermaid C4 declaration parser by escaping the surrounding string.
        expect(skeleton).not.toMatch(/`/);
        expect(skeleton).not.toMatch(/PBM "DROP/);
        const ir = mermaidToIR(skeleton);
        expect(ir.nodes.length).toBeGreaterThanOrEqual(2);
    });
});
