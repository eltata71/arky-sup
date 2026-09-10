/**
 * Presentation generation prompt builder.
 *
 * The generator was previously asking Gemini for "a markdown document"
 * regardless of artifact type, which is why "Presentación Ejecutiva" came back
 * as a long Word-style document instead of a deck. This module produces the
 * presentation-specific prompt + a JSON `responseSchema` so the model returns
 * a strict {@link PresentationDeck} that the slide viewer + PPTX exporter can
 * consume directly.
 */
import { ArtifactTemplate, ArtifactType } from '../../types';
import { PRESENTATION_TEMPLATE_LIMITS, SUPPORTED_LAYOUTS } from './presentationSchema';

const TEMPLATE_BLUEPRINTS: Record<string, { audience: 'executive' | 'technical' | 'mixed'; arc: string[]; tone: string }> = {
  'presentation-executive': {
    audience: 'executive',
    arc: [
      'portada (titleSlide)',
      'contexto del proyecto / sponsor briefing (executiveSummary)',
      'problema o necesidad de negocio (problemSolution)',
      'objetivos y valor de negocio (executiveSummary o metricsKpi)',
      'arquitectura objetivo / visión sintética (architectureOverview)',
      'roadmap o plan de ejecución (roadmap o timeline)',
      'riesgos principales y mitigaciones (riskMatrix)',
      'decisiones requeridas / asks (decisionSlide)',
      'cierre y próximos pasos (closingSlide)',
    ],
    tone: 'directivo, conciso, orientado a valor de negocio; evita jerga técnica innecesaria; usa bullets breves y mensajes clave fuertes.',
  },
  'presentation-technical': {
    audience: 'technical',
    arc: [
      'portada (titleSlide)',
      'contexto técnico y supuestos (executiveSummary)',
      'arquitectura actual / baseline (architectureOverview)',
      'arquitectura objetivo (architectureOverview o diagramFocused)',
      'componentes clave (twoColumn o comparisonTable)',
      'integraciones (diagramFocused o twoColumn)',
      'modelo de datos / almacenamiento (twoColumn o comparisonTable)',
      'seguridad y cumplimiento (twoColumn o riskMatrix)',
      'despliegue y operación (twoColumn)',
      'observabilidad y SLOs (metricsKpi)',
      'riesgos técnicos y deuda (riskMatrix)',
      'ADRs / decisiones de diseño (decisionSlide)',
      'roadmap técnico (timeline o roadmap)',
      'próximos pasos y owners (closingSlide)',
    ],
    tone: 'preciso, basado en evidencia, con detalles técnicos accionables; usa tablas y diagramas (mermaid) cuando aporten señal; cita componentes y tecnologías reales del proyecto.',
  },
  'presentation-overview': {
    audience: 'mixed',
    arc: [
      'portada (titleSlide)',
      'visión general del sistema (architectureOverview)',
      'capacidades de negocio o producto (twoColumn)',
      'componentes principales (architectureOverview o twoColumn)',
      'integraciones críticas (diagramFocused)',
      'decisiones arquitectónicas clave (decisionSlide)',
      'riesgos y mitigaciones (riskMatrix)',
      'próximos pasos (closingSlide)',
    ],
    tone: 'sintético; equilibra contexto de negocio y profundidad técnica suficiente para alinear a stakeholders mixtos.',
  },
  'presentation-summary': {
    audience: 'executive',
    arc: [
      'portada (titleSlide)',
      'contexto y problema (executiveSummary)',
      'objetivo y beneficios (executiveSummary o metricsKpi)',
      'estado actual y avance (timeline o roadmap)',
      'riesgos críticos y mitigaciones (riskMatrix)',
      'decisiones requeridas (decisionSlide)',
      'próximos pasos (closingSlide)',
    ],
    tone: 'executive briefing: bullets cortos, mensajes clave fuertes; cada slide responde a una sola pregunta del directivo.',
  },
};

const fallbackBlueprint = TEMPLATE_BLUEPRINTS['presentation-overview'];

const blueprintFor = (type: ArtifactType | string) => TEMPLATE_BLUEPRINTS[type] ?? fallbackBlueprint;

export interface PresentationPromptOptions {
  /** Lightweight project signal block already produced by the generator. */
  contextBlock?: string;
  /** Optional language hint (e.g. 'es'). */
  language?: string;
}

/**
 * Builds the presentation-specific instructions appended to the generator's
 * base prompt. The model is asked to return ONLY a JSON object matching
 * {@link PresentationDeck}.
 */
