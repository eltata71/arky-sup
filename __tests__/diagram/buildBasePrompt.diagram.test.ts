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
    it('caps projectContext to 12 bullets and prioritises tech/regulation keywords', () => {
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

        // Count "- " bullets in the output (project context list).
        const bulletLines = prompt.split('\n').filter((l) => l.startsWith('- '));
        // The header "Project Description: ..." also starts with "- "? No, it starts with "Project". Only context items begin with "- ".
        // But the global prompt also has "- " for global context items. So count items in the project-specific section.
        const ctxStart = prompt.indexOf('Project-Specific Context');
        const ctxBlock = prompt.slice(ctxStart);
        const bulletsInCtx = ctxBlock.split('\n').filter((l) => l.startsWith('- '));
        expect(bulletsInCtx.length).toBeLessThanOrEqual(12);

        // All five tech/regulation signals must be retained because they boost on keyword.
        for (const signal of signals) {
            expect(prompt).toContain(signal);
        }
        // The "Si gracias" noise lines must be deprioritised (length sanity penalty).
        const sigracias = prompt.match(/Si gracias/g) ?? [];
        expect(sigracias.length).toBeLessThanOrEqual(3);
    });

    it('truncates description over 600 chars with ellipsis', () => {
        const longDesc = 'a'.repeat(800);
        const project = makeProject({ description: longDesc });
        const prompt = buildBasePrompt(project, baseSettings, { mode: 'diagram' });
        expect(prompt).toContain('a'.repeat(600));
        expect(prompt).toContain('…');
        expect(prompt).not.toContain('a'.repeat(601));
    });

    it('document mode preserves full context (no cap)', () => {
        const projectContext = Array.from({ length: 30 }, (_, i) => `Item número ${i}`);
        const project = makeProject({ projectContext });
        const prompt = buildBasePrompt(project, baseSettings); // default = document
        for (let i = 0; i < 30; i++) {
            expect(prompt).toContain(`Item número ${i}`);
        }
    });
});
