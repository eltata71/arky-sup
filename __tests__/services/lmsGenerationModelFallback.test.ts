/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
/**
 * Regression contract — LMS course generation must use the canonical
 * model-fallback pipeline.
 *
 * Bug history: `generateCourseSyllabus` (the "Generar Curso" button in the AI
 * Lab) called `ai.models.generateContent` on a single model wrapped only in
 * `retryWithBackoff`. Because `retryWithBackoff` deliberately does NOT retry
 * rate-limit (429) errors and does NOT fall back to other models, a single 429
 * on the shared global key surfaced as a hard "Se alcanzó el límite de
 * peticiones de la API" error — making course generation appear dead while
 * every other generation path recovered by falling back to the next model.
 *
 * These tests pin that course/catalog/topic generation now falls back across
 * models on a 429, just like artifact generation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();
const generateContentStream = vi.fn();

vi.mock('../../services/ai/providers/gemini/geminiClient', () => ({
  createGeminiAIClient: vi.fn(() => ({
    models: { generateContent, generateContentStream },
  })),
  getGeminiProxyUrl: () => null,
  isGeminiProxyConfigured: () => false,
}));

// The LMS moved out of the monolith; `learningService` is its façade and
// the surface every caller already used. The pipeline underneath is the
// same, which is what these regression contracts are about.
import { learningService } from '../../services/ai/generation/learningService';
import type { Settings } from '../../types';

const settings: Settings = {
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: {
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    tone: 'Profesional y Técnico',
    languageStyle: 'Conciso y directo',
    apiKeySource: 'user',
  },
};

const validSyllabus = JSON.stringify({
  title: 'Arquitectura Orientada a Eventos',
  description: 'Curso de EDA para seguros.',
  category: 'Architecture',
  modules: [
    { title: 'Fundamentos', level: 'Intermedio', lessons: [{ id: 'l1', title: 'Eventos', description: 'Intro' }] },
  ],
});

describe('LMS generation — model fallback on rate-limit', () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContentStream.mockReset();
    localStorage.setItem('user_gemini_key', 'test-key');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('generateCourseSyllabus recovers when the preferred model is rate-limited (429)', async () => {
    generateContent
      .mockRejectedValueOnce({ status: 429, message: 'rate limit exceeded' })
      .mockResolvedValueOnce({ text: validSyllabus });

    const result = await learningService.generateCourseSyllabus('Event-Driven Architecture', undefined, settings);

    // Proves the fallback model was tried instead of hard-failing on the first 429.
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(result.title).toBe('Arquitectura Orientada a Eventos');
    expect(result.modules).toHaveLength(1);
  });

  it('generateRoleCatalog recovers across models on a 429', async () => {
    generateContent
      .mockRejectedValueOnce({ status: 429, message: 'rate limit exceeded' })
      .mockResolvedValueOnce({ text: '[{"title":"Curso","description":"d","category":"Architecture","level":"Intermedio","modules":[]}]' });

    const result = await learningService.generateRoleCatalog('Arquitecto de Soluciones', settings);

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].title).toBe('Curso');
  });

  it('generateLessonTabContent recovers when a lesson tab is rate-limited (the IMG_2122 bug)', async () => {
    // This is the exact failure in the screenshots: exploring a lesson tab
    // ("Clase Magistral", "Resumen Ejecutivo") returned the raw quota error
    // because the call hit a single model. It must now fall back.
    generateContent
      .mockRejectedValueOnce({ status: 429, message: 'You exceeded your current quota, model: gemini-2.5-pro' })
      .mockResolvedValueOnce({ text: '# Clase Magistral\nContenido de la lección.' });

    const result = await learningService.generateLessonTabContent(
      'Arquitectura Orientada a Eventos',
      '¿Qué es la Arquitectura Orientada a Eventos (EDA)?',
      'Clase Magistral',
      'Arquitecto de Soluciones',
      'Intermedio',
      null,
      settings,
    );

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(result).toContain('Clase Magistral');
  });

  it('chatWithLesson (tutor IA) recovers across models on a 429', async () => {
    generateContent
      .mockRejectedValueOnce({ status: 429, message: 'rate limit exceeded' })
      .mockResolvedValueOnce({ text: 'Respuesta del tutor.' });

    const result = await learningService.chatWithLesson(
      'Curso',
      'Lección',
      'Clase Magistral',
      '¿Puedes explicar más?',
      [],
      settings,
    );

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(result).toBe('Respuesta del tutor.');
  });

  it('generateMasterclassContent recovers across models on a 429', async () => {
    generateContent
      .mockRejectedValueOnce({ status: 429, message: 'rate limit exceeded' })
      .mockResolvedValueOnce({ text: '# Masterclass\nok' });

    const result = await learningService.generateMasterclassContent('Tema', 'Resumen', settings);

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(result).toContain('Masterclass');
  });
});
