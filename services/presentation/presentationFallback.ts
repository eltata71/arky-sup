/**
 * The minimal deck used when presentation generation fails or returns empty
 * content (F5-01, corte 12).
 *
 * It is a pure function over a project and a template — no model call in it —
 * so it lives beside the schema it produces rather than behind the AI layer:
 * a pure function that never calls a model does not live behind a door that
 * does. It always produces a parseable deck, so the slide viewer never blanks
 * out and the person gets a clear nudge to regenerate.
 */
import type { ArtifactTemplate } from '../../types';
import { PRESENTATION_SCHEMA_VERSION } from './presentationSchema';

/** What the fallback reads from the project: its id and its name. */
export interface PresentationFallbackProject {
  id: string;
  name: string;
}

export function buildMinimalPresentationDeck(
  project: PresentationFallbackProject,
  template: ArtifactTemplate,
): string {
  const audience: 'executive' | 'technical' | 'mixed' = template.type === 'presentation-technical'
    ? 'technical'
    : (template.type === 'presentation-executive' || template.type === 'presentation-summary' ? 'executive' : 'mixed');
  const deck = {
    kind: 'presentation' as const,
    version: PRESENTATION_SCHEMA_VERSION,
    title: template.name,
    audience,
    theme: 'dark' as const,
    slides: [
      {
        id: 'slide-1',
        slideNumber: 1,
        title: template.name,
        subtitle: project.name,
        layout: 'titleSlide' as const,
        keyMessage: 'Deck mínimo generado tras fallo de IA. Regenera para obtener un deck completo.',
        contentBlocks: [],
        visualHints: [],
      },
      {
        id: 'slide-2',
        slideNumber: 2,
        title: 'Objetivo',
        layout: 'executiveSummary' as const,
        contentBlocks: [
          { type: 'text' as const, content: template.objective },
        ],
        speakerNotes: 'Slide derivada del objetivo del template.',
      },
      {
        id: 'slide-3',
        slideNumber: 3,
        title: 'Próximos pasos',
        layout: 'closingSlide' as const,
        contentBlocks: [
          { type: 'bullets' as const, content: ['Regenerar el deck con más contexto del proyecto', 'Validar audiencia objetivo', 'Definir mensajes clave'] },
        ],
      },
    ],
    metadata: {
      templateId: template.type,
      generatedAt: new Date().toISOString(),
      projectId: project.id,
      preferredExports: template.preferredExports ?? ['pptx', 'pdf'],
    },
  };
  return JSON.stringify(deck, null, 2);
}
