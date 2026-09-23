/** Critique and refinement before persisting an artifact. */
import type { Settings, ArtifactTemplate } from '../../../types';
import type { Project } from '../../architectureProjects';
import { resolveModelForSettings } from '../catalog';
import { aiGateway } from './aiGateway';

export interface ArtifactContentCritiqueRequest {
    project: Project;
    template: ArtifactTemplate;
    settings: Settings;
    content: string;
    mode: 'document' | 'diagram' | 'hybrid' | 'table';
    score: number;
    issues: string[];
}

export interface ArtifactContentRefinementRequest extends ArtifactContentCritiqueRequest {
    critique?: string;
}

export async function critiqueArtifactContent(request: ArtifactContentCritiqueRequest): Promise<string> {
    const model = resolveModelForSettings('default', request.settings).id;
    const prompt = `Eres un revisor senior de arquitectura de software y calidad documental.
Evalúa el artefacto antes de persistirlo y devuelve una crítica breve, accionable y segura.

Proyecto: ${request.project.name}
Descripción: ${request.project.description || '(sin descripción)'}
Tipo de artefacto: ${request.template.type}
Modo: ${request.mode}
Audiencia: ${request.template.requestContext?.audience ?? 'técnica'}
Objetivo: ${request.template.objective}
Score actual: ${request.score}/100
Issues detectados:
${request.issues.length > 0 ? request.issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n') : '- Sin issues formales, buscar mejoras marginales.'}

Restricciones:
- No propongas eliminar contenido crítico.
- No propongas reducir nodos/aristas en diagramas.
- Para híbridos debe conservarse exactamente un bloque Mermaid.
- Mantén idioma español y tono profesional.

Contenido actual:
---
${request.content.slice(0, 18000)}
---

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
    const prompt = `Eres un arquitecto de soluciones senior especializado en documentos y diagramas renderizables.
Refina el artefacto antes de persistirlo, preservando su semántica y aumentando claridad, trazabilidad y presentación.

Proyecto: ${request.project.name}
Descripción: ${request.project.description || '(sin descripción)'}
Contexto del proyecto:
${request.project.projectContext.slice(0, 8).map((item) => `- ${item}`).join('\n') || '- Sin contexto adicional'}
Tipo de artefacto: ${request.template.type}
Modo: ${request.mode}
Audiencia: ${request.template.requestContext?.audience ?? 'técnica'}
Objetivo: ${request.template.objective}
Formato esperado: ${expectedFormat}
Score actual: ${request.score}/100
Issues detectados:
${request.issues.length > 0 ? request.issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n') : '- Sin issues formales.'}
Crítica previa:
${request.critique || '(sin crítica previa)'}

Reglas estrictas:
- Devuelve SÓLO el contenido final del artefacto; sin prefacios, sin explicación, sin markdown extra envolvente.
- Preserva significado, decisiones, restricciones y datos existentes.
- No elimines secciones, nodos, relaciones, tablas ni trazabilidad útil.
- No inventes datos específicos; si falta información, agrega supuestos explícitos.
- Documentos: Markdown en español con título, propósito/resumen, alcance, supuestos, riesgos/consideraciones y próximos pasos cuando aplique.
- Diagramas: conserva renderabilidad Mermaid/ReactFlow, etiquetas descriptivas y relaciones válidas.
- Híbridos: conserva exactamente un bloque Mermaid válido y narrativa antes o después.

Contenido actual:
---
${request.content.slice(0, 24000)}
---`;
    const result = await aiGateway.generateContent(
        request.settings,
        model,
        prompt,
        { temperature: 0.25 },
        { maxRetries: 1, maxCandidates: 2 },
    );
    return result.text.trim();
}
