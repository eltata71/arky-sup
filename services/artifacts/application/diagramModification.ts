/**
 * Cambiar un diagrama con una frase, sin regenerarlo (plan de diagramas, 1.1).
 *
 * Hasta ahora todo cambio pedido a la IA era una regeneración: ids nuevos,
 * layout nuevo y ningún ajuste manual del arquitecto. El motor de patches
 * semánticos (ADR-006) y `diagramEditService` existían sin ninguna pantalla
 * que los llamara; esto es la mitad que faltaba entre ellos y el lienzo.
 *
 * Tres decisiones:
 *
 * 1. **Se propone sobre el IR completo, no sobre el que se ve.** La vista de
 *    una audiencia omite nodos a propósito; aplicar el cambio sobre ella y
 *    guardarlo borraría todo lo que la audiencia oculta
 *    (`resolveEditableDiagramIR`).
 * 2. **Se aplica sólo si hace lo que se previsualizó.** Al aplicar, el motor
 *    vuelve a correr sobre el IR actual; si el resultado difiere de la vista
 *    previa, la propuesta está obsoleta y no se guarda nada.
 * 3. **Se guarda como versión nueva.** La anterior queda en el historial, que
 *    es el deshacer. Las posiciones manuales viajan con los nodos, porque
 *    ninguna operación del vocabulario puede tocar una posición.
 *
 * Nada aquí escribe: devuelve lo que el lienzo necesita para versionar, y la
 * escritura sigue siendo del contexto, que es quien sabe revertirla.
 */

import type { Settings } from '../../../types';
import type { Artifact, ArtifactChangeNote } from '../../../lib/artifacts';
import type { DiagramIR, DiagramPatch, PatchApplication, PatchRejection } from '../../../lib/diagram';
import { diagramEditService } from '../../ai';
import { applySemanticPatch, irToMermaid, resolveEditableDiagramIR } from '../../diagram';
import { replaceMermaidBlock } from './artifactImprovement';

type EditableSource = Pick<Artifact, 'id' | 'type' | 'content' | 'representation' | 'ir'>;

export interface DiagramModificationProposal {
  readonly artifactId: string;
  /** Lo que pidió la persona: viaja a la nota de la versión (1.2). */
  readonly instruction: string;
  readonly patch: DiagramPatch;
  readonly applied: readonly PatchApplication[];
  readonly rejected: readonly PatchRejection[];
}

export type DiagramModificationOutcome =
  | { readonly kind: 'proposal'; readonly proposal: DiagramModificationProposal }
  | { readonly kind: 'refused'; readonly reason: string; readonly rejected: readonly PatchRejection[] }
  /** La persona canceló: no hay nada que decir sobre la salud del asistente. */
  | { readonly kind: 'cancelled' };

export type DiagramModificationPlan =
  | { readonly kind: 'stale' }
  | { readonly kind: 'no-change' }
  | {
      readonly kind: 'version';
      /** El artefacto a versionar: mismo grupo, IR y —si aplica— código nuevos. */
      readonly draft: Artifact;
      /** Lo que hizo el motor, en frases que la persona lee. */
      readonly summary: readonly string[];
    };

const NOTHING_TO_EDIT = 'Este artefacto no tiene un diagrama que se pueda modificar.';

/** ¿Hay un modelo sobre el que aplicar un cambio? */
export const canModifyDiagram = (artifact: EditableSource): boolean =>
  resolveEditableDiagramIR(artifact) !== null;

/**
 * Pide al asistente un cambio y devuelve la propuesta con la vista previa que
 * calcula el motor. Nunca aplica nada y nunca lanza.
 */