export const buildPresentationPromptInstructions = (
  template: ArtifactTemplate,
  options: PresentationPromptOptions = {},
): string => {
  const blueprint = blueprintFor(template.type);
  const limits = PRESENTATION_TEMPLATE_LIMITS[template.type] ?? { min: 6, max: 12 };
  const arc = blueprint.arc.map((step, idx) => `  ${idx + 1}. ${step}`).join('\n');
  const language = options.language === 'en' ? 'English' : 'Spanish';
  return `
You are producing a PRESENTATION DECK — NOT a long document. Generate a slide deck following the contract below.

PRESENTATION CONTRACT
- Output language: ${language}.
- Audience: ${blueprint.audience}.
- Recommended slide count: ${limits.min}–${limits.max}.
- Tone & style: ${blueprint.tone}
- Each slide MUST be short and visual. NO paragraphs. NO body of >40 words per slide. Prefer bullets (3-5 max), key messages, KPIs, tables (up to 5 columns), and callouts.
- The first slide MUST be a titleSlide. The last slide SHOULD be a closingSlide with concrete next steps.
- Include speakerNotes (1-3 sentences) on slides that warrant context — keep them short.
- Whenever a diagram is useful (architectureOverview / diagramFocused), provide a SHORT mermaid snippet in the diagram block. Otherwise omit diagram blocks.
- DO NOT produce executive-summary documents, README content, or DOCX-style prose. If you cannot find enough information for a slide, drop the slide instead of padding it with filler.

RECOMMENDED NARRATIVE ARC
${arc}

ALLOWED LAYOUTS
${SUPPORTED_LAYOUTS.join(', ')}

ALLOWED CONTENT BLOCK TYPES
text, bullets, table, diagram, imagePlaceholder, kpi, callout

OUTPUT FORMAT — STRICT JSON ONLY. RESPOND WITH ONE JSON OBJECT.
{
  "kind": "presentation",
  "version": "1.0.0",
  "title": "<deck title>",
  "audience": "${blueprint.audience}",
  "theme": "dark",
  "slides": [
    {
      "id": "slide-1",
      "slideNumber": 1,
      "title": "<slide title>",
      "subtitle": "<optional>",
      "layout": "titleSlide",
      "keyMessage": "<single sentence message>",
      "contentBlocks": [
        { "type": "text", "content": "<short paragraph>" },
        { "type": "bullets", "content": ["short bullet", "another bullet"] },
        { "type": "table", "content": { "headers": ["A","B"], "rows": [["1","2"]], "caption": "optional" } },
        { "type": "diagram", "content": { "mermaid": "flowchart TD\\nA-->B" } },
        { "type": "kpi", "content": [{ "label": "ROI","value": "12%","trend": "up" }] },
        { "type": "callout", "content": { "tone": "warning", "title": "Riesgo", "body": "<one sentence>" } },
        { "type": "imagePlaceholder", "content": "<descripcion de imagen sugerida>" }
      ],
      "speakerNotes": "<short>",
      "visualHints": ["dark background","accent color #6366f1"]
    }
  ],
  "metadata": {
    "templateId": "${template.type}",
    "generatedAt": "<ISO timestamp>",
    "preferredExports": ["pptx","pdf"]
  }
}

CRITICAL RULES
- Respond ONLY with the raw JSON object. No prose. No markdown fences. No commentary.
- Each \`contentBlocks\` array MUST be non-empty for non-divider slides (titleSlide / sectionDivider may be empty).
- Diagram blocks MUST contain valid Mermaid syntax (e.g. \`flowchart LR\`, \`sequenceDiagram\`). Keep them small (<= 10 nodes / 8 messages).
- Use the project context provided above this prompt to ground every slide in real signals. Avoid invented metrics — when a number is unknown, use a qualitative phrasing or drop the KPI.
${options.contextBlock ? `\nPROJECT CONTEXT FOR THIS DECK:\n${options.contextBlock}\n` : ''}`.trim();
};

/**
 * Gemini `responseSchema` for the presentation deck. Passing this keeps the
 * model on contract: the JSON shape is enforced and the parser barely has to
 * recover from drift.
 */
export const PRESENTATION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    kind: { type: 'string' },
    version: { type: 'string' },
    title: { type: 'string' },
    audience: { type: 'string' },
    theme: { type: 'string' },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          slideNumber: { type: 'number' },
          title: { type: 'string' },
          subtitle: { type: 'string' },
          purpose: { type: 'string' },
          layout: { type: 'string' },
          keyMessage: { type: 'string' },
          contentBlocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                // content is polymorphic; we deliberately omit a strict
                // sub-schema and let `parsePresentationDeck` coerce it.
              },
              required: ['type'],
            },
          },
          speakerNotes: { type: 'string' },
          visualHints: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'layout', 'contentBlocks'],
      },
    },
    metadata: {
      type: 'object',
      properties: {
        templateId: { type: 'string' },
        generatedAt: { type: 'string' },
        projectId: { type: 'string' },
        preferredExports: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  required: ['kind', 'title', 'audience', 'slides'],
};
