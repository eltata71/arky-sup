/**
 * Four assistant turns are out of the engine (F5-01, corte 7), and stay out.
 *
 * The consulting room, the chat-context note, the consistency check and the
 * multimodal modal left `services/geminiService.ts` for
 * `services/ai/generation/assistant/` and reach a model through `aiGateway`.
 * None had a test inside the engine; these pin what each keeps — the
 * persona, the retry budget, the failure that degrades instead of throwing,
 * and where the uploaded files travel. The three persona-bound turns are still
 * the engine's, and the last case says so, so their departure is written down.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiGateway } from '../../../services/ai/generation/aiGateway';
import {
  analyzeChatForContext,
  consultArchitecture,
  processMultimodalChat,
  runConsistencyCheck,
} from '../../../services/ai/generation/assistant';
import { assistantService } from '../../../services/ai/generation/assistantService';
import type { Project } from '../../../services/architectureProjects';
import type { Course } from '../../../types/lms';
import type { Settings } from '../../../types';

const settings = {
  globalContext: ['Cumplir Solvencia II'],
  language: 'es',
  theme: 'dark',
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.6, tone: 'Directo', languageStyle: 'es', apiKeySource: 'global' },
} as unknown as Settings;

const project = {
  id: 'p1',
  name: 'Portal de asegurados',
  description: 'Autogestión de pólizas.',
  projectContext: [],
  artifacts: [
    { id: 'a1', name: 'BRD del portal', type: 'sdd-brd', objective: 'Requisitos', content: '# BRD', representation: 'document' },
  ],
} as unknown as Project;

const readCode = (file: string): string =>
  readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the assistant vertical outside the engine', () => {
  const moved = ['consultArchitecture', 'analyzeChatForContext', 'runConsistencyCheck', 'processMultimodalChat'];

  it('the engine no longer declares any of the four turns', () => {
    const engine = readCode('services/geminiService.ts');
    for (const method of moved) {
      expect(engine, method).not.toMatch(new RegExp(`\\b${method}\\s*\\(`));
    }
  });

  it('the vertical reaches neither the engine nor the contexts that import this layer back', () => {
    for (const file of ['assistantPorts', 'architectureConsultation', 'conversationAnalysis', 'multimodalChat', 'index']) {
      const code = readCode(`services/ai/generation/assistant/${file}.ts`);
      expect(code, file).not.toMatch(/geminiService['"]/);
      expect(code, file).not.toMatch(/services\/(chat|agent|architectureOffice)|\.\.\/\.\.\/\.\.\/(chat|agent|architectureOffice)/);
    }
  });

  it('the façade serves the four from the vertical, and only the persona-bound turns from the engine', () => {
    for (const method of moved) {
      expect(assistantService[method as keyof typeof assistantService], method).toBeTypeOf('function');
    }
    const facade = readCode('services/ai/generation/assistantService.ts');
    expect(facade.match(/geminiService\.\w+/g)?.map((m) => m.split('.')[1]).sort()).toEqual(
      ['chatWithProject', 'processAssistantChat', 'processAssistantChatStream'],
    );
  });
});

describe('assistant turns through the gateway', () => {
  it('consults with the architect-professor persona', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: '## Resumen Ejecutivo' });

    await expect(consultArchitecture('Migrar el core de pólizas', settings)).resolves.toBe('## Resumen Ejecutivo');

    const [, , prompt, config] = spy.mock.calls[0];
    expect(prompt).toContain('Migrar el core de pólizas');
    expect(prompt).toContain('Architect-Professor');
    expect(config).toEqual({ temperature: 0.7 });
  });

  it('returns the context note, null for NO_CONTEXT, and null when the call fails', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValueOnce({ text: ' Se usará Kafka. ' });
    await expect(analyzeChatForContext([], 'Usemos Kafka', 'De acuerdo', settings)).resolves.toBe('Se usará Kafka.');
    expect(spy.mock.calls[0][4]).toEqual({ maxRetries: 1 });

    spy.mockResolvedValueOnce({ text: 'NO_CONTEXT' });
    await expect(analyzeChatForContext([], 'Hola', 'Hola', settings)).resolves.toBeNull();

    spy.mockRejectedValueOnce(new Error('503'));
    await expect(analyzeChatForContext([], 'Hola', 'Hola', settings)).resolves.toBeNull();
  });

  it('parses the consistency suggestions, and degrades to [] on a non-array or a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const suggestion = { id: '1', inconsistency: 'x', suggestion: 'y', isApplied: false, changes: [] };
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValueOnce({ text: `Aquí está:\n${JSON.stringify([suggestion])}` });

    await expect(runConsistencyCheck(project, settings)).resolves.toEqual([suggestion]);
    const [, , prompt, config, options] = spy.mock.calls[0];
    expect(prompt).toContain('BRD del portal');
    expect(config).toMatchObject({ temperature: 0.2, responseMimeType: 'application/json' });
    expect(options).toEqual({ timeoutMs: 300000 });

    spy.mockResolvedValueOnce({ text: '{"id":"1"}' });
    await expect(runConsistencyCheck(project, settings)).resolves.toEqual([]);

    spy.mockRejectedValueOnce(new Error('timeout'));
    await expect(runConsistencyCheck(project, settings)).resolves.toEqual([]);
  });

  it('attaches the uploaded files to the last user turn only', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: 'ok' });
    const file = { name: 'a.pdf', type: 'application/pdf', base64Data: 'QUJD' };

    await processMultimodalChat(
      'analyze-document',
      [
        { role: 'user', content: 'primero' },
        { role: 'model', content: 'respuesta' },
        { role: 'user', content: 'analiza esto' },
      ],
      'analiza esto',
      [file],
      settings,
    );

    const [, , contents, config] = spy.mock.calls[0] as unknown as [unknown, unknown, Array<{ parts: unknown[] }>, { systemInstruction: string }];
    expect(contents.map((turn) => turn.parts.length)).toEqual([1, 1, 2]);
    expect(contents[2].parts[1]).toEqual({ inlineData: { mimeType: 'application/pdf', data: 'QUJD' } });
    expect(config.systemInstruction).toMatch(/^Analyze docs\./);
    expect(config.systemInstruction).toMatch(/Tone: Directo\.$/);
  });

  it('gives the general assistant the projects and the courses as context', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: 'ok' });
    const course = {
      id: 'c1', title: 'Event Storming', description: 'Descubrir el dominio', icon: '📘',
      category: 'Arquitectura', level: 'Intermedio', role: 'solution-architect',
      modules: [{ id: 'm1', title: 'M1', lessons: [{ id: 'l1', title: 'Eventos', description: 'Qué es un evento' }] }],
    } as unknown as Course;

    await processMultimodalChat('review-architecture', [{ role: 'user', content: '¿Qué curso?' }], '¿Qué curso?', [], settings, [project], [course]);

    const instruction = (spy.mock.calls[0][3] as { systemInstruction: string }).systemInstruction;
    expect(instruction).toContain('- Cumplir Solvencia II');
    expect(instruction).toContain('Project: Portal de asegurados');
    expect(instruction).toContain('Course: Event Storming');
    expect(instruction).toContain('- Eventos: Qué es un evento');
  });
});
