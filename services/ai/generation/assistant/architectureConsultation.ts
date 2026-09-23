/**
 * The Training Center's consulting room: a client's challenge answered by the
 * architect-professor persona. Moved out of the engine in F5-01 (corte 7); the
 * prompt is unchanged.
 */
import type { Settings } from '../../../../types';
import { resolveModelForSettings } from '../../catalog';
import { buildLMSTutorPersona } from '../../prompts/projectPrompts';
import { aiGateway } from '../aiGateway';

export async function consultArchitecture(challenge: string, settings: Settings): Promise<string> {
    const prompt = `
        ${buildLMSTutorPersona(settings)}

        A client from the health and life insurance industry has presented the following architectural challenge:
        "${challenge}"

        As the Architect-Professor and Principal Architect Consultant, provide a strategic, structured solution proposal.
        Every recommendation must justify the **¿Qué problema de negocio resuelve esta decisión arquitectónica?** question.

        Structure your response in Markdown with these sections:
        1. **Resumen Ejecutivo** — Strategic framing: the business problem, the architectural opportunity, and the expected outcome for the insurer
        2. **Arquitectura Propuesta** — High-level architecture with key components, integration patterns, and data flows relevant to the insurance context
        3. **Análisis de Trade-offs** — Honest evaluation: technical advantages, operational risks, business implications, and what you are explicitly NOT recommending and why
        4. **Principios Arquitectónicos Clave** — 3-5 architectural principles derived from this solution that the architect should internalize
        5. **Cursos y Temas Recomendados** — Specific learning topics to deepen expertise for implementing this solution
        `;

    const modelName = resolveModelForSettings('default', settings).id;

    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
        temperature: 0.7,
    });
    return text;
}
