/**
 * La guía de uso contra el modelo.
 *
 * Lo que se fija aquí es la propiedad por la que la ayuda existe en el raíl y
 * no dentro de una pantalla: **nunca lanza**. Un fallo del proveedor devuelve
 * `ok: false` con un motivo en español, y quien llama enseña entonces el
 * catálogo. Una ayuda que revienta cuando falla la red desaparece justo cuando
 * alguien está intentando entender el producto.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const { generateContentWithFallback } = vi.hoisted(() => ({
  generateContentWithFallback: vi.fn(),
}));

vi.mock('../../../services/geminiService', () => ({
  geminiService: { generateContentWithFallback },
}));

vi.mock('../../../lib/ai/modelCatalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/ai/modelCatalog')>()),
  resolveEffectiveModel: (tier: string) => ({ id: `model-${tier}` }),
}));

import { platformGuideService } from '../../../services/ai/generation/platformGuide/platformGuideService';
import { AiProxyEnforcementError, proxyFailure } from '../../../services/ai/aiProxyPolicy';
import { PLATFORM_GUIDE_TOPICS, type PlatformGuideRequest } from '../../../lib/platformGuide';
import type { Settings } from '../../../types';

const settings = {
  globalContext: [],
  language: 'es',
  theme: 'light',
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.4, provider: 'gemini' },
} as unknown as Settings;

const request = (overrides: Partial<PlatformGuideRequest> = {}): PlatformGuideRequest => ({
  question: '¿Cómo pido una solicitud de entregable?',
  briefing: ['Eres la guía de uso de Arky.'],
  topics: PLATFORM_GUIDE_TOPICS.filter((topic) => topic.id === 'entregable'),
  history: [],
  ...overrides,
});

describe('platformGuideService', () => {
  beforeEach(() => {
    generateContentWithFallback.mockReset();
  });

  it('devuelve la respuesta del modelo y dice de dónde viene', async () => {
    generateContentWithFallback.mockResolvedValue({ text: '  Se pide desde el proyecto.  ' });
    const result = await platformGuideService.answer(request(), settings);
    expect(result).toMatchObject({ ok: true, source: 'model', text: 'Se pide desde el proyecto.' });
    expect(result.topicIds).toEqual(['entregable']);
  });

  it('el material de la guía y las reglas viajan en el prompt', async () => {
    generateContentWithFallback.mockResolvedValue({ text: 'ok' });
    await platformGuideService.answer(request(), settings, { agentBriefing: ['Eres Arky.'] });
    const prompt = generateContentWithFallback.mock.calls[0][2] as string;
    expect(prompt).toContain('Eres Arky.');
    expect(prompt).toContain('MATERIAL DE LA GUÍA');
    expect(prompt).toContain('charter');
    expect(prompt).toContain('No resuelves preguntas de arquitectura');
  });

  it('un fallo del proveedor no rompe la ayuda: vuelve como motivo', async () => {
    generateContentWithFallback.mockRejectedValue(new Error('503'));
    const result = await platformGuideService.answer(request(), settings);
    expect(result.ok).toBe(false);
    expect(result.source).toBe('guide');
    expect(result.reason).toContain('No se pudo consultar');
    expect(result.topicIds).toEqual(['entregable']);
  });

  it('cuando el despliegue no tiene proxy, el motivo lo dice y no lo esconde', async () => {
    // Es configuración, no una caída: reintentar no arregla nada, y el usuario
    // sí tiene una salida (su propia clave). Un genérico se las oculta las dos.
    generateContentWithFallback.mockRejectedValue(
      new AiProxyEnforcementError(proxyFailure('not-configured', { retryable: false })),
    );
    const result = await platformGuideService.answer(request(), settings);
    expect(result.ok).toBe(false);
    expect(result.source).toBe('guide');
    expect(result.reason).toContain('proxy de IA');
    expect(result.reason).toContain('Ajustes → IA');
    expect(result.reason).toContain('Te dejo lo que dice la guía.');
  });

  it('una respuesta vacía se trata como fallo, no como respuesta', async () => {
    generateContentWithFallback.mockResolvedValue({ text: '   ' });
    const result = await platformGuideService.answer(request(), settings);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no devolvió respuesta');
  });

  it('sin pregunta no llama al modelo', async () => {
    const result = await platformGuideService.answer(request({ question: '' }), settings);
    expect(result.ok).toBe(false);
    expect(generateContentWithFallback).not.toHaveBeenCalled();
  });

  it('lleva el historial cuando lo hay, para poder seguir el hilo', async () => {
    generateContentWithFallback.mockResolvedValue({ text: 'ok' });
    await platformGuideService.answer(
      request({ history: [{ role: 'user', text: '¿qué es una iniciativa?' }] }),
      settings,
    );
    const prompt = generateContentWithFallback.mock.calls[0][2] as string;
    expect(prompt).toContain('CONVERSACIÓN HASTA AHORA');
    expect(prompt).toContain('¿qué es una iniciativa?');
  });
});
