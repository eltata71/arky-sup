/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
/**
 * Contract — the lesson Tutor IA must be stateful and context-aware.
 *
 * Bug history: `LessonModal` used to call `ai.models.generateContent` inline
 * with a one-line prompt and NO conversation history and NO lesson content, so
 * the tutor answered every question in a vacuum. The fix routes the tutor
 * through `learningService.chatWithLesson`, folding the prior turns into the
 * request and grounding the system instruction in the section the student is
 * reading plus their calibration profile.
 *
 * These tests pin that behavior so it cannot silently regress.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('chatWithLesson — stateful, context-aware tutor', () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContentStream.mockReset();
    localStorage.setItem('user_gemini_key', 'test-key');
    generateContent.mockResolvedValue({ text: 'Respuesta del tutor.' });
  });

  it('folds prior conversation history into the request (memory)', async () => {
    const history = [
      { role: 'user', text: '¿Qué es CQRS?' },
      { role: 'model', text: 'Es la separación de comandos y consultas.' },
    ];

    await learningService.chatWithLesson(
      'Arquitectura EDA',
      'Event Sourcing',
      'Clase Magistral',
      '¿Y cómo se relaciona con lo anterior?',
      history,
      settings,
    );

    const call = generateContent.mock.calls[0][0];
    const contents = String(call.contents);
    expect(contents).toContain('¿Qué es CQRS?');
    expect(contents).toContain('separación de comandos y consultas');
    expect(contents).toContain('¿Y cómo se relaciona con lo anterior?');
  });

  it('grounds the system instruction in the lesson content and student profile', async () => {
    await learningService.chatWithLesson(
      'Arquitectura EDA',
      'Event Sourcing',
      'Clase Magistral',
      'Explícame esto',
      [],
      settings,
      'El Event Sourcing almacena el estado como una secuencia inmutable de eventos.',
      { industry: 'Banca', techStack: 'Kotlin, Kafka', currentProject: 'Core bancario' },
    );

    const call = generateContent.mock.calls[0][0];
    const systemInstruction = String(call.config.systemInstruction);
    expect(systemInstruction).toContain('secuencia inmutable de eventos');
    expect(systemInstruction).toContain('Banca');
    expect(systemInstruction).toContain('Kotlin, Kafka');
  });

  it('omits the calibration block when no student context is provided', async () => {
    await learningService.chatWithLesson(
      'Arquitectura EDA',
      'Event Sourcing',
      'Glosario',
      'Define idempotencia',
      [],
      settings,
    );

    const call = generateContent.mock.calls[0][0];
    const systemInstruction = String(call.config.systemInstruction);
    expect(systemInstruction).not.toContain('Calibración del estudiante');
  });
});
