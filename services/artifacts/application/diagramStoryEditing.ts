/**
 * Escribir la historia de un diagrama (plan de diagramas, 4.3).
 *
 * El modo presentación recorre la historia del IR si alguien la escribió y la
 * deriva de la topología si no. Hasta ahora sólo un modelo podía escribirla:
 * la persona que presenta no tenía forma de decir qué se cuenta primero, qué
 * pasos sobran o qué no hay que perderse. Este es el editor.
 *
 * Tres reglas:
 *
 * 1. **Todo pasa por el motor de patches.** Cada gesto del editor es una
 *    operación (`add-scene`, `move-scene`, `add-callout`…) que el motor valida;
 *    el borrador es el resultado de aplicarlas, y lo que se guarda es lo mismo
 *    que se previsualizó.
 * 2. **Una historia escrita queda marcada `authored` y gana a la derivada.**
 *    Lo hace el motor en la primera operación de historia; si la narrativa era
 *    la que compuso la reparación, su resumen se retira y se dice.
 * 3. **Se guarda como una versión, con su nota**, y sólo si el diagrama no
 *    cambió por debajo mientras se editaba: si el motor, sobre el IR actual,
 *    no hace exactamente lo mismo, el borrador está obsoleto.
 *
 * Nada aquí escribe: el lienzo versiona con lo que devuelve `planStoryEdit`.
 */

import type { Artifact, ArtifactChangeNote } from '../../../lib/artifacts';
import type {
  DiagramCallout,
  DiagramIR,
  DiagramNarrative,
  DiagramPatchOperation,
  DiagramScene,
  PatchApplication,
  PatchRejection,
} from '../../../lib/diagram';
import { applySemanticPatch, resolveEditableDiagramIR } from '../../diagram';

type StorySource = Pick<Artifact, 'type' | 'content' | 'representation' | 'ir'>;

export type StoryAuthorship = 'authored' | 'derived' | 'none';

export interface StoryDraft {
  readonly authorship: StoryAuthorship;
  readonly message: string;
  readonly scenes: readonly DiagramScene[];
  readonly callouts: readonly DiagramCallout[];
  /** Lo que se puede enfocar o anotar, con su nombre legible. */
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly edges: ReadonlyArray<{ readonly id: string; readonly label: string }>;
}

const narrativeOf = (ir: DiagramIR): DiagramNarrative | null => {
  const narrative = ir.metadata?.narrative;
  if (!narrative) return null;
  return typeof narrative === 'string' ? { summary: narrative } : narrative;
};

/** La historia tal y como está en un IR, en la forma que lee el editor. */
export const readStoryDraft = (ir: DiagramIR): StoryDraft => {
  const narrative = narrativeOf(ir);
  const message = (narrative?.summary ?? '').trim();
  const scenes = narrative?.scenes ?? [];
  const callouts = narrative?.callouts ?? [];
  const hasStory = message.length > 0 || scenes.length > 0 || callouts.length > 0;
  const labels = new Map(ir.nodes.map((node) => [node.id, node.label] as const));
  return {
    authorship: !hasStory ? 'none' : narrative?.source === 'derived' ? 'derived' : 'authored',
    message,
    scenes,
    callouts,
    nodes: ir.nodes.map((node) => ({ id: node.id, label: node.label })),
    edges: ir.edges.map((edge) => ({
      id: edge.id,
      label: `${labels.get(edge.source) ?? edge.source} → ${labels.get(edge.target) ?? edge.target}${edge.label ? ` (${edge.label})` : ''}`,
    })),
  };
};

/** El IR sobre el que se edita: el completo, nunca la vista de una audiencia. */
export const resolveStoryBase = (artifact: StorySource): DiagramIR | null => resolveEditableDiagramIR(artifact);

export interface StoryPreview {
  readonly ir: DiagramIR;
  readonly draft: StoryDraft;
  readonly applied: readonly PatchApplication[];
  readonly rejected: readonly PatchRejection[];
}

/** El borrador: el IR base con las operaciones del editor aplicadas por el motor. */
export const previewStoryEdit = (base: DiagramIR, operations: readonly DiagramPatchOperation[]): StoryPreview => {
  const result = applySemanticPatch(base, { id: 'story-edit', source: 'user', operations: [...operations] });
  return { ir: result.ir, draft: readStoryDraft(result.ir), applied: result.applied, rejected: result.rejected };
};

/**
 * ¿Añade algo esta operación al borrador? El editor la descarta si el motor la
 * rechaza —una escena sin título, un mensaje igual al que ya hay— en vez de
 * acumular gestos que no harán nada al guardar.
 */
export const acceptsStoryOperation = (working: DiagramIR, operation: DiagramPatchOperation): PatchRejection | null => {
  const result = applySemanticPatch(working, { id: 'story-probe', source: 'user', operations: [operation] });
  return result.rejected[0] ?? null;
};

export type StoryEditPlan =
  | { readonly kind: 'stale' }
  | { readonly kind: 'no-change' }
  | { readonly kind: 'version'; readonly draft: Artifact; readonly summary: readonly string[] };

const sameOutcome = (a: Pick<StoryPreview, 'applied' | 'rejected'>, b: Pick<StoryPreview, 'applied' | 'rejected'>): boolean =>
  JSON.stringify([a.applied, a.rejected]) === JSON.stringify([b.applied, b.rejected]);

/**
 * Lo que se guarda. Las operaciones se aplican al IR **actual** del artefacto
 * —no al que había cuando se abrió el editor— y sólo si el motor hace sobre él
 * exactamente lo mismo que en el borrador.
 */
export const planStoryEdit = (params: {
  readonly artifact: Artifact;
  readonly preview: Pick<StoryPreview, 'applied' | 'rejected'>;
  readonly operations: readonly DiagramPatchOperation[];
  readonly now?: () => string;
}): StoryEditPlan => {
  const { artifact, preview, operations } = params;
  const now = params.now ?? (() => new Date().toISOString());
  if (operations.length === 0) return { kind: 'no-change' };
  const current = resolveStoryBase(artifact);
  if (!current) return { kind: 'stale' };
  const result = applySemanticPatch(current, { id: 'story-edit', source: 'user', operations: [...operations] });
  if (!sameOutcome(result, preview)) return { kind: 'stale' };
  if (!result.changed) return { kind: 'no-change' };

  // La revisión guardada puntuó la narrativa anterior.
  const { qualityReview: _staleReview, ...metadata } = result.ir.metadata ?? { qualityReview: undefined };
  const summary = result.applied.map((entry) => entry.description);
  const changeNote: ArtifactChangeNote = {
    kind: 'diagram-patch',
    basedOnVersion: artifact.version,
    instruction: 'Historia editada a mano',
    changes: summary,
    at: now(),
  };
  return { kind: 'version', draft: { ...artifact, ir: { ...result.ir, metadata }, changeNote }, summary };
};
