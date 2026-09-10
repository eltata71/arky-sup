/**
 * What is checked before a token is spent.
 *
 * "Before" is the whole design constraint the brief states, and it is why this
 * runs in the executor rather than in each façade: the executor is the one
 * place every canonical generation passes through, and it is upstream of the
 * retry loop, the model chain and the provider fallback. A check placed after
 * any of those would run once per attempt on a request that should never have
 * left the browser.
 *
 * Two rules today, and each is here because it protects something the product
 * cannot get back:
 *
 *  - `secret-in-prompt` is a hard block. A prompt travels to a third party and
 *    is retained by them; a credential that reaches one is compromised whatever
 *    happens next, so this is the one case where refusing to run is
 *    unambiguously better than running. It is also a live risk rather than a
 *    theoretical one: prompts are composed from artifacts, uploaded documents
 *    and chat history, all of which are places a person pastes a key.
 *  - `prompt-injection-signal` is a warning. See `promptInjection.ts` for why
 *    blocking on those phrases would break the product's own security
 *    documents.
 *
 * What is deliberately NOT duplicated here: prompt size, which
 * `AIRequestExecutor.guardPromptSize` already refuses against the policy's
 * `maxPromptChars`, and the empty-response check, which `isEmptyResponse`
 * already owns. A second definition of an existing rule is how the weaker of
 * the two quietly becomes the real policy.
 */

import { findSecretShapes } from '../../../lib/secretShapes';
import { hasUntrustedFence } from '../../../lib/untrustedContent';
import { findInjectionSignals } from './promptInjection';
import type { GuardrailFinding, GuardrailVerdict } from './guardrailTypes';
import { verdictOf } from './guardrailTypes';

export interface GuardrailInput {
  /** Logical purpose of the call — quoted in the finding, never the prompt. */
  purpose: string;
  /** The fully composed prompt, system instruction included. */
  text: string;
}

export function evaluateInputGuardrails(input: GuardrailInput): GuardrailVerdict {
  const findings: GuardrailFinding[] = [];

  for (const name of findSecretShapes(input.text)) {
    findings.push({
      rule: 'secret-in-prompt',
      severity: 'hard-block',
      stage: 'input',
      location: 'prompt',
      message: `El prompt de «${input.purpose}» contiene lo que parece una credencial (${name}).`,
      remediation:
        'Retira la credencial del documento, del artefacto o del historial que compone este '
        + 'prompt. Una clave enviada a un proveedor debe considerarse comprometida.',
    });
  }

  const signals = findInjectionSignals(input.text);
  if (signals.length > 0) {
    const fenced = hasUntrustedFence(input.text);
    findings.push({
      rule: 'prompt-injection-signal',
      severity: 'warning',
      stage: 'input',
      location: fenced ? 'prompt (contenido externo marcado)' : 'prompt',
      message:
        `El prompt de «${input.purpose}» contiene frases que se dirigen a un modelo `
        + `(${signals.join(', ')}).`,
      remediation: fenced
        ? undefined
        : 'El contenido que no escribe la aplicación debe viajar dentro de un bloque marcado '
          + 'como externo (`wrapUntrustedContent`), para que el modelo sepa que son datos.',
    });
  }

  return verdictOf(findings);
}
