/**
 * Critique and refinement before persisting an artifact.
 *
 * Both used to reach the model with the project's name, its description and
 * — for the refinement — its first eight notes, unordered: no global
 * standards, no memory, no initiative, no sibling artifacts, the artifact's
 * body unfenced and the language fixed to Spanish. The bench measured 0 % and
 * 10 % of the context arriving. They now open with the base prompt under the
 * `refine` profile, like every other artifact operation (plan de calidad de
 * artefactos, 7.3a).
 */
import type { Settings, ArtifactTemplate } from '../../../types';
import type { Artifact, ArtifactContextPorts } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import { wrapUntrustedContent } from '../../../lib/untrustedContent';
import { resolveModelForSettings } from '../catalog';
import { buildBasePrompt } from '../prompts/projectPrompts';
import { aiGateway } from './aiGateway';

/** The context ports — initiative, conversation, deliverables — reach both calls (7.3). */
export interface ArtifactContentCritiqueRequest extends ArtifactContextPorts {
    project: Project;
    template: ArtifactTemplate;
    settings: Settings;
    content: string;
    mode: 'document' | 'diagram' | 'hybrid' | 'table';
    score: number;
    issues: string[];
    /** The artifact being regenerated, when there is one: its own memory is the highest scope. */
    previousArtifact?: Artifact;
}

export interface ArtifactContentRefinementRequest extends ArtifactContentCritiqueRequest {
    critique?: string;
}

const CRITIQUE_CONTENT_CHARS = 18000;
const REFINE_CONTENT_CHARS = 24000;

const languageName = (settings: Settings): string => (settings.language === 'en' ? 'English' : 'español');

/** The context every refinement call opens with: the base prompt under the `refine` profile. */
const refinementContext = (request: ArtifactContentCritiqueRequest): string =>
    buildBasePrompt(request.project, request.settings, {
        profile: 'refine',
        artifact: request.previousArtifact,
        query: `${request.template.name}. ${request.template.objective}`,
        excludeVersionGroupId: request.previousArtifact?.versionGroupId,
        businessMotivation: request.businessMotivation,
        conversation: request.conversation,
        deliverables: request.deliverables,
    });

const fencedContent = (content: string, maxChars: number): string =>
    wrapUntrustedContent('artefacto a revisar', content.slice(0, maxChars));

const artifactFacts = (request: ArtifactContentCritiqueRequest): string => `Tipo de artefacto: ${request.template.type}
Modo: ${request.mode}
Audiencia: ${request.template.requestContext?.audience ?? 'técnica'}
Objetivo: ${request.template.objective}
Score actual: ${request.score}/100`;

export async function critiqueArtifactContent(request: ArtifactContentCritiqueRequest): Promise<string> {
    const model = resolveModelForSettings('default', request.settings).id;
    const prompt = `${refinementContext(request)}

TAREA: actúa como revisor senior de arquitectura de software y calidad documental.
Evalúa el artefacto antes de persistirlo y devuelve una crítica breve, accionable y segura, contrastándolo con el contexto de arriba: señala lo que contradice o ignora del proyecto, de sus iniciativas y de los artefactos relacionados.

${artifactFacts(request)}
Issues detectados:
${request.issues.length > 0 ? request.issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n') : '- Sin issues formales, buscar mejoras marginales.'}

Restricciones:
- No propongas eliminar contenido crítico.
- No propongas reducir nodos/aristas en diagramas.
- Para híbridos debe conservarse exactamente un bloque Mermaid.
- Escribe en ${languageName(request.settings)}, con tono profesional.

Contenido actual:
${fencedContent(request.content, CRITIQUE_CONTENT_CHARS)}

Devuelve sólo una lista breve de recomendaciones concretas. No devuelvas el artefacto completo.`;
    const result = await aiGateway.generateContent(
        request.settings,
        model,
        prompt,
        { temperature: 0.2 },
        { maxRetries: 1, maxCandidates: 2 },
    );
    return result.text.trim();
}

/**
 * Refines artifact content with Gemini only when the orchestrator has
 * decided AI adds value. The response must be the final artifact content;
 * caller-side safety gates decide whether to accept or discard it.
 */
export async function refineArtifactContent(request: ArtifactContentRefinementRequest): Promise<string> {
    const model = resolveModelForSettings('default', request.settings).id;
    const expectedFormat = request.mode === 'diagram'
        ? 'Mermaid válido o JSON ReactFlow válido según el tipo original'
        : request.mode === 'hybrid'
            ? 'Markdown completo con exactamente un bloque ```mermaid válido'
            : 'Markdown completo';
    const prompt = `${refinementContext(request)}

TAREA: actúa como arquitecto de soluciones senior especializado en documentos y diagramas renderizables.
Refina el artefacto antes de persistirlo, preservando su semántica y aumentando claridad, trazabilidad y presentación. Mantén la coherencia con el contexto de arriba: los nombres, IDs y decisiones del proyecto y de sus artefactos relacionados.

${artifactFacts(request)}
Formato esperado: ${expectedFormat}
Issues detectados:
${request.issues.length > 0 ? request.issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n') : '- Sin issues formales.'}
Crítica previa:
${request.critique ? wrapUntrustedContent('crítica previa', request.critique) : '(sin crítica previa)'}

Reglas estrictas:
- Devuelve SÓLO el contenido final del artefacto; sin prefacios, sin explicación, sin markdown extra envolvente.
- Preserva significado, decisiones, restricciones y datos existentes.
- No elimines secciones, nodos, relaciones, tablas ni trazabilidad útil.
- No inventes datos específicos; si falta información, agrega supuestos explícitos.
- Documentos: Markdown en ${languageName(request.settings)} con título, propósito/resumen, alcance, supuestos, riesgos/consideraciones y próximos pasos cuando aplique.
- Diagramas: conserva renderabilidad Mermaid/ReactFlow, etiquetas descriptivas y relaciones válidas.
- Híbridos: conserva exactamente un bloque Mermaid válido y narrativa antes o después.

Contenido actual:
${fencedContent(request.content, REFINE_CONTENT_CHARS)}`;
    const result = await aiGateway.generateContent(
        request.settings,
        model,
        prompt,
        { temperature: 0.25 },
        { maxRetries: 1, maxCandidates: 2 },
    );
    return result.text.trim();
}
