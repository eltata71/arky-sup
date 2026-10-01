import { describe, expect, it } from 'vitest';
import type { Artifact, ContextManifestRecord } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';
import type { Settings } from '../../types';
import { buildCorrectiveDiagramPrompt, buildIRDirectGenerationPrompt } from '../../services/ai/prompts/diagramPrompts';

const artifact: Artifact = {
    id: 'a', revision: 4, versionGroupId: 'a', version: 1, createdAt: '', name: 'C4',
    type: 'mermaid-c4-container', phase: 'Diseño', architecturalView: 'Vista Lógica y de Diseño',
    content: '', objective: 'Descomponer API', representation: 'diagram',
    keyConcepts: [{ term: 'API', definition: 'HTTP' }],
};
const project: Project = {
    id: 'p', revision: 9, name: 'Proyecto', description: 'Descripción '.repeat(100),
    projectContext: Array.from({ length: 10 }, (_, i) => `Servicio API número ${i}`),
    artifacts: [], createdAt: '', updatedAt: '',
};
const settings = { revision: 3, language: 'es' } as Settings;

describe('procedencia del contexto de diagramas', () => {
    it('registra el bundle, brief y revisiones sin alterar el prompt inicial', () => {
        const records: ContextManifestRecord[] = [];
        const options = { artifact, project, settings, audience: 'technical' as const, brief: 'Persona, iniciativa y grafo reales' };
        const original = buildIRDirectGenerationPrompt(options);
        expect(buildIRDirectGenerationPrompt({ ...options, onContextCaptured: (r) => records.push(r) })).toBe(original);
        expect(records.some((r) => r.sections.some((s) => s.scope === 'brief' && s.items[0].text === options.brief))).toBe(true);
        expect(records.flatMap((r) => r.sources)).toContainEqual({ id: 'p', label: 'Proyecto', revision: 9 });
        expect(records.flatMap((r) => r.sources)).toContainEqual({ id: 'settings', label: 'Estándares y preferencias', revision: 3 });
    });

    it('registra el correctivo realmente reducido, sin adjudicarle los ámbitos del inicial', () => {
        const records: ContextManifestRecord[] = [];
        const options = { artifact, project, audience: 'technical' as const, lastFailureReason: 'empty-ir' };
        const original = buildCorrectiveDiagramPrompt(options);
        expect(buildCorrectiveDiagramPrompt({ ...options, onContextCaptured: (r) => records.push(r) })).toBe(original);
        expect(records.every((r) => r.profile === 'diagram-corrective')).toBe(true);
        const context = records.find((r) => r.label === 'Proyecto del diagrama correctivo')!;
        expect(context.sections[0].items[0].truncated).toBe(true);
        expect(context.sections[0].items[0].text.match(/•/g)).toHaveLength(6);
        expect(context.omitted).toContainEqual({ scope: 'glosario', count: 1, reason: 'Límite de conceptos del intento' });
        expect(records.flatMap((r) => r.sources).some((s) => s.id === 'settings')).toBe(false);
    });
});
