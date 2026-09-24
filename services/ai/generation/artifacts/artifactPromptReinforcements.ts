/**
 * The prompt pieces of artifact generation that are pure text over a template
 * (F5-01, corte 14): the hybrid wrapper for a Mermaid fallback and the two
 * document quality bars. They left the engine's file with it so they can be
 * tested — and read — without constructing a generation.
 */
import type { ArtifactTemplate } from '../../../../types';

/** Returns true when an ArtifactTemplate.type requires diagram-flavoured generation. */
export function isDiagramArtifactType(type: string): boolean {
    return type.startsWith('mermaid') || type === 'react-flow-graph' || type === 'hybrid-text-diagram';
}

/** Wraps a Mermaid diagram in the hybrid artifact's Markdown contract. */
export function buildHybridMarkdownFromMermaid(template: ArtifactTemplate, mermaid: string): string {
    const trimmed = mermaid.trim().replace(/^```(?:mermaid)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const request = template.requestContext?.userRequest ?? template.objective;
    const plan = template.requestContext?.constructionPlan?.length
        ? `\n\n## Plan de construcción\n${template.requestContext.constructionPlan.map((step, index) => `${index + 1}. ${step}`).join('\n')}`
        : '';
    const rationale = template.requestContext?.rationale
        ? `\n\n## Justificación arquitectónica\n${template.requestContext.rationale}`
        : '';
    const actors = /farmacia|receta|reclamo|asegur/i.test(request)
        ? ['Paciente / Afiliado', 'Farmacia', 'Switch / PBM', 'Aseguradora', 'Banco / Pagos']
        : ['Solicitante', 'Equipo responsable', 'Sistema de soporte', 'Control / aprobación'];
    return `# ${template.name}

## Resumen
${template.objective}

## Alcance del proceso
Artefacto híbrido generado para cubrir la solicitud original con explicación textual y diagrama Mermaid renderizable.

## Actores / lanes
${actors.map(actor => `- ${actor}`).join('\n')}

## Solicitud original
${request}${rationale}

## Diagrama renderizable
\`\`\`mermaid
${trimmed}
\`\`\`${plan}

## Notas de lectura y supuestos
- El diagrama usa sintaxis Mermaid compatible con el parser local.
- Si la salida provino de fallback, el contenido queda editable y trazable desde el canvas.
- Validar nombres de actores y reglas de negocio con el dueño del proceso.`;
}

/**
 * Reinforcement block appended to non-diagram on-demand artifacts so document
 * generations carry the same level of structural rigor as their diagram
 * counterparts. The block is intentionally short — Gemini's implicit cache
 * keeps system instruction cost low; this tail just nudges the model toward
 * a richer, sectioned, decision-grade output that matches the architect's
 * approved construction plan.
 */
export function buildOnDemandDocumentReinforcement(template: ArtifactTemplate): string {
    if (!template.requestContext) return '';
    const audience = template.requestContext.audience ?? 'mixed';
    const audienceHint = audience === 'executive'
        ? 'Audiencia ejecutiva: estructura tipo memo (TL;DR, decisiones, riesgos, próximos pasos); evita jerga técnica innecesaria.'
        : audience === 'technical'
            ? 'Audiencia técnica: profundiza en arquitectura, contratos, integraciones, NFRs, supuestos y validaciones.'
            : 'Audiencia mixta: combina visión ejecutiva al inicio y profundidad técnica en secciones posteriores claramente separadas.';
    return `

ON-DEMAND DOCUMENT QUALITY BAR (mandatory):
- Cubre TODA la solicitud original del arquitecto sin truncar; si una sección requiere extensión, déjala completa antes de pasar a la siguiente.
- Estructura el documento con encabezados claros (## / ###) y listas accionables; nunca devuelvas un único párrafo monolítico.
- Cada sección debe contener contenido específico al proyecto y a la solicitud — prohibido el placeholder genérico "Ejemplo de cliente".
- Cierra con un bloque "Validaciones recomendadas" enumerando supuestos a confirmar con stakeholders y dependencias activas.
- ${audienceHint}
- Cita explícitamente qué señales del contexto del proyecto influyeron cada decisión clave (ej: "Basado en la integración con WeeCompany PBM declarada en el contexto…").`;
}

/**
 * Quality reinforcement applied to ALL non-diagram catalog artefacts.
 *
 * Documents historically had inconsistent quality vs. on-demand documents
 * because the on-demand path got a tailored "QUALITY BAR" suffix while the
 * catalog path relied on the per-template format instructions only. This
 * reinforcement closes that gap with a stable, project-grounded output
 * standard that complements (does not duplicate) the per-template SDD/BRD
 * structures already in place.
 */
export function buildCatalogDocumentReinforcement(template: ArtifactTemplate): string {
    return `

CATALOG DOCUMENT QUALITY BAR (mandatory — apply on top of the per-template structure above):
- Personaliza CADA sección con detalles concretos del proyecto: nombres reales, integraciones declaradas, fases registradas, restricciones del contexto. Prohibido contenido genérico ("Empresa X", "Sistema legacy").
- Mantén títulos en jerarquía consistente (# > ## > ###); nunca devuelvas un único párrafo monolítico.
- Toda lista numerada o con viñetas debe contener al menos 3 elementos cuando aplique.
- Si el artefacto es ${template.type}, respeta exactamente la plantilla declarada arriba — no remueves secciones, no las renombras.
- Cuando referencias trazabilidad (BR-, UC-, NFR-, TC-), usa identificadores monotónicos y consistentes a lo largo del documento.
- Cierra con un breve bloque "Próximos pasos" con 2-4 acciones recomendadas.
- Idioma: español por defecto (el contexto global del proyecto manda); evita anglicismos cuando exista término establecido en la industria aseguradora.`;
}
