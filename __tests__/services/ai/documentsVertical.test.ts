/**
 * The documents vertical is out of the engine (F5-01, corte 5), and stays out.
 *
 * Five methods — diagram to document, smart note, the two SDD documents and
 * memory extraction — left `services/geminiService.ts` for
 * `services/ai/generation/documents/` and reach a model through `aiGateway`.
 * None had a test of its own inside the engine; these pin the contract each
 * one keeps: which model tier, which temperature, and — for memory
 * extraction — what survives from the model's answer.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiGateway } from '../../../services/ai/generation/aiGateway';
import {
  convertDiagramToDocument,
  extractMemoryEntriesFromDocument,
  generateSDDHealthReport,
  generateSDDProcessPlan,
  synthesizeSmartNote,
} from '../../../services/ai/generation/documents';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../../services/architectureProjects';
import type { Settings } from '../../../types';

const settings = {
  globalContext: [],
  language: 'es',
  theme: 'dark',
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.6, tone: 'profesional', languageStyle: 'es', apiKeySource: 'global' },
} as unknown as Settings;

const project = {
  id: 'p1',
  name: 'Portal de asegurados',
  description: 'Autogestión de pólizas.',
  projectContext: [],
  artifacts: [
    { id: 'a1', name: 'BRD del portal', type: 'sdd-brd', content: '# BRD', representation: 'document' },
  ],
} as unknown as Project;

const readCode = (file: string): string =>
  readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the documents vertical outside the engine', () => {
  it('the engine no longer declares any of the five methods', () => {
    const engine = readCode('services/ai/generation/artifacts/artifactGenerationEngine.ts');
    for (const method of ['convertDiagramToDocument', 'synthesizeSmartNote', 'generateSDDProcessPlan', 'generateSDDHealthReport', 'extractMemoryEntriesFromDocument']) {
      expect(engine, method).not.toMatch(new RegExp(`\\b${method}\\s*\\(`));
    }
  });

  it('the façade does not import the engine', () => {
    expect(readCode('services/ai/generation/documentGenerationService.ts')).not.toMatch(/(?:geminiService|artifactGenerationEngine)['"]/);
  });
});

describe('document generation through the gateway', () => {
  it('converts a diagram with the user temperature', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: '# Documento' });
    const artifact = { content: 'flowchart LR\n  a --> b' } as Artifact;

    await expect(convertDiagramToDocument(artifact, project, settings)).resolves.toBe('# Documento');

    const [, , prompt, config] = spy.mock.calls[0];
    expect(prompt).toContain('flowchart LR');
    expect(config).toEqual({ temperature: 0.6 });
  });

  it('synthesises a smart note at a fixed low temperature', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: '- regla' });

    await expect(synthesizeSmartNote('Contenido de la lección', settings)).resolves.toBe('- regla');
    expect(spy.mock.calls[0][3]).toEqual({ temperature: 0.3 });
  });

  it('asks for the SDD plan and health report over the project and its SDD artifacts', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: 'ok' });

    await generateSDDProcessPlan(project, settings);
    await generateSDDHealthReport(project, settings);

    const [planCall, healthCall] = spy.mock.calls;
    expect(planCall[2]).toContain('# Plan SDD — Portal de asegurados');
    expect(planCall[3]).toEqual({ temperature: 0.5 });
    expect(healthCall[2]).toContain('Current SDD artifacts: BRD del portal');
    expect(healthCall[3]).toEqual({ temperature: 0.4 });
  });
});

describe('extractMemoryEntriesFromDocument', () => {
  const file = { name: 'acta.pdf', type: 'application/pdf', base64Data: 'QUJD' };

  it('keeps only trimmed, non-empty strings of at most 400 characters', async () => {
    vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({
      text: JSON.stringify({ entries: ['  Usar OAuth2 en el canal de brokers  ', '', 42, 'x'.repeat(401), 'Retención de 7 años'] }),
    });

    await expect(extractMemoryEntriesFromDocument(file, 'project', '', settings))
      .resolves.toEqual(['Usar OAuth2 en el canal de brokers', 'Retención de 7 años']);
  });

  it('caps the list at 50 entries', async () => {
    vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({
      text: JSON.stringify({ entries: Array.from({ length: 60 }, (_, i) => `apunte ${i}`) }),
    });

    await expect(extractMemoryEntriesFromDocument(file, 'global', '', settings)).resolves.toHaveLength(50);
  });

  it('returns no entries when the answer does not parse', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: 'no es JSON' });

    await expect(extractMemoryEntriesFromDocument(file, 'agent', '', settings)).resolves.toEqual([]);
  });

  it('sends the document inline with the scope guidance', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: '{"entries":[]}' });

    await extractMemoryEntriesFromDocument(file, 'artifact', 'Para el ADR de pagos', settings);

    const contents = spy.mock.calls[0][2] as Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
    expect(contents[0].parts[0].text).toContain('ámbito: "artifact"');
    expect(contents[0].parts[0].text).toContain('Para el ADR de pagos');
    expect(contents[0].parts[1].inlineData).toEqual({ mimeType: 'application/pdf', data: 'QUJD' });
    expect(spy.mock.calls[0][4]).toEqual({ maxRetries: 1 });
  });
});
