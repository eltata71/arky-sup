import { describe, it, expect } from 'vitest';
import { buildCorrectiveDiagramPrompt } from '../../services/ai/prompts/diagramPrompts';
import type { Artifact, Project } from '../../types';

function makeProject(): Project {
    return {
        id: 'p1',
        name: 'Plataforma de Reclamaciones',
        description: 'Plataforma para reclamaciones médicas.',
        projectContext: Array.from({ length: 30 }, (_, i) => `Restricción ${i}`),
        artifacts: [],
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
    };
}

function makeArtifact(): Artifact {
    return {
        id: 'a1',
        versionGroupId: 'a1',
        version: 1,
        createdAt: '2026-05-01T00:00:00Z',
        name: 'Diagrama de Contenedores',
        type: 'mermaid-c4-container',
        phase: 'Diseño',
        architecturalView: 'Vista Lógica y de Diseño',
        content: '',
        objective: 'Modelar contenedores principales.',
        keyConcepts: [
            { term: 'API', definition: 'Servicio HTTP' },
            { term: 'DB', definition: 'Base de datos' },
        ],
        representation: 'diagram',
    };
}

describe('buildCorrectiveDiagramPrompt', () => {
    it('caps the project context to 6 bullets in corrective mode', () => {
        const prompt = buildCorrectiveDiagramPrompt({
            artifact: makeArtifact(),
            project: makeProject(),
            audience: 'technical',
            lastFailureReason: 'empty-ir',
        });
        const ctxStart = prompt.indexOf('Constraints / context:');
        const ctxBlock = prompt.slice(ctxStart);
        const bullets = ctxBlock.split('\n').filter((l) => l.trim().startsWith('•'));
        expect(bullets.length).toBeLessThanOrEqual(6);
    });

    it('includes the explicit corrective banner referencing the last failure reason', () => {
        const prompt = buildCorrectiveDiagramPrompt({
            artifact: makeArtifact(),
            project: makeProject(),
            audience: 'technical',
            lastFailureReason: 'no-mermaid',
        });
        expect(prompt).toContain('CORRECTIVE RETRY');
        expect(prompt).toContain('no-mermaid');
        expect(prompt).toMatch(/at least 4 nodes/i);
    });

    it('drops the glossary block (maxKeyConcepts = 0)', () => {
        const prompt = buildCorrectiveDiagramPrompt({
            artifact: makeArtifact(),
            project: makeProject(),
            audience: 'technical',
            lastFailureReason: 'empty-ir',
        });
        expect(prompt).not.toMatch(/Ubiquitous language/i);
    });
});
