/**
 * The contract between a form that needs help and the assistant that gives it.
 *
 * This lives in `lib/` — the layer with no dependencies — for the reason
 * `CLAUDE.md` states: *a contract with no behaviour moves down to a leaf*. Three
 * different modules need these shapes and none of them should have to import
 * either of the others to get them:
 *
 *   - `services/architectureOffice/application/captureAssistance` composes the
 *     request (what to ask, in whose voice, with which context),
 *   - `services/ai/generation/capture` executes it (how to talk to a model),
 *   - `hooks/useCaptureAssistant` and the field buttons render the outcome.
 *
 * The split matters more than it looks. Assisted capture is a **single-agent**
 * capability by design: completing a form field is not a problem that needs a
 * coordinator, four specialists and a consolidator — it needs one architect who
 * knows the discipline and the record in front of them. Anthropic's guidance on
 * building agents is explicit that the pattern should be the simplest one that
 * solves the task, and this is the simplest one. The Office's full team stays
 * where it earns its cost: a real architectural question, answered from several
 * domains at once.
 */

import type { ModelTier } from '../ai/modelCatalog';

/** The level of the hierarchy the form belongs to. */
export type CaptureLevel = 'initiative' | 'attention' | 'deliverable';

/**
 * What a field holds.
 *
 *  - `text` — one prose value (a driver, a description). Exactly one suggestion.
 *  - `list` — several short independent entries (objectives, risks). The user
 *    picks the ones they want; the assistant never replaces the whole list.
 */
export type CaptureFieldShape = 'text' | 'list';

export type CaptureFieldId =
  | 'initiative.title'
  | 'initiative.need'
  | 'initiative.driver'
  | 'initiative.objectives'
  | 'initiative.outcomes'
  | 'initiative.kpis'
  | 'initiative.risks'
  | 'initiative.milestones'
  | 'initiative.stakeholders'
  | 'attention.name'
  | 'attention.description'
  | 'attention.context'
  | 'deliverable.title'
  | 'deliverable.brief';

export interface CaptureFieldSpec {
  id: CaptureFieldId;
  level: CaptureLevel;
  /** How the field is named on screen, so the suggestion can be attributed. */
  label: string;
  /** The question the field actually asks, in the user's words. */
  question: string;
  shape: CaptureFieldShape;
  /** What a good answer looks like. Travels verbatim into the prompt. */
  guidance: string;
  /**
   * What the assistant may not do here. These are the rules of the discipline,
   * not style preferences: an objective that describes a technology has moved
   * the decision from the initiative to the architecture, which is the mistake
   * this vocabulary exists to prevent.
   */
  constraints: string[];
  /** Upper bound for a `list` field. Ignored for `text`. */
  maxSuggestions: number;
}

/** One thing already known about the record, shown to the assistant as context. */
export interface CaptureContextLine {
  label: string;
  value: string;
}

/**
 * Everything the assistant is told about the record being filled in.
 *
 * Assembled by the level that owns the record, never by the component: a screen
 * that builds its own prompt context is a screen that will drift from the next
 * one. Blank values are dropped when the context is built — an empty
 * `Driver: ` reads to a model as a driver somebody considered and left out.
 */
export interface CaptureContext {
  level: CaptureLevel;
  /** The record's name, or an empty string when it does not have one yet. */
  subject: string;
  known: CaptureContextLine[];
  /** The levels above, outermost first. A project without its initiative loses its reason. */
  ancestry: CaptureContextLine[];
}

export interface CaptureSuggestionRequest {
  level: CaptureLevel;
  /** One field for a field button, several for the whole-form button. */
  fields: CaptureFieldSpec[];
  context: CaptureContext;
  /**
   * Who is answering: the persona's identity, capabilities and the standards
   * it upholds, composed by the domain from the configured agent profile.
   * The assistant is the architect agent, not an anonymous model.
   */
  agentBriefing: string[];
  /** What the user already wrote, keyed by field id, when they asked to improve it. */
  current?: Partial<Record<CaptureFieldId, string>>;
  /**
   * Which tier the agent runs at. Comes from the agent's configured profile —
   * the user chooses how much model an agent gets — and defaults to `default`.
   * A tier, never a concrete model id: naming a model outside a provider is
   * what `lib/ai` exists to prevent.
   */
  modelTier?: ModelTier;
}

export interface CaptureFieldSuggestion {
  fieldId: CaptureFieldId;
  /** One entry for a `text` field, up to `maxSuggestions` for a `list`. */
  values: string[];
  /** One line saying why, so the user can judge instead of just accepting. */
  rationale?: string;
}

export interface CaptureSuggestionResult {
  ok: boolean;
  suggestions: CaptureFieldSuggestion[];
  /**
   * What the assistant could not deduce from the context and refuses to invent.
   * Surfacing these is the difference between an assistant and a plausible
   * text generator.
   */
  openQuestions: string[];
  /** Spanish, user-facing. Always set when `ok` is false. */
  reason?: string;
}

/**
 * How much context a request carries, measured in characters of real content.
 *
 * Used by the guardrail below rather than by the prompt: the number itself is
 * not interesting, the threshold is.
 */
export const captureContextWeight = (context: CaptureContext): number => {
  const lines = [...context.known, ...context.ancestry];
  return context.subject.trim().length
    + lines.reduce((total, line) => total + line.value.trim().length, 0);
};

/** Below this, there is nothing to reason from and a suggestion would be fiction. */
export const MIN_CAPTURE_CONTEXT = 24;

/**
 * The guardrail that stops an empty form producing confident nonsense.
 *
 * A model asked to propose objectives for a record with no name, no need and no
 * parent will produce objectives — generic, plausible and about nothing. That
 * output is worse than no output, because it looks like work. So the call is
 * refused before it is made, with the sentence that says what to write first.
 */
export const describeInsufficientContext = (
  request: Pick<CaptureSuggestionRequest, 'context' | 'level'>,
): string | null => {
  if (captureContextWeight(request.context) >= MIN_CAPTURE_CONTEXT) return null;
  const starter = request.level === 'initiative'
    ? 'la necesidad del negocio'
    : request.level === 'attention'
      ? 'el nombre y el objetivo del proyecto'
      : 'el título y el brief del entregable';
  return `Escribe primero ${starter}: el asistente propone estructura a partir de lo que ya dice el registro, no lo inventa desde cero.`;
};
