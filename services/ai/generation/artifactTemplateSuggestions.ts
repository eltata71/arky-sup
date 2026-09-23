/** Initial artifact names for a project template. */
import type { Settings } from '../../../types';
import { cleanJsonString } from '../../../utils';
import { resolveModelForSettings } from '../catalog';
import { aiGateway } from './aiGateway';

const FALLBACK = ['Diagrama de Contexto (C4-N1)', 'Visión de la Arquitectura'];

export async function getInitialArtifactsForTemplate(templateName: string, settings: Settings): Promise<string[]> {
  const prompt = `Suggest 3-5 artifact template names for project type: "${templateName}". Return JSON Array of strings.`;
  try {
    const { text } = await aiGateway.generateContent(settings, resolveModelForSettings('default', settings).id, prompt, {
      responseMimeType: 'application/json', responseSchema: { type: 'array', items: { type: 'string' } },
    });
    const parsed: unknown = JSON.parse(cleanJsonString(text || '') || '[]');
    return Array.isArray(parsed) && parsed.every((name): name is string => typeof name === 'string')
      ? parsed
      : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
