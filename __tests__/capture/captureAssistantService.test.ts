/**
 * El asistente de captura: un solo agente, y desconfiado de lo que le devuelven.
 *
 * Lo que estas pruebas fijan no es que llame a un modelo — eso lo hace
 * cualquiera— sino las tres reglas que lo hacen seguro de poner al lado de cada
 * campo de seis formularios: no llama cuando no hay de dónde partir, no acepta
 * lo que no pidió, y no rompe el formulario cuando el proveedor falla.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const { generateContentWithFallback } = vi.hoisted(() => ({
  generateContentWithFallback: vi.fn(),
}));

vi.mock('../../services/geminiService', () => ({
  geminiService: { generateContentWithFallback },
}));

vi.mock('../../lib/ai/modelCatalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ai/modelCatalog')>()),
  resolveEffectiveModel: (tier: string) => ({ id: `model-${tier}` }),
}));

import { captureAssistantService } from '../../services/ai/generation/capture/captureAssistantService';
import { CAPTURE_FIELDS, type CaptureSuggestionRequest } from '../../lib/capture';
import type { Settings } from '../../types';

const settings = {
  globalContext: [],
  language: 'es',
  theme: 'light',
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.4, provider: 'gemini' },
} as unknown as Settings;

const requestFor = (
  overrides: Partial<CaptureSuggestionRequest> = {},
): CaptureSuggestionRequest => ({
  level: 'initiative',
  fields: [CAPTURE_FIELDS['initiative.objectives']],
  context: {
    level: 'initiative',
    subject: 'Alta digital de clientes',
    known: [{ label: 'Necesidad del negocio', value: 'El alta tarda cinco días y el 30 % se cae por el camino.' }],
    ancestry: [],
  },
  agentBriefing: ['Eres Arky, arquitecto agente.'],
  ...overrides,
});

const respondWith = (payload: unknown): void => {
  generateContentWithFallback.mockResolvedValue({ text: JSON.stringify(payload) });
};

describe('captureAssistantService', () => {
  beforeEach(() => {
    generateContentWithFallback.mockReset();
  });

  it('refuses to call the model when there is nothing to reason from', async () => {
    const result = await captureAssistantService.suggest(
      requestFor({ context: { level: 'initiative', subject: '', known: [], ancestry: [] } }),
      settings,
    );

    expect(result.ok).toBe(false);
    // El guardarraíl es lo que impide que un formulario vacío produzca
    // objetivos genéricos, plausibles y sobre nada.
    expect(generateContentWithFallback).not.toHaveBeenCalled();
    expect(result.reason).toMatch(/necesidad del negocio/i);
  });

  it('runs the agent at the tier its profile declares', async () => {
    respondWith({ suggestions: [{ fieldId: 'initiative.objectives', values: ['Reducir el alta a un día'] }] });
    await captureAssistantService.suggest(requestFor({ modelTier: 'deep' }), settings);
    expect(generateContentWithFallback).toHaveBeenCalledWith(
      settings,
      'model-deep',
      expect.any(String),
      expect.objectContaining({ responseMimeType: 'application/json' }),
      expect.anything(),
    );
  });

  it('carries the agent briefing and the field rules into the prompt', async () => {
    respondWith({ suggestions: [{ fieldId: 'initiative.objectives', values: ['Reducir el alta a un día'] }] });
    await captureAssistantService.suggest(requestFor(), settings);

    const prompt = generateContentWithFallback.mock.calls[0][2] as string;
    expect(prompt).toContain('Eres Arky, arquitecto agente.');
    // La regla de la disciplina viaja literal: un objetivo dice qué, no cómo.
    expect(prompt).toContain('Un objetivo dice QUÉ se quiere lograr, nunca CÓMO construirlo.');
    expect(prompt).toContain('El alta tarda cinco días');
  });

  it('drops suggestions for fields nobody asked about', async () => {
    respondWith({
      suggestions: [
        { fieldId: 'initiative.objectives', values: ['Reducir el alta a un día'] },
        { fieldId: 'initiative.kpis', values: ['Algo que nadie pidió (u)'] },
      ],
    });

    const result = await captureAssistantService.suggest(requestFor(), settings);

    // Una sugerencia sobre un campo que no se pidió no es ayuda: el botón que
    // hizo la llamada pinta un campo, y un llamador que se fiara del orden del
    // array aplicaría el texto equivocado.
    expect(result.suggestions.map((entry) => entry.fieldId)).toEqual(['initiative.objectives']);
  });

  it('holds a single-value field to exactly one suggestion', async () => {
    respondWith({
      suggestions: [{ fieldId: 'initiative.driver', values: ['Primero', 'Segundo', 'Tercero'] }],
    });

    const result = await captureAssistantService.suggest(
      requestFor({ fields: [CAPTURE_FIELDS['initiative.driver']] }),
      settings,
    );

    expect(result.suggestions[0].values).toEqual(['Primero']);
  });

  it('reports open questions instead of letting them become suggestions', async () => {
    respondWith({
      suggestions: [{ fieldId: 'initiative.objectives', values: ['Reducir el alta a un día'] }],
      openQuestions: ['¿Qué porcentaje de caídas es aceptable para el negocio?'],
    });

    const result = await captureAssistantService.suggest(requestFor(), settings);
    expect(result.openQuestions).toEqual(['¿Qué porcentaje de caídas es aceptable para el negocio?']);
  });

  it('degrades with a sentence the form can render when the provider fails', async () => {
    generateContentWithFallback.mockRejectedValue(new Error('503'));
    const result = await captureAssistantService.suggest(requestFor(), settings);

    expect(result.ok).toBe(false);
    expect(result.suggestions).toEqual([]);
    expect(result.reason).toMatch(/no está disponible/i);
  });

  it('says nothing when the user cancelled: a cancellation is not a failure', async () => {
    generateContentWithFallback.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const result = await captureAssistantService.suggest(requestFor(), settings);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('');
  });

  it('does not present unparseable output as a suggestion', async () => {
    generateContentWithFallback.mockResolvedValue({ text: 'lo siento, no puedo' });
    const result = await captureAssistantService.suggest(requestFor(), settings);
    expect(result.ok).toBe(false);
    expect(result.suggestions).toEqual([]);
  });
});
