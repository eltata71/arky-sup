import { describe, it, expect } from 'vitest';
import { buildSkeletonIRFromArtifact } from '../../services/ai/prompts/diagramPrompts';
import { analyzeDiagramQuality } from '../../services/diagram/quality/diagramQualityService';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';

function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 'p1',
        name: 'Sistema de Reclamaciones',
        description: '',
        projectContext: [],
        artifacts: [],
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
        ...overrides,
    };
}

function makeArtifact(type: Artifact['type'], keyConcepts: { term: string; definition: string }[] = []): Artifact {
    return {
        id: 'a1',
        versionGroupId: 'a1',
        version: 1,
        createdAt: '2026-05-01T00:00:00Z',
        name: 'Test Artifact',
        type,
        phase: 'Diseño',
        architecturalView: 'Vista de Contexto y Negocio',
        content: '',
        objective: 'Objetivo de prueba.',
        keyConcepts,
        representation: 'diagram',
    };
}

describe('buildSkeletonIRFromArtifact', () => {
    it('produces a non-empty C4 Context skeleton', () => {
        const ir = buildSkeletonIRFromArtifact(makeArtifact('mermaid-c4-context', [
            { term: 'Sistema de Reclamaciones', definition: 'core' },
            { term: 'Sistema HIS', definition: 'externo' },
        ]), makeProject());
        expect(ir.nodes.length).toBeGreaterThanOrEqual(3);
        expect(ir.metadata?.fallback).toBe('skeleton');
        expect(ir.nodes.some((n) => n.kind === 'Person')).toBe(true);
        expect(ir.nodes.some((n) => n.kind === 'System')).toBe(true);
    });

    it('produces a non-empty C4 Container skeleton', () => {
        const ir = buildSkeletonIRFromArtifact(makeArtifact('mermaid-c4-container'), makeProject({ name: 'Plataforma' }));
        expect(ir.nodes.length).toBeGreaterThanOrEqual(3);
        expect(ir.edges.length).toBeGreaterThanOrEqual(1);
    });

    it('produces a non-empty C4 Component skeleton', () => {
        const ir = buildSkeletonIRFromArtifact(makeArtifact('mermaid-c4-component'), makeProject());
        expect(ir.nodes.length).toBeGreaterThanOrEqual(3);
        expect(ir.nodes.every((n) => n.kind === 'Component')).toBe(true);
    });

    it('produces a non-empty deployment skeleton', () => {
        const ir = buildSkeletonIRFromArtifact(makeArtifact('mermaid-c4-deployment'), makeProject());
        expect(ir.nodes.length).toBeGreaterThanOrEqual(2);
    });
});

describe('analyzeDiagramQuality — empty IR and skeleton fallback', () => {
    it('reports score=0 with an empty-ir issue when nodes are zero', () => {
        const report = analyzeDiagramQuality({ nodes: [], edges: [], groups: [] });
        expect(report.score).toBe(0);
        expect(report.issues.some((i) => i.code === 'EMPTY_IR')).toBe(true);
    });

    it('caps score at 40 and emits a skeleton-fallback issue when metadata.fallback === skeleton', () => {
        const ir = buildSkeletonIRFromArtifact(makeArtifact('mermaid-c4-context', [
            { term: 'Sistema A', definition: '' },
        ]), makeProject());
        const report = analyzeDiagramQuality(ir);
        expect(report.score).toBeLessThanOrEqual(40);
        expect(report.issues.some((i) => i.code === 'SKELETON_FALLBACK')).toBe(true);
    });
});
