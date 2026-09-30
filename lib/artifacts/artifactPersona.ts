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

/**
 * Why the artifact exists, in the business's words (plan de diagramas, 6.2).
 *
 * A project answers an initiative, and the initiative is where the need, the
 * outcomes and the indicators live. The generation used to see only the
 * project, so an executive diagram could describe a topology but never the
 * value it serves. The AI layer cannot look initiatives up — their context
 * imports nothing of it and must stay that way — so it declares this shape
 * and the caller, which resolves the project's initiatives by the portfolio
 * rule, hands one over per initiative. Plain strings on purpose: this is what
 * the prompt reads, not the aggregate.
 */
export interface ArtifactBusinessMotivation {
  title: string;
  code?: string;
  need: string;
  driver?: string;
  objectives: readonly string[];
  expectedOutcomes: readonly string[];
  /** Each rendered with its unit and target, e.g. «Tiempo de adjudicación (días) → 3». */
  kpis: readonly string[];
  regulatoryDrivers: readonly string[];
  /**
   * What THIS project moves in the initiative — its declared contributions,
   * with the outcomes and KPIs they point at resolved by id (plan de calidad
   * de artefactos, 7.3c). Absent when the project declares none: then every
   * outcome and KPI above reads as equally the project's, which is how it was.
   */
  projectContribution?: {
    statements: readonly string[];
    outcomes: readonly string[];
    kpis: readonly string[];
  };
}

/**
 * The deliverable an artifact is produced for, as a prompt needs it (7.3c).
 * The Office supplies it; the AI layer only reads this shape. A generation
 * from the Workspace used to know nothing of the request the committee made:
 * its constraints, what is out of scope, what the ARB asked to change.
 */
export interface ArtifactDeliverableContext {
  title: string;
  /** The original request, verbatim. */
  brief: string;
  status: string;
  objectives: readonly string[];
  scope: readonly string[];
  outOfScope: readonly string[];
  constraints: readonly string[];
  regulatoryDrivers: readonly string[];
  /** The review board's last observation, when it asked for changes. */
  arbObservation?: string;
}

/**
 * What the conversation with the agent settled, as a prompt needs it (plan de
 * calidad de artefactos, 7.3b). A decision said in the chat used to reach a
 * generation only if somebody wrote «guarda esto»; the chat history is off by
 * default. The chat context extracts it without a model; the AI layer only
 * reads this shape, so it imports no chat.
 */
export interface ArtifactConversationDigest {
  /** Explicit decisions, most recent first. */
  decisions: readonly string[];
}

/**
 * What only other contexts know about the artifact being produced, handed in
 * as data (plan de calidad de artefactos, 7.3): why the project exists, what
 * the conversation settled and the deliverables it is produced for. One
 * object, so a new port is one field here and not one parameter in every
 * layer that passes it on.
 */
export interface ArtifactContextPorts {
  /** The initiatives the project answers, with what this project moves in each. */
  businessMotivation?: readonly ArtifactBusinessMotivation[];
  /** What the conversation with the agent settled (7.3b). */
  conversation?: ArtifactConversationDigest;
  /** The open deliverables of the project (7.3c). */
  deliverables?: readonly ArtifactDeliverableContext[];
}

/** Options of an artifact generation. */
export interface ArtifactGenerationOptions extends ArtifactContextPorts {
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

  /**
   * Told, in one Spanish sentence, when a path saved something other than
   * what was asked — a skeleton, or another notation (plan de diagramas,
   * 6.3). These used to be console lines only; a degradation the person does
   * not hear about is one they present as their work.
   */
  onDegraded?: (message: string) => void;
}
