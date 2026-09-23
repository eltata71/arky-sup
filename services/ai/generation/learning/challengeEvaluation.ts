/**
 * Evaluación de un reto abierto — la respuesta en texto de un estudiante a un
 * reto de arquitectura de una lección.
 *
 * Fue el último método del Centro de Formación que quedaba en el motor legacy
 * (F5-01, corte 2), y allí devolvía `Promise<any>`: la forma la ponía la
 * fachada con un tipo declarado, sin comprobar nada. Aquí la respuesta del
 * modelo se lee como lo que es —texto que *dice* ser JSON— y se reduce campo a
 * campo a `ChallengeEvaluation`: una nota que no es número no se pinta como
 * nota, y una mejora que no es texto no llega a la lista.
 */

import type { Settings } from '../../../../types';
import { cleanJsonString } from '../../../../utils';
import { buildLMSTutorPersona } from '../../prompts/projectPrompts';
import { aiGateway } from '../aiGateway';
import { resolveModelForSettings } from '../../catalog';
import type { ChallengeEvaluation } from './learningTypes';

/** Reduce la respuesta del modelo a la forma que la pantalla pinta. */
export const toChallengeEvaluation = (raw: unknown): ChallengeEvaluation => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const grade = typeof record.grade === 'number' && Number.isFinite(record.grade)
    ? Math.min(100, Math.max(0, record.grade))
    : undefined;
  const feedback = typeof record.feedback === 'string' && record.feedback.trim() ? record.feedback : undefined;
  const improvements = Array.isArray(record.improvements)
    ? record.improvements.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined;
  return {
    ...(grade !== undefined ? { grade } : {}),
    ...(feedback !== undefined ? { feedback } : {}),
    ...(improvements !== undefined ? { improvements } : {}),
  };
};

export async function evaluateChallenge(
  challenge: string,
  responseText: string,
  settings: Settings,
): Promise<ChallengeEvaluation> {
  const prompt = `
    ${buildLMSTutorPersona(settings)}

    As the Architect-Professor, evaluate the following proposed solution to an architectural challenge in the health and life insurance domain.
    Apply the three evaluation dimensions you teach: (1) Business Impact — does the solution create tangible value for the insurer?, (2) Technical Feasibility — is the architecture sound and implementable?, (3) Operational Sustainability — can it be maintained and evolved over time?
    Solutions that are technically correct but ignore business context score lower. Vague or generic proposals are penalized.

    Challenge: ${challenge}
    Proposed Solution: ${responseText}

    Return a JSON object with this structure:
    {
        "grade": 0-100,
        "feedback": "Detailed professional feedback as the Architect-Professor: acknowledge strengths, challenge weaknesses, and connect to real insurance industry implications",
        "improvements": ["Specific improvement 1 with architectural rationale", "Specific improvement 2 with business justification"]
    }
    `;
  const modelName = resolveModelForSettings('default', settings).id;
  const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
    temperature: 0.2,
    responseMimeType: 'application/json',
  });
  const cleanJson = cleanJsonString(text || '');
  return toChallengeEvaluation(JSON.parse(cleanJson || '{}'));
}
