/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
/**
 * Contract — practical lab (#3) and adaptive diagnostic (#2) AI helpers must
 * parse structured JSON robustly and never throw on partial/garbage payloads.
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

// The LMS moved out of the monolith; `learningService` is its façade.
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

describe('evaluateDiagramChallenge (#3)', () => {
  beforeEach(() => {
    generateContent.mockReset();
    localStorage.setItem('user_gemini_key', 'test-key');
  });

  it('parses a full evaluation payload', async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        grade: 82,
        summary: 'Buen diseño general.',
        dimensions: [{ name: 'Resiliencia', score: 70, feedback: 'Añade reintentos.' }],
        improvements: ['Documentar contratos de API'],
      }),
    });

    const result = await learningService.evaluateDiagramChallenge('reto', 'graph TD; A-->B', settings);
    expect(result.grade).toBe(82);
    expect(result.dimensions).toHaveLength(1);
    expect(result.improvements).toContain('Documentar contratos de API');
  });

  it('normalizes a partial/garbage payload without throwing', async () => {
    generateContent.mockResolvedValue({ text: '{"grade": "oops"}' });
    const result = await learningService.evaluateDiagramChallenge('reto', 'graph TD; A-->B', settings);
    expect(result.grade).toBe(0);
    expect(Array.isArray(result.dimensions)).toBe(true);
    expect(Array.isArray(result.improvements)).toBe(true);
  });
});

describe('generateRoleDiagnostic (#2)', () => {
  beforeEach(() => {
    generateContent.mockReset();
    localStorage.setItem('user_gemini_key', 'test-key');
  });

  it('returns the parsed question array', async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify([
        { area: 'Integración', question: '¿?', options: ['a', 'b', 'c', 'd'], correctIndex: 1 },
      ]),
    });
    const qs = await learningService.generateRoleDiagnostic('Arquitecto de Soluciones', settings);
    expect(qs).toHaveLength(1);
    expect(qs[0].area).toBe('Integración');
  });

  it('returns an empty array when the model does not return a list', async () => {
    generateContent.mockResolvedValue({ text: '{"not":"an array"}' });
    const qs = await learningService.generateRoleDiagnostic('Arquitecto de Datos', settings);
    expect(qs).toEqual([]);
  });
});
