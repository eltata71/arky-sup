/**
 * The persona reaches artifact generation through a port (F5-01, corte 13).
 *
 * The engine used to look the Office persona up itself, which made it import
 * `services/architectureOffice` — a context that imports the AI layer back.
 * Now generation declares `ArtifactPersonaComposer` and every caller hands one
 * in. What must not change is the prompt: the Office's composer and the one
 * the agent derives from its briefing produce the same instruction the engine
 * used to build.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { artifactGenerationEngine } from '../../../services/ai/generation/artifacts/artifactGenerationEngine';
import { artifactGenerationSupport } from '../../../services/artifacts/artifactGenerationSupport';
import {
  buildOfficePersonaInstruction,
  composeArtifactPersonaInstruction,
  officePersonaForMessage,
  resolveOfficeAgentMention,
} from '../../../services/architectureOffice';
import { personaComposer } from '../../../services/agent/agentPersonaComposer';
import type { ArtifactTemplate, Settings } from '../../../types';
import type { Project } from '../../../services/architectureProjects';

const project = {
  id: 'p1',
  name: 'Reclamos médicos',
  description: 'Modernización del core de reclamos.',
  projectContext: [],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as Project;
const settings = {
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.7, apiKeySource: 'user' },
} as unknown as Settings;
const template = {
  name: 'Documento de decisiones',
  type: 'markdown',
  phase: 'Fase 1',
  architecturalView: 'Vista Lógica y de Diseño',
  objective: 'Sofía, documenta las decisiones del core.',
  keyConcepts: [],
  representation: 'document',
} as unknown as ArtifactTemplate;

type TextPath = { generateTextWithFallback: (...args: unknown[]) => Promise<string> };

/** Every prompt the engine sends, whatever path it takes. */
const capturePrompts = (): string[] => {
  const prompts: string[] = [];
  const answer = '# Decisiones\n\n## Contexto\nContenido del documento con detalle suficiente.';
  vi.spyOn(artifactGenerationEngine as unknown as TextPath, 'generateTextWithFallback').mockImplementation(async (...args) => {
    prompts.push(String(args[2]));
    return answer;
  });
  return prompts;
};

afterEach(() => vi.restoreAllMocks());

describe('the persona reaches generation through a port (F5-01 corte 13)', () => {
  it('the engine no longer imports the Office', () => {
    const engine = readFileSync('services/ai/generation/artifacts/artifactGenerationEngine.ts', 'utf8');
    expect(engine).not.toMatch(/from ['"](?:\.\.\/)+architectureOffice/);
  });

  it('the Office composer is the instruction the engine used to build', () => {
    const request = 'Sofía, revisa la integración con el broker.';
    expect(composeArtifactPersonaInstruction('BASE', request))
      .toBe(buildOfficePersonaInstruction('BASE', resolveOfficeAgentMention(request)));
  });

  it("the agent's composer, derived from its briefing, says the same", () => {
    const composer = personaComposer(officePersonaForMessage);
    for (const request of ['Sofía, revisa la integración.', 'Genera el documento de decisiones.']) {
      expect(composer?.('BASE', request)).toBe(composeArtifactPersonaInstruction('BASE', request));
    }
    expect(personaComposer(undefined)).toBeUndefined();
  });

  it('generation composes the persona it is handed over the base instruction', async () => {
    const prompts = capturePrompts();
    const composer = vi.fn((base: string, request: string) => `${base}\n[PERSONA para: ${request}]`);

    await artifactGenerationEngine.generateArtifactContent(project, template, settings, undefined, {
      architectureGraphPromptBlock: '',
      support: artifactGenerationSupport,
      composePersonaInstruction: composer,
    });

    expect(composer).toHaveBeenCalledWith(expect.any(String), template.objective);
    expect(prompts.some((prompt) => prompt.includes('[PERSONA para: Sofía, documenta'))).toBe(true);
  });

  it('without a composer the base instruction goes as it is', async () => {
    const prompts = capturePrompts();

    await artifactGenerationEngine.generateArtifactContent(project, template, settings, undefined, {
      architectureGraphPromptBlock: '',
      support: artifactGenerationSupport,
    });

    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((prompt) => prompt.includes('Persona especializada activa'))).toBe(false);
  });
});