export const proposeDiagramModification = async (
  params: {
    readonly artifact: EditableSource & Pick<Artifact, 'name' | 'objective'>;
    readonly instruction: string;
  },
  settings: Settings,
  options: { readonly signal?: AbortSignal } = {},
): Promise<DiagramModificationOutcome> => {
  const { artifact, instruction } = params;
  const baseIR = resolveEditableDiagramIR(artifact);
  if (!baseIR) return { kind: 'refused', reason: NOTHING_TO_EDIT, rejected: [] };

  const context = [
    `Artefacto: ${artifact.name}`,
    artifact.objective ? `Objetivo: ${artifact.objective}` : null,
  ].filter(Boolean).join('\n');

  const result = await diagramEditService.proposeEdit(
    { ir: baseIR, instruction, context },
    settings,
    { signal: options.signal },
  );

  if (!result.ok || !result.patch || !result.preview) {
    if (result.reason === '') return { kind: 'cancelled' };
    return {
      kind: 'refused',
      reason: result.reason ?? 'El asistente no encontró un cambio que proponer.',
      rejected: result.preview?.rejected ?? [],
    };
  }

  return {
    kind: 'proposal',
    proposal: {
      artifactId: artifact.id,
      instruction: instruction.trim(),
      patch: result.patch,
      applied: result.preview.applied,
      rejected: result.preview.rejected,
    },
  };
};

const sameOutcome = (
  a: { readonly applied: readonly PatchApplication[]; readonly rejected: readonly PatchRejection[] },
  b: { readonly applied: readonly PatchApplication[]; readonly rejected: readonly PatchRejection[] },
): boolean => JSON.stringify([a.applied, a.rejected]) === JSON.stringify([b.applied, b.rejected]);

/**
 * Lo que se guarda al aplicar.
 *
 * El patch se aplica al IR **actual**, no a una copia vieja: entre proponer y
 * aplicar el lienzo puede haber guardado su plan de layout o la persona puede
 * haber movido un nodo, y aplicar sobre la copia desharía eso. Pero sólo si el
 * motor, sobre el IR actual, hace exactamente lo que se previsualizó — si no,
 * la vista previa ya no describe el cambio y aplicarlo sería autorizar otro
 * distinto del que la persona leyó (`stale`).
 *
 * El código Mermaid se regenera cuando el artefacto lo usa como
 * representación. C4 no se toca: su texto no se regenera desde el IR.
 *
 * La versión lleva su nota —qué se pidió y qué hizo el motor— para que el
 * historial diga algo más que «Versión 7» (1.2).
 */
export const planDiagramModification = (params: {
  readonly artifact: Artifact;
  readonly proposal: DiagramModificationProposal;
  readonly now?: () => string;
}): DiagramModificationPlan => {
  const { artifact, proposal } = params;
  const now = params.now ?? (() => new Date().toISOString());
  const current = proposal.artifactId === artifact.id ? resolveEditableDiagramIR(artifact) : null;
  if (!current) return { kind: 'stale' };

  const result = applySemanticPatch(current, proposal.patch);
  if (!sameOutcome(result, proposal)) return { kind: 'stale' };
  if (!result.changed) return { kind: 'no-change' };

  // La revisión de calidad guardada describe el diagrama anterior. Conservarla
  // haría que la puerta se saltara un diagrama que nadie ha revisado.
  const { qualityReview: _staleReview, ...metadata } = result.ir.metadata ?? { qualityReview: undefined };
  const ir: DiagramIR = { ...result.ir, metadata };

  let content = artifact.content;
  if (!artifact.type.startsWith('mermaid-c4-')) {
    try {
      if (artifact.type === 'hybrid-text-diagram') {
        content = replaceMermaidBlock(artifact.content, irToMermaid(ir));
      } else if (artifact.type.startsWith('mermaid') && artifact.representation === 'diagram') {
        content = irToMermaid(ir);
      }
    } catch (err) {
      // El IR es la fuente del lienzo: si el texto no se pudo regenerar, se
      // guarda el cambio igual y el código queda como estaba.
      console.warn('[diagramModification] no se pudo serializar a Mermaid', err);
    }
  }

  const summary = result.applied.map((entry) => entry.description);
  const changeNote: ArtifactChangeNote = {
    kind: 'diagram-patch',
    basedOnVersion: artifact.version,
    ...(proposal.instruction ? { instruction: proposal.instruction } : {}),
    ...(proposal.patch.rationale ? { rationale: proposal.patch.rationale } : {}),
    changes: summary,
    at: now(),
  };
  return { kind: 'version', draft: { ...artifact, ir, content, changeNote }, summary };
};
