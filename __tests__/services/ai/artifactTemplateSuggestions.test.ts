import { afterEach, describe, expect, it, vi } from 'vitest';
import { artifactGenerationService } from '../../../services/ai/generation/artifactGenerationService';
import { aiGateway } from '../../../services/ai/generation/aiGateway';
import type { Settings } from '../../../types';

const settings = {
  aiConfig: { model: 'gemini-2.5-flash', apiKeySource: 'global' },
} as Settings;

afterEach(() => vi.restoreAllMocks());

describe('initial artifact names', () => {
  it('sends the template through the gateway with a JSON array schema', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: '["Visión","Diagrama C4"]' });

    await expect(artifactGenerationService.getInitialArtifactsForTemplate('Portal', settings))
      .resolves.toEqual(['Visión', 'Diagrama C4']);
    expect(spy.mock.calls[0][2]).toContain('project type: "Portal"');
    expect(spy.mock.calls[0][3]).toEqual({
      responseMimeType: 'application/json',
      responseSchema: { type: 'array', items: { type: 'string' } },
    });
  });

  it('keeps the deterministic fallback for failed or malformed model responses', async () => {
    const spy = vi.spyOn(aiGateway, 'generateContent').mockResolvedValue({ text: '{"unexpected":true}' });
    const expected = ['Diagrama de Contexto (C4-N1)', 'Visión de la Arquitectura'];

    await expect(artifactGenerationService.getInitialArtifactsForTemplate('Portal', settings)).resolves.toEqual(expected);
    spy.mockRejectedValue(new Error('provider unavailable'));
    await expect(artifactGenerationService.getInitialArtifactsForTemplate('Portal', settings)).resolves.toEqual(expected);
  });
});
