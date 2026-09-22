/**
 * Cómo se mejora un artefacto desde el lienzo (F4-05).
 *
 * `ArtifactCanvas` decidía aquí, entre dos ramas de JSX, cuatro cosas que no
 * son de pintar: cómo se aplica la puerta de calidad de un diagrama y qué se
 * guarda de ella, cuándo una «auto-mejora» no mejoró nada, qué forma tiene un
 * artefacto derivado —casos de prueba, documento— y cómo se traduce una
 * sugerencia al vocabulario de la revisión. Para ello importaba de cinco
 * módulos de servicio. Una pantalla que importa cinco *es* la capa de
 * aplicación de esa pantalla, escrita donde no se puede probar sin montarla.
 *
 * Lo determinista (`planDiagramAutoImprove`, los borradores) es puro. Lo que
 * llama a un modelo está marcado como tal y devuelve lo que el lienzo necesita
 * para crear o versionar — nunca escribe: la escritura sigue siendo del
 * contexto, que es quien sabe revertirla.
 */

import type { Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramAudience, DiagramIR } from '../../../lib/diagram';
import type { Project } from '../../architectureProjects';
import type { ArtifactReviewSuggestion } from '../../review';
import { artifactGenerationService, documentGenerationService } from '../../ai';
import type { ArtifactSuggestionGapType } from '../../ai/artifactSuggestionService';
import { irToMermaid } from '../../diagram';
import { runDiagramQualityGate } from '../../diagram/qualityGate';
import type { NewArtifactDraft } from '../artifactFactory';

// ─────────────────────────────────────── auto-mejora determinista de un diagrama

export type DiagramAutoImprovePlan =
  /** La puerta no reparó nada ni subió la nota: guardar sería una versión vacía. */
  | { readonly kind: 'no-change'; readonly beforeScore: number; readonly afterScore: number }
  | {
      readonly kind: 'patch';
      readonly patch: Partial<Artifact>;
      readonly beforeScore: number;
      readonly afterScore: number;
      readonly changes: number;
      readonly reachedTarget: boolean;
    };

/** Reemplaza (o añade) el bloque ```mermaid``` de un contenido. */
export const replaceMermaidBlock = (content: string, mermaid: string): string => {
  const fenced = /```mermaid\s*[\s\S]*?```/m;
  if (fenced.test(content)) return content.replace(fenced, `\`\`\`mermaid\n${mermaid}\n\`\`\``);
  return mermaid;
};

/**
 * La «auto-mejora» del lienzo: la puerta de calidad determinista, sin modelo.
 *
 * Guarda el IR reparado con su revisión de calidad en los metadatos y, si el
 * diagrama se representa en Mermaid —y no es C4, cuyo texto no se regenera
 * desde el IR—, también el código. Si la puerta no cambió nada y la nota no
 * subió, lo dice en vez de guardar: una versión idéntica anunciada como mejora
 * es una mentira pequeña que el usuario descubre comparando.
 */
export const planDiagramAutoImprove = (params: {
  readonly artifact: Artifact;
  readonly ir: DiagramIR;
  readonly audience: DiagramAudience;
  readonly beforeScore: number;
}): DiagramAutoImprovePlan => {
  const { artifact, ir, audience, beforeScore } = params;
  const gate = runDiagramQualityGate(ir, {
    artifact: {
      name: artifact.name,
      type: artifact.type,
      objective: artifact.objective,
      audience: artifact.audience,
      theme: artifact.theme,
    },
    audience,
    targetScore: 90,
    maxPasses: 4,
    aggressive: true,
  });

  if (gate.changes.length === 0 && gate.quality.score <= beforeScore) {
    return { kind: 'no-change', beforeScore, afterScore: gate.quality.score };
  }

  const improvedIR: DiagramIR = {
    ...gate.ir,
    metadata: {
      ...(gate.ir.metadata ?? {}),
      qualityReview: {
        score: gate.quality.score,
        issues: gate.quality.issues.map((issue) => ({
          severity: issue.severity,
          message: issue.message,
          recommendation: issue.recommendation,
        })),
      },
    },
  };

  const patch: Partial<Artifact> = { ir: improvedIR };
  if (!artifact.type.startsWith('mermaid-c4-')) {
    try {
      const code = irToMermaid(improvedIR);
      if (artifact.type === 'hybrid-text-diagram') {
        patch.content = replaceMermaidBlock(artifact.content, code);
      } else if (artifact.type.startsWith('mermaid') && artifact.representation === 'diagram') {
        patch.content = code;
      }
    } catch (err) {
      // El IR reparado se guarda igual: perder la reparación porque el texto no
      // se pudo regenerar sería peor que guardar el texto anterior.
      console.warn('[artifactImprovement] auto-improve failed to serialize Mermaid', err);
    }
  }

  return {
    kind: 'patch',
    patch,
    beforeScore,
    afterScore: gate.quality.score,
    changes: gate.changes.length,
    reachedTarget: gate.reachedTarget,
  };
};

