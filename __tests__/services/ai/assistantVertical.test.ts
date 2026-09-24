/**
 * The assistant is out of the engine (F5-01, cortes 7 y 8), and stays out.
 *
 * Corte 7 moved the four turns that carry no persona — the consulting room,
 * the chat-context note, the consistency check and the multimodal modal.
 * Corte 8 moved the three that speak as an agent, by splitting each where the
 * dependency points: `services/ai` asks the model over an instruction it is
 * handed, `services/agent` composes the agent's turn, and the Office composes
 * the project chat and supplies the persona. These pin that split — nothing
 * in the vertical looks a persona up — and what each turn keeps.
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
import { runAgentTurn, streamAgentTurn } from '../../../services/ai/generation/assistant/agentTurn';
import { generateProjectChatReply } from '../../../services/ai/generation/assistant/projectChat';
import { chatWithProject, composeProjectChatInstruction } from '../../../services/architectureOffice/application/projectConversation';
import { officePersonaForMessage, OFFICE_AGENT_PERSONAS } from '../../../services/architectureOffice/officeAgentPersonas';
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
  const moved = [
    'consultArchitecture', 'analyzeChatForContext', 'runConsistencyCheck', 'processMultimodalChat',
    'chatWithProject', 'processAssistantChat', 'processAssistantChatStream',
  ];

  it('the engine no longer declares any of the seven turns', () => {
    const engine = readCode('services/ai/generation/artifacts/artifactGenerationEngine.ts');
    for (const method of moved) {
      expect(engine, method).not.toMatch(new RegExp(`\\b${method}\\s*\\(`));
    }
  });

  it('the vertical reaches neither the engine nor the contexts that import this layer back', () => {
    for (const file of ['assistantPorts', 'architectureConsultation', 'conversationAnalysis', 'multimodalChat', 'agentTurn', 'projectChat', 'index']) {
      const code = readCode(`services/ai/generation/assistant/${file}.ts`);
      expect(code, file).not.toMatch(/(?:geminiService|artifactGenerationEngine)['"]/);
      expect(code, file).not.toMatch(/services\/(chat|agent|architectureOffice)|\.\.\/\.\.\/\.\.\/(chat|agent|architectureOffice)/);
    }
  });

  it('the façade no longer imports the engine at all', () => {
    expect(readCode('services/ai/generation/assistantService.ts')).not.toMatch(/geminiService|artifactGenerationEngine/);
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

describe('the turns that speak as an agent', () => {
  it('runs an agent turn over the instruction it is handed, and reads back modifyArtifact', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({
      text: 'Hecho',
      functionCalls: [{ name: 'modifyArtifact', args: { newContent: '# nuevo', target: 'current' } }],
    });

    const result = await runAgentTurn({
      systemInstruction: 'INSTRUCCION-COMPUESTA',
      history: [{ role: 'user', parts: [{ text: 'antes' }] }],
      question: 'cámbialo',
      settings,
      offerArtifactTool: true,
    });

    expect(result).toEqual({ text: 'Hecho', functionCall: { name: 'modifyArtifact', args: { newContent: '# nuevo', target: 'current' } } });
    const [, , contents, config, options] = spy.mock.calls[0] as unknown as [unknown, unknown, Array<{ role: string }>, { systemInstruction: string; tools?: unknown[]; temperature: number }, unknown];
    expect(contents.map((turn) => turn.role)).toEqual(['user', 'user']);
    expect(config.systemInstruction).toBe('INSTRUCCION-COMPUESTA');
    expect(config.tools).toHaveLength(1);
    expect(config.temperature).toBe(0.6);
    expect(options).toEqual({ maxRetries: 1 });
  });

  it('offers no tool when no artifact is open', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: 'ok' });
    await expect(runAgentTurn({ systemInstruction: 'x', history: [], question: 'q', settings, offerArtifactTool: false }))
      .resolves.toEqual({ text: 'ok' });
    expect((spy.mock.calls[0][3] as { tools?: unknown }).tools).toBeUndefined();
  });

  it('streams deltas, keeps the first tool call, and rewraps a mid-stream failure', async () => {
    async function* chunks() {
      yield { text: 'Ho' };
      yield { text: 'la', functionCalls: [{ name: 'modifyArtifact', args: { newContent: 'a' } }] };
      yield { functionCalls: [{ name: 'otro', args: {} }] };
    }
    vi.spyOn(aiGateway, 'generateContentStream').mockResolvedValueOnce(chunks());
    const deltas: string[] = [];

    const result = await streamAgentTurn(
      { systemInstruction: 'x', history: [], question: 'q', settings, offerArtifactTool: true },
      (full) => deltas.push(full),
    );
    expect(deltas).toEqual(['Ho', 'Hola']);
    expect(result).toEqual({ text: 'Hola', functionCall: { name: 'modifyArtifact', args: { newContent: 'a' } } });

    async function* broken() {
      yield { text: 'a' };
      throw new Error('socket closed');
    }
    vi.spyOn(aiGateway, 'generateContentStream').mockResolvedValueOnce(broken());
    await expect(streamAgentTurn({ systemInstruction: 'x', history: [], question: 'q', settings, offerArtifactTool: false }, () => undefined))
      .rejects.toMatchObject({ userMessage: expect.any(String) });
  });

  it('keeps the project chat history inside the prompt and honours the tier', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: 'respuesta' });

    await generateProjectChatReply({
      systemInstruction: 'MARCO',
      message: '¿y el impacto?',
      history: [{ role: 'user', parts: [{ text: 'hola' }] }, { role: 'model', parts: [{ text: 'buenas' }] }],
      settings,
    });

    const [, , prompt, config] = spy.mock.calls[0] as unknown as [unknown, unknown, string, { systemInstruction: string }];
    expect(prompt).toBe('Previous Conversation:\nUser: hola\n\nArchitect: buenas\n\nUser: ¿y el impacto?');
    expect(config.systemInstruction).toBe('MARCO');
  });
});

describe('the Office decides who answers', () => {
  it('frames the project chat with the named persona and the Office standards', () => {
    const sofia = Object.values(OFFICE_AGENT_PERSONAS).find((persona) => persona.id !== 'arky');
    expect(sofia).toBeDefined();
    const instruction = composeProjectChatInstruction(project, `@${sofia!.alias} revisa esto`, settings);
    expect(instruction).toContain('Chief Software Architect');
    expect(instruction).toContain('ARCHITECTURE OFFICE STANDARDS:');
    expect(instruction).toContain(sofia!.alias);
  });

  it('binds the persona explicitly over any mention in the message', () => {
    const [first, second] = Object.values(OFFICE_AGENT_PERSONAS).filter((persona) => persona.id !== 'arky');
    const instruction = composeProjectChatInstruction(project, `@${first.alias} dice algo`, settings, second.id);
    expect(instruction).toContain(second.alias);
  });

  it('sends the framed instruction through the vertical', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: 'ok' });
    await expect(chatWithProject(project, 'hola', [], settings, undefined, 'default')).resolves.toBe('ok');
    expect((spy.mock.calls[0][3] as { systemInstruction: string }).systemInstruction).toContain('ARCHITECTURE OFFICE STANDARDS:');
  });

  it('hands the agent a briefing for whoever the message names, Arky by default', () => {
    const briefing = officePersonaForMessage('sin mención');
    expect(briefing.composeInstruction('BASE')).toContain('BASE');
    expect(briefing.sections.length).toBeGreaterThan(0);
  });
});
