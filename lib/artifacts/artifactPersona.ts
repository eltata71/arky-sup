/**
 * Who speaks when an artifact is generated (F5-01, corte 13).
 *
 * The generation prompt opens with the voice of an Office persona — Arky by
 * default, or the specialist the request names. Resolving that persona is the
 * Architecture Office's job, and the Office imports the AI layer, so the AI
 * layer cannot look the persona up: it declares what it needs — a function
 * that composes the instruction — and whoever calls it hands one over. It is
 * the same port `services/agent` declares with `AgentPersonaBriefing`.
 *
 * A contract with no behaviour, needed by the AI layer, the agent, the
 * artifacts context and the screens: it lives in a leaf.
 */
import type { DiagramIR } from '../diagram';
import type { ArtifactGenerationPhaseListener } from './artifactModel';

export type ArtifactPersonaComposer = (baseInstruction: string, request: string) => string;

/** Options of an artifact generation. */
export interface ArtifactGenerationOptions {
  onPhase?: ArtifactGenerationPhaseListener;
  architectureGraphPromptBlock?: string;
  /** Composes the Office persona over the base instruction; without it the base goes as it is. */
  composePersonaInstruction?: ArtifactPersonaComposer;
  /**
   * Receives the IR the model produced, when the path generates one (plan de
   * diagramas, 6.1). The content is a serialisation of it and a notation can
   * only carry part of an IR: without this the caller re-parses the text and
   * loses data classification, compliance and the story the model wrote.
   * Not called for a skeleton — that IR is the system's, not the model's.
   */
  onDiagramIR?: (ir: DiagramIR) => void;
}
