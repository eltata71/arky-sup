import { describe, it, expect } from 'vitest';
import { buildBasePrompt } from '../../services/ai/prompts/projectPrompts';
import type { Settings } from '../../types';
import type { Project } from '../../services/architectureProjects';

const baseSettings: Settings = {
    globalContext: ['SLA estricto', 'On-Prem first'],
    language: 'es',
    theme: 'light',
    aiConfig: {
        model: 'gemini-2.5-pro',
        temperature: 0.7,
        tone: 'Profesional y Técnico',
        languageStyle: 'es',
        apiKeySource: 'global',
    },
};

function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 'p1',
        name: 'Plataforma de Reclamaciones',
        description: 'Plataforma para gestionar reclamaciones médicas en aseguradoras de salud y vida.',
        projectContext: [],
        artifacts: [],
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
        ...overrides,
    };
}

describe('buildBasePrompt — diagram mode', () => {
    it('caps projectContext to 12 bullets, prioritises tech/regulation keywords and drops conversational echoes', () => {
        const noisy = Array.from({ length: 30 }, (_, i) => i % 4 === 0 ? `Si gracias` : `Línea genérica de chat ${i}`);
        const signals = [
            'Tecnología principal: Kafka y PostgreSQL',
            'Cumplimiento HIPAA y GDPR obligatorios',
            'Despliegue on-prem con Kubernetes',
            'Integra con sistemas legacy SOAP/JDBC',
            'SaaS multi-tenant con SLA 99.95%',
        ];
        const projectContext = [...noisy, ...signals];
        const project = makeProject({ projectContext });

        const prompt = buildBasePrompt(project, baseSettings, { mode: 'diagram' });

        // The project's own notes are the bundle section «Contexto del Proyecto»
        // (7.2b), which ends at the first blank line.
        const ctxStart = prompt.indexOf('Contexto del Proyecto');
        expect(ctxStart).toBeGreaterThanOrEqual(0);
        const ctxBlock = prompt.slice(ctxStart, prompt.indexOf('\n\n', ctxStart));
        const bulletsInCtx = ctxBlock.split('\n').filter((l) => l.startsWith('- '));
        expect(bulletsInCtx.length).toBeLessThanOrEqual(12);

        // All five tech/regulation signals must be retained because they boost on keyword.
        for (const signal of signals) {
            expect(prompt).toContain(signal);
        }
        // «Si gracias» is the guided creation acknowledging a turn, not context.
        expect(prompt).not.toContain('Si gracias');
    });

    it('truncates description over 600 chars with ellipsis', () => {
        const longDesc = 'a'.repeat(800);
        const project = makeProject({ description: longDesc });
        const prompt = buildBasePrompt(project, baseSettings, { mode: 'diagram' });
        expect(prompt).toContain('a'.repeat(600));
        expect(prompt).toContain('…');
        expect(prompt).not.toContain('a'.repeat(601));
    });

    it('document mode keeps every note up to its profile limit', () => {
        const projectContext = Array.from({ length: 30 }, (_, i) => `Item número ${i}`);
        const project = makeProject({ projectContext });
        const prompt = buildBasePrompt(project, baseSettings); // default = document
        for (let i = 0; i < 30; i++) {
            expect(prompt).toContain(`Item número ${i}`);
        }
    });
});