// ────────────────────────────────────────────────── artefactos derivados

/** Los casos de prueba de un artefacto, como borrador de un artefacto nuevo. */
export const testCasesDraft = (source: Artifact, content: string): NewArtifactDraft => ({
  name: `Casos de Prueba: ${source.name}`,
  type: 'markdown',
  phase: 'Validación y Pruebas',
  architecturalView: 'Vista de Calidad y Validación',
  content,
  objective: `Casos de prueba automatizados para validar el artefacto ${source.name}.`,
  keyConcepts: source.keyConcepts,
  representation: 'document',
  isFavorite: false,
});

/** Un diagrama descrito como documento, como borrador de un artefacto nuevo. */
export const documentFromDiagramDraft = (source: Artifact, content: string): NewArtifactDraft => ({
  name: `Documento: ${source.name}`,
  type: 'markdown',
  phase: source.phase,
  architecturalView: source.architecturalView,
  content,
  objective: `Descripción en documento del diagrama ${source.name}.`,
  keyConcepts: source.keyConcepts,
  representation: 'document',
  isFavorite: false,
});

/** **Llama a un modelo.** Genera los casos de prueba y devuelve el borrador. */
export const draftTestCases = async (artifact: Artifact, project: Project, settings: Settings): Promise<NewArtifactDraft> =>
  testCasesDraft(artifact, await artifactGenerationService.generateTestCases(artifact, project, settings));

/** **Llama a un modelo.** Describe el diagrama como documento y devuelve el borrador. */
export const draftDocumentFromDiagram = async (artifact: Artifact, project: Project, settings: Settings): Promise<NewArtifactDraft> =>
  documentFromDiagramDraft(artifact, await documentGenerationService.convertDiagramToDocument(artifact, project, settings));

// ──────────────────────────────────────────── mejorar con las sugerencias

/** Una sugerencia del panel, traducida a la categoría de la revisión. */
const GAP_TO_REVIEW_CATEGORY: Record<ArtifactSuggestionGapType, ArtifactReviewSuggestion['category']> = {
  security: 'Security',
  data: 'Scalability',
  integration: 'Best Practices',
  technical: 'Best Practices',
  architecture: 'Best Practices',
  business: 'Clarity',
  'ux-ui': 'Clarity',
  documentation: 'Clarity',
  diagram: 'Clarity',
  traceability: 'Clarity',
};

export interface ArtifactSuggestionForImprovement {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly recommendedAction: string;
  readonly gapType: ArtifactSuggestionGapType;
}

export const toReviewSuggestions = (
  suggestions: readonly ArtifactSuggestionForImprovement[],
): ArtifactReviewSuggestion[] => suggestions.map((item) => ({
  id: item.id,
  title: item.title,
  description: `${item.description} Acción recomendada: ${item.recommendedAction}`,
  category: GAP_TO_REVIEW_CATEGORY[item.gapType],
}));

/**
 * **Llama a un modelo.** Reescribe el artefacto aplicando las sugerencias.
 *
 * Devuelve el contenido nuevo, o `null` cuando el modelo no propuso nada que
 * aplicar —vacío o idéntico al actual—. Guardar eso como versión nueva sería
 * anunciar una mejora que no existe.
 */
export const improveWithSuggestions = async (
  artifact: Artifact,
  suggestions: readonly ArtifactSuggestionForImprovement[],
  project: Project,
  settings: Settings,
): Promise<string | null> => {
  const content = await artifactGenerationService.applyArtifactImprovements(
    artifact,
    toReviewSuggestions(suggestions),
    project,
    settings,
  );
  const trimmed = (content ?? '').trim();
  if (!trimmed || trimmed === artifact.content.trim()) return null;
  return content;
};
