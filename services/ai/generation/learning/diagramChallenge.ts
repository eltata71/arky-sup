/**
 * Diagram challenges — generation and evaluation.
 *
 * Kept apart from lesson delivery because a challenge is assessed rather than
 * read: it has its own output contract and its own failure mode, and merging
 * the two would hide that at the call site.
 */

import type { Settings } from '../../../../types';
import { cleanJsonString } from '../../../../utils';
import { buildLMSTutorPersona } from '../../prompts/projectPrompts';
import { aiGateway } from '../aiGateway';
import { resolveModelForSettings } from '../../catalog';
import type { DiagramChallengeEvaluation } from '../../../../types/lms';

export async function generateDiagramChallenge(
    courseTitle: string,
    lessonTitle: string,
    role: string,
    level: string,
    settings: Settings,
): Promise<string> {
    const prompt = `
    ${buildLMSTutorPersona(settings)}

    Diseña UN reto práctico de modelado de arquitectura para la lección "${lessonTitle}" del curso "${courseTitle}".
    Rol objetivo: ${role}. Nivel: ${level}.

    El reto debe pedir explícitamente al estudiante que produzca un DIAGRAMA (que entregará en sintaxis Mermaid) que resuelva un escenario realista del sector asegurador relacionado con "${lessonTitle}".

    Estructura en Markdown:
    - **Escenario**: contexto de negocio asegurador concreto (2-4 frases).
    - **Tu tarea**: qué debe representar el diagrama (componentes, flujos, límites, integraciones).
    - **Restricciones**: 2-4 restricciones técnicas o de negocio que el diseño debe respetar.
    - **Criterios de éxito**: qué hará excelente a este diagrama (claridad, resiliencia, seguridad, escalabilidad…).

    Sé conciso y exigente. No incluyas la solución.
    `;
    const modelName = resolveModelForSettings('default', settings).id;
    const { text } = await aiGateway.generateContent(settings, modelName, prompt, { temperature: 0.7 });
    return text;
}

export async function evaluateDiagramChallenge(
    challenge: string,
    mermaidCode: string,
    settings: Settings,
): Promise<DiagramChallengeEvaluation> {
    const prompt = `
    ${buildLMSTutorPersona(settings)}

    As the Architect-Professor, evaluate the student's architecture diagram (provided as Mermaid) against the challenge.
    Judge it across these quality dimensions: Claridad estructural, Cobertura del requerimiento, Corrección técnica, Resiliencia y disponibilidad, Seguridad y cumplimiento, Escalabilidad, Separación de responsabilidades, Integraciones y contratos, Observabilidad, Sostenibilidad operativa. Pick the 5-7 most relevant dimensions for THIS challenge.
    Be rigorous: a syntactically valid diagram that ignores the business scenario scores low.

    ## Challenge
    ${challenge}

    ## Student's Mermaid diagram
    \`\`\`
    ${mermaidCode}
    \`\`\`

    Return ONLY a JSON object with this shape:
    {
        "grade": 0-100,
        "summary": "Concise overall verdict as the Architect-Professor (2-4 sentences, in Spanish)",
        "dimensions": [{ "name": "Dimension name in Spanish", "score": 0-100, "feedback": "Specific, actionable feedback in Spanish" }],
        "improvements": ["Concrete improvement 1 in Spanish", "Concrete improvement 2 in Spanish"]
    }
    `;
    const modelName = resolveModelForSettings('default', settings).id;
    const { text } = await aiGateway.generateContent(settings, modelName, prompt, {
        temperature: 0.2,
        responseMimeType: 'application/json',
    });
    const cleanJson = cleanJsonString(text || '');
    const parsed = JSON.parse(cleanJson || '{}');
    return {
        grade: typeof parsed.grade === 'number' ? parsed.grade : 0,
        summary: parsed.summary || 'No se pudo generar el resumen de la evaluación.',
        dimensions: Array.isArray(parsed.dimensions) ? parsed.dimensions : [],
        improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    };
}
