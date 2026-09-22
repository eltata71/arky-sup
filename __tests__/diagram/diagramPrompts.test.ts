import { describe, it, expect } from 'vitest';
import {
    buildAutoFixPrompt,
    buildCanonicalGenerationPrompt,
    buildCanonicalReviewPrompt,
    buildExecutiveNarrativePrompt,
} from '../../services/ai/prompts/diagramPrompts';
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';

const project: Project = {
    id: 'p1',
    name: 'Arky Platform',
    description: 'Plataforma SaaS para arquitectos de software.',
    artifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
} as unknown as Project;

const artifact: Artifact = {
    id: 'a1',
    name: 'Contexto C4',
    type: 'C4 Context',
    objective: 'Explicar el contexto general.',
    content: '',
    representation: 'diagram',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
} as unknown as Artifact;

const settings: Settings = {} as unknown as Settings;

describe('diagramPrompts', () => {
    it('canonical generation prompt embeds audience, rubric and IR schema', () => {
        const prompt = buildCanonicalGenerationPrompt({ artifact, project, audience: 'executive', settings });
        expect(prompt).toContain('EXECUTIVE');
        expect(prompt).toContain('claridadSemantica');
        expect(prompt).toContain('"nodes"');
        expect(prompt).toContain('{"error":');
    });

    it('review prompt carries the IR JSON verbatim', () => {
        const ir = { nodes: [{ id: 'x', label: 'x', kind: 'Service' }], edges: [], groups: [] };
        const prompt = buildCanonicalReviewPrompt({ ir, audience: 'technical' });
        expect(prompt).toContain('"id": "x"');
        expect(prompt).toContain('technical');
        expect(prompt).toContain('"fixes"');
    });

    it('executive narrative asks for callouts and a short narrative', () => {
        const prompt = buildExecutiveNarrativePrompt({ projectDescription: 'Plataforma', ir: { nodes: [] } });
        expect(prompt).toContain('comité ejecutivo');
        expect(prompt).toContain('callouts');
    });

    it('auto-fix prompt includes the failing mermaid and the error message', () => {
        const prompt = buildAutoFixPrompt({ mermaid: 'flowchart LR\n A --> B', error: 'unexpected token' });
        expect(prompt).toContain('unexpected token');
        expect(prompt).toContain('flowchart LR');
    });
});
