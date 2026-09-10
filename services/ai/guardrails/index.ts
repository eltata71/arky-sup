/**
 * Guardrails — the checks that run around a model call.
 *
 * Public surface of the subsystem. The rules themselves are pure functions over
 * text: they take no request, no provider and no settings, which is what lets
 * the same two rule sets serve the executor, the Office's handoff renderer and
 * anything else that composes a prompt, without any of them depending on the
 * others.
 */

export type {
  GuardrailFinding,
  GuardrailSeverity,
  GuardrailStage,
  GuardrailVerdict,
} from './guardrailTypes';
export { blockingFinding, isBlocking, verdictOf } from './guardrailTypes';
export { INJECTION_SIGNALS, findInjectionSignals } from './promptInjection';
export type { InjectionSignal } from './promptInjection';
export { evaluateInputGuardrails } from './inputGuardrails';
export type { GuardrailInput } from './inputGuardrails';
export { evaluateOutputGuardrails } from './outputGuardrails';
export type { GuardrailOutput } from './outputGuardrails';
