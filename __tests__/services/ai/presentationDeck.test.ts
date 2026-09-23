import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { legacyTransport } from '../../../services/ai/generation/legacyTransport';
import { generatePresentationDeck } from '../../../services/ai/generation/presentationDeck';
import { buildMinimalPresentationDeck, parsePresentationDeck } from '../../../services/presentation';
import type { ArtifactTemplate, Settings } from '../../../types';
import type { Project } from '../../../services/architectureProjects';

const project = {
  id: 'p1',
  name: 'Core bancario',
  description: 'Modernización del core',
  projectContext: [],
  artifacts: [],
} as unknown as Project;
const template = {
  type: 'presentation-executive',
  name: 'Presentación Ejecutiva',
  objective: 'Explicar la decisión al comité',
} as unknown as ArtifactTemplate;
const settings = {
  language: 'es',
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.9, apiKeySource: 'global' },
} as unknown as Settings;

const slide = (n: number) => ({
  id: `s${n}`,
  slideNumber: n,
  title: `Diapositiva ${n}`,
  layout: n === 1 ? 'titleSlide' : 'executiveSummary',
  contentBlocks: n === 1 ? [] : [{ type: 'text', content: `Contenido sustantivo de la diapositiva ${n} con detalle suficiente.` }],
});
const goodDeck = JSON.stringify({
  kind: 'presentation',
  version: '1.0',
  title: 'Presentación Ejecutiva',
  audience: 'executive',
  slides: [1, 2, 3, 4, 5, 6].map(slide),
});
// Content slides with nothing on them: the gate's one critical finding.
const poorDeck = JSON.stringify({
  kind: 'presentation',
  title: 'X',
  slides: [2, 3].map((n) => ({ ...slide(n), contentBlocks: [] })),
});

afterEach(() => vi.restoreAllMocks());

describe('presentation deck outside the engine (F5-01 corte 12)', () => {
  it('the engine owns neither the deck prompt nor the minimal fallback', () => {
    const engine = readFileSync('services/geminiService.ts', 'utf8');
    expect(engine).not.toMatch(/private async generatePresentationDeck\(/);
    expect(engine).not.toMatch(/private buildMinimalPresentationDeck\(/);
  });

  it('a usable deck needs one call through the text path, with the original budget', async () => {
    const spy = vi.spyOn(legacyTransport, 'generateTextWithFallback').mockResolvedValue(goodDeck);

    const json = await generatePresentationDeck(project, template, settings);
    const deck = JSON.parse(json);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][3]).toMatchObject({ temperature: 0.7, responseMimeType: 'application/json' });
    expect(spy.mock.calls[0][4]).toEqual({ timeoutMs: 90000, maxRetries: 2 });
    expect(deck.metadata).toMatchObject({ templateId: 'presentation-executive', projectId: 'p1' });
    expect(deck.slides.length).toBeGreaterThanOrEqual(5);
  });

  it('an unusable deck gets exactly one corrective retry that names the rejection', async () => {
    const spy = vi.spyOn(legacyTransport, 'generateTextWithFallback')
      .mockResolvedValueOnce(poorDeck)
      .mockResolvedValueOnce(goodDeck);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const deck = JSON.parse(await generatePresentationDeck(project, template, settings));

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][2]).toContain('PREVIOUS ATTEMPT WAS REJECTED');
    expect(spy.mock.calls[1][4]).toEqual({ timeoutMs: 90000, maxRetries: 1 });
    expect(deck.slides.length).toBeGreaterThanOrEqual(5);
  });

  it('a failed corrective retry keeps the first attempt instead of throwing', async () => {
    vi.spyOn(legacyTransport, 'generateTextWithFallback')
      .mockResolvedValueOnce(poorDeck)
      .mockRejectedValueOnce(new Error('503'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const deck = JSON.parse(await generatePresentationDeck(project, template, settings));
    expect(deck.metadata.projectId).toBe('p1');
  });

  it('the minimal deck calls no model and always parses', () => {
    const json = buildMinimalPresentationDeck({ id: 'p1', name: 'Core bancario' }, template);
    const parsed = parsePresentationDeck(json, { artifactType: template.type, artifactName: template.name });

    expect(parsed.deck.slides).toHaveLength(3);
    expect(parsed.deck.audience).toBe('executive');
    expect(parsed.deck.slides[0].subtitle).toBe('Core bancario');
  });
});
