/**
 * The handoff envelope: what one agent hands to another, as a contract.
 *
 * Two handoffs already happen on every coordinated request — the coordinator
 * gives each specialist its workstream, and the assembled results go to the
 * consolidator — and both travelled as **concatenated strings**. The objective,
 * the coordination brief, the acceptance criteria and every prior result were
 * joined with newlines and handed over as one blob. That works until you want
 * to ask any of the questions a governed office has to answer: what exactly was
 * this agent asked for, what was it allowed to see, what was it supposed to
 * return, and under what budget.
 *
 * So the envelope is data and the prompt is derived from it. Three properties
 * follow from that and they are the reason to bother:
 *
 * - **An invalid handoff is refused before a token is spent.** The topology
 *   lives in the registry (`canHandOff`), so "the consolidator cannot hand work
 *   to a specialist" is checked rather than assumed.
 * - **Context travels as references, not as history.** The rule the brief names
 *   is "do not transfer the whole conversation indiscriminately", and a cap on
 *   the *number* of references is what makes it checkable. The cap is on count,
 *   not length: one long analysis is legitimate work, while forty turns of
 *   history is the failure mode.
 * - **The envelope carries its own correlation.** `runId` and `traceId` ride
 *   along, so a handoff joins the run it belonged to.
 */

import { newPrefixedId } from '../../lib/ids';
import type { ArtifactType } from '../../types';
import { wrapUntrustedContent } from '../../lib/untrustedContent';
import type { AgentHandoffKind, OfficeAgentId } from './agentDefinition';
import { canHandOff, getAgent } from './agentRegistry';

/**
 * One thing the receiving agent may look at.
 *
 * A reference, not a transcript: it names where the content came from and who
 * produced it, so the receiving prompt can attribute it and a reader can tell
 * what actually travelled.
 */
export interface HandoffContextReference {
  kind: 'coordination-brief' | 'workstream-result' | 'record';
  label: string;
  /** The agent whose work this is, when it is an agent's output. */
  from?: OfficeAgentId;
  status?: 'completed' | 'failed';
  content: string;
}

export interface HandoffExpectedOutput {
  kind: 'analysis' | 'recommendation' | 'artifact';
  /** What "done" looks like, in one line. */
  description: string;
  artifactType?: ArtifactType;
}

/** The ceiling this handoff may consume. Never unbounded. */
export interface HandoffBudget {
  maxAiCalls: number;
}

export interface AgentHandoffEnvelope {
  handoffId: string;
  kind: AgentHandoffKind;
  sourceAgentId: OfficeAgentId;
  targetAgentId: OfficeAgentId;
  /** Why this handoff exists, in the words a person would use. */
  reason: string;
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
  contextReferences: HandoffContextReference[];
  expectedOutput: HandoffExpectedOutput;
  budget: HandoffBudget;
  /** The execution attempt this handoff belongs to, when there is one. */
  runId?: string;
  /** Correlation id of the invocation it produced, once known. */
  traceId?: string;
  issuedAt: string;
}

export type HandoffRejectionCode =
  | 'same-agent'
  | 'topology-not-allowed'
  | 'missing-objective'
  | 'missing-expected-output'
  | 'no-budget'
  | 'context-overflow';

export interface HandoffRejection {
  code: HandoffRejectionCode;
  message: string;
}

/**
 * How many references a handoff may carry.
 *
 * Generous against the shape the Office actually produces — a consolidation
 * carries at most `DEFAULT_MAX_SPECIALISTS` (4) results plus the coordination
 * brief — because the cap exists to make "do not hand over the whole history"
 * checkable, not to squeeze legitimate work.
 */
export const MAX_HANDOFF_CONTEXT_REFERENCES = 16;

