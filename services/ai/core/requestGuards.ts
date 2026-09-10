/**
 * The checks a request passes before it becomes a provider call, and the one
 * its answer passes before it becomes an artifact.
 *
 * Free functions rather than methods on `AIRequestExecutor`, for the reason the
 * executor's docblock gives about `providerFor`: the executor is a shared
 * singleton, and a guard that reads nothing from `this` has no business
 * pretending it does. It also keeps the class to what it orchestrates — route,
 * timeout, retry, advance — rather than growing a second job every time a rule
 * is added.
 *
 * Every guard here has the same two properties, and they are the point:
 *
 *  - it runs **before** the attempt loop, so a refusal costs zero tokens rather
 *    than one call per candidate in the fallback chain;
 *  - it fails as an `AIError` carrying a sealed trace, so every existing caller
 *    already handles it and the refusal is as observable as any other outcome.
 */

import { blockingFinding, evaluateInputGuardrails, evaluateOutputGuardrails } from '../guardrails';
import type { GuardrailFinding } from '../guardrails';
import type { AIProviderId } from './AIModel';
import type { AIPolicy } from './AIPolicy';
import type { AIProvider } from './AIProvider';
import type { AIRequest } from './AIRequest';
import { collapsePrompt } from './AIRequest';
import { AIError } from './AIError';
import type { AITrace } from './AITrace';
import type { AITraceBuilder } from '../tracing/AITraceBuilder';

/** Attach a sealed trace to a thrown AIError so callers can record it. */
export function attachTrace(error: AIError, trace: AITrace): AIError {
  (error as AIError & { trace?: AITrace }).trace = trace;
  return error;
}

/**
 * Refuse a prompt larger than the policy allows.
 *
 * Not a guardrail in the security sense — it is a cost and a context-window
 * control — but it belongs beside them because it answers the same question at
 * the same moment: is this request allowed to leave?
 */
export function guardPromptSize(
  request: AIRequest,
  policy: AIPolicy,
  provider: AIProvider,
  trace: AITraceBuilder,
): void {
  const promptLength = collapsePrompt(request.prompt, request.systemInstruction).length;
  if (policy.maxPromptChars && promptLength > policy.maxPromptChars) {
    const aiError = new AIError({
      category: 'invalid-request',
      provider: provider.id,
      message: `Prompt size ${promptLength} exceeds maxPromptChars ${policy.maxPromptChars}.`,
      userMessage:
        'El contexto enviado al modelo es demasiado grande. Reduce el contexto y reintenta.',
      retryable: false,
      errorCode: 'prompt_too_large',
    });
    throw attachTrace(aiError, trace.error('invalid-request'));
  }
}

/**
 * Input guardrails — run once, before the attempt loop.
 *
 * Position matters more than the rules do. This is upstream of the retry
 * policy, the model chain and the provider fallback, so a blocked request
 * costs exactly zero calls instead of one per candidate; and it is inside the
 * executor rather than in each façade because the executor is the single seam
 * every canonical generation passes through.
 *
 * A block becomes an `AIError` like any other failure, so every existing
 * caller already handles it. `retryable` carries the severity's meaning:
 * `recoverable-block` says the same request would fail again but a corrected
 * one would not, `hard-block` says do not send this anywhere.
 */
export function guardRequest(request: AIRequest, provider: AIProvider, trace: AITraceBuilder): void {
  assertPromptAllowed(
    request.purpose,
    collapsePrompt(request.prompt, request.systemInstruction),
    provider.id,
    {
      // Recorded before the throw, and that ordering is the whole reason this
      // is a callback rather than a return value. A refusal whose trace says
      // `invalid-request` and nothing else is a refusal nobody can explain:
      // the finding naming the rule is the only part worth keeping.
      onFindings: (findings) => trace.recordGuardrailFindings(findings),
      decorate: (error) => attachTrace(error, trace.error('invalid-request')),
    },
  );
}

/**
 * Refuse a prompt that must not travel, wherever it is about to travel from.
 *
 * Separate from `guardRequest` because two paths reach a provider without an
 * `AITrace`: the serverless proxy client, and the legacy façade's own model
 * chain. Both compose prompts out of the same artifacts and documents as the
 * canonical path, so exempting them would leave the largest prompt surface in
 * the product ungoverned while the docs said otherwise.
 *
 * Reports every finding through `onFindings` — blocking ones included, before
 * the throw — and then throws if any of them blocks. Throwing is deliberate on
 * the proxy path, whose contract is otherwise "never throws, report an
 * outcome": every outcome that client can return sends the caller looking for
 * another route, and the one thing a blocked prompt must not do is find one.
 */
export function assertPromptAllowed(
  purpose: string,
  text: string,
  provider: AIProviderId,
  options: {
    onFindings?: (findings: readonly GuardrailFinding[]) => void;
    decorate?: (error: AIError) => AIError;
  } = {},
): void {
  const verdict = evaluateInputGuardrails({ purpose, text });
  options.onFindings?.(verdict.findings);
  if (verdict.allowed) return;

  const finding = blockingFinding(verdict);
  const decorate = options.decorate ?? ((error: AIError) => error);
  throw decorate(
    new AIError({
      category: 'invalid-request',
      provider,
      message: `Guardrail ${finding?.rule ?? 'desconocido'} blocked "${purpose}": ${finding?.message ?? ''}`,
      userMessage: finding?.remediation
        ? `${finding.message} ${finding.remediation}`
        : (finding?.message ?? 'La petición no ha superado los controles de seguridad.'),
      retryable: false,
      errorCode: 'guardrail_blocked',
    }),
  );
}

/**
 * Output guardrails — buffered generation only.
 *
 * Applied where the answer is about to be parsed, rendered into an artifact
 * and persisted, which is the moment a leaked credential stops being
 * transient. Streams are exempt on purpose: a chunk can only be inspected
 * after it is on the screen, so blocking there would arrive after the
 * disclosure and destroy the answer as well.
 */
export function guardResponse(text: string, request: AIRequest, trace: AITraceBuilder): void {
  const verdict = evaluateOutputGuardrails({ purpose: request.purpose, text });
  trace.recordGuardrailFindings(verdict.findings);
  if (verdict.allowed) return;

  const finding = blockingFinding(verdict);
  const aiError = new AIError({
    category: 'invalid-request',
    provider: trace.provider,
    message: `Guardrail ${finding?.rule ?? 'desconocido'} blocked the response to "${request.purpose}".`,
    userMessage: finding?.remediation
      ? `${finding.message} ${finding.remediation}`
      : (finding?.message ?? 'La respuesta no ha superado los controles de seguridad.'),
    retryable: false,
    errorCode: 'guardrail_blocked_output',
  });
  throw attachTrace(aiError, trace.error('invalid-request'));
}
