/**
 * What is checked on the way back, before anything is shown or stored.
 *
 * One rule, and it is the mirror of the input one: a model can echo a
 * credential it was shown, or reproduce one it memorised, and the answer is
 * about to be rendered into an artifact and written to Firestore. Blocking is
 * the correct outcome because the alternative is persisting the secret in a
 * document that will later be exported, published and shared.
 *
 * Streamed answers are exempt, and that is a decision rather than an oversight:
 * by the time a chunk can be inspected it is already painted on the screen, so
 * the block would arrive after the disclosure it exists to prevent while still
 * destroying the answer. Buffered generation — every path that produces an
 * artifact, a document or a structured payload — is where persistence happens
 * and where this check earns its cost.
 */

import { findSecretShapes } from '../../../lib/secretShapes';
import { hasUntrustedFence } from '../../../lib/untrustedContent';
import type { GuardrailFinding, GuardrailVerdict } from './guardrailTypes';
import { verdictOf } from './guardrailTypes';

export interface GuardrailOutput {
  purpose: string;
  /** The model's answer, as text. */
  text: string;
}

export function evaluateOutputGuardrails(output: GuardrailOutput): GuardrailVerdict {
  const findings: GuardrailFinding[] = [];

  for (const name of findSecretShapes(output.text)) {
    findings.push({
      rule: 'secret-in-output',
      severity: 'hard-block',
      stage: 'output',
      location: 'respuesta',
      message: `La respuesta de «${output.purpose}» contiene lo que parece una credencial (${name}).`,
      remediation:
        'La respuesta no se ha entregado. Revisa qué contexto se envió al modelo: una clave '
        + 'devuelta suele ser una clave que viajaba en el material de entrada.',
    });
  }

  if (hasUntrustedFence(output.text)) {
    findings.push({
      rule: 'untrusted-fence-echoed',
      severity: 'warning',
      stage: 'output',
      location: 'respuesta',
      message:
        `La respuesta de «${output.purpose}» reproduce las marcas de contenido externo, `
        + 'señal de que el modelo está copiando material de entrada en vez de analizarlo.',
    });
  }

  return verdictOf(findings);
}