/** Everything wrong with this handoff, in terms a maintainer can act on. */
export const validateHandoff = (
  envelope: Omit<AgentHandoffEnvelope, 'handoffId' | 'issuedAt'>,
): HandoffRejection[] => {
  const rejections: HandoffRejection[] = [];
  const fail = (code: HandoffRejectionCode, message: string): void => {
    rejections.push({ code, message });
  };

  if (envelope.sourceAgentId === envelope.targetAgentId) {
    fail('same-agent', 'Un agente no puede entregarse trabajo a sí mismo.');
  } else if (!canHandOff(envelope.sourceAgentId, envelope.targetAgentId, envelope.kind)) {
    const source = getAgent(envelope.sourceAgentId);
    const target = getAgent(envelope.targetAgentId);
    fail(
      'topology-not-allowed',
      `${source.alias} (${source.orchestrationRole}) no puede entregar un handoff de tipo `
      + `"${envelope.kind}" a ${target.alias} (${target.orchestrationRole}).`,
    );
  }

  if (!envelope.objective.trim()) {
    fail('missing-objective', 'Un handoff sin objetivo es una petición que nadie puede cumplir.');
  }
  if (!envelope.expectedOutput.description.trim()) {
    fail('missing-expected-output', 'El handoff no dice qué se espera de vuelta.');
  }
  if (!Number.isFinite(envelope.budget.maxAiCalls) || envelope.budget.maxAiCalls < 1) {
    fail('no-budget', 'Un handoff sin presupuesto no tiene condición de parada.');
  }
  if (envelope.contextReferences.length > MAX_HANDOFF_CONTEXT_REFERENCES) {
    fail(
      'context-overflow',
      `El handoff lleva ${envelope.contextReferences.length} referencias de contexto; `
      + `el máximo es ${MAX_HANDOFF_CONTEXT_REFERENCES}. Pasar el historial entero no es contexto.`,
    );
  }

  return rejections;
};

export type HandoffCreation =
  | { outcome: 'issued'; envelope: AgentHandoffEnvelope }
  | { outcome: 'rejected'; rejections: HandoffRejection[] };

/**
 * Build a handoff, or refuse it.
 *
 * Returns a typed result rather than throwing, for the reason every factory in
 * this repository does: a refused handoff is an outcome the orchestration
 * renders and records, and a `throw` would push each caller into a `try` that
 * most would write empty.
 */
export const createHandoff = (
  input: Omit<AgentHandoffEnvelope, 'handoffId' | 'issuedAt'>,
): HandoffCreation => {
  const rejections = validateHandoff(input);
  if (rejections.length > 0) return { outcome: 'rejected', rejections };
  return {
    outcome: 'issued',
    envelope: { ...input, handoffId: newPrefixedId('handoff'), issuedAt: new Date().toISOString() },
  };
};

/**
 * The prompt this envelope becomes.
 *
 * Derived, never stored: the envelope is the contract and the prompt is one
 * rendering of it. Keeping the string as the source is what made "what was this
 * agent actually asked?" unanswerable without re-reading the concatenation that
 * produced it.
 */
export const renderHandoffPrompt = (envelope: AgentHandoffEnvelope): string => {
  const source = getAgent(envelope.sourceAgentId);
  const lines: string[] = [
    `Encargo de ${source.alias} (${source.role}).`,
    `Motivo: ${envelope.reason}`,
    '',
    `Objetivo: ${envelope.objective}`,
  ];

  if (envelope.constraints.length > 0) {
    lines.push('', 'Restricciones:', ...envelope.constraints.map((item) => `- ${item}`));
  }
  if (envelope.acceptanceCriteria.length > 0) {
    lines.push('', 'Criterios de aceptación:', ...envelope.acceptanceCriteria.map((item) => `- ${item}`));
  }
  // Every reference is content this application did not write — an artifact's
  // body, an uploaded document, another agent's answer over either of those.
  // It travels fenced so the receiving model is told it is material to analyse
  // rather than instructions to follow. The attribution stays outside the
  // fence: who produced the work is the Office speaking, and putting it inside
  // would let the content claim its own author.
  for (const reference of envelope.contextReferences) {
    const attribution = `${reference.label}`
      + `${reference.from ? ` — ${getAgent(reference.from).alias}` : ''}`
      + `${reference.status ? ` (${reference.status})` : ''}`;
    lines.push('', `### ${attribution}`, wrapUntrustedContent(attribution, reference.content));
  }
  lines.push('', `Se espera de vuelta: ${envelope.expectedOutput.description}`);

  return lines.join('\n');
};
