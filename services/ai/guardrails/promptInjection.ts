/**
 * Prompt-injection signals — detection, deliberately not enforcement.
 *
 * These phrases are *reported*, never blocked, and the reason is specific to
 * this product: Arky writes architecture documents, and several of them are
 * about security. An ADR on prompt injection, a threat model, a training
 * lesson on the OWASP GenAI list — each of them legitimately contains the
 * sentence "ignora las instrucciones anteriores", and a guardrail that refused
 * to process those documents would be a guardrail that stops the product from
 * doing the one job it is being asked to do. Blocking on a phrase punishes
 * writing about the attack more reliably than it stops the attack.
 *
 * The mitigation is the fence (`wrapUntrustedContent`), which tells the model
 * what the text is; this list tells a *reader* that something in the prompt
 * looked like an instruction, and where. That is worth having when an answer
 * later turns out strange and someone has to reconstruct why.
 *
 * The list is short on purpose. Every entry is a phrase whose only ordinary use
 * is addressing a model, so a longer list would not catch more attacks — it
 * would only match more prose.
 */

export interface InjectionSignal {
  /** What was recognised, for the finding's message. */
  readonly name: string;
  readonly pattern: RegExp;
}

export const INJECTION_SIGNALS: readonly InjectionSignal[] = Object.freeze([
  {
    name: 'anulación de instrucciones',
    pattern: /\b(ignor[ae]|olvida|descarta)\b[^.\n]{0,40}\b(instruccion|indicacion|regla|anterior|previo)/i,
  },
  {
    name: 'instruction override',
    pattern: /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(instruction|prompt|rule|above|previous|prior)/i,
  },
  {
    name: 'suplantación de rol',
    pattern: /\b(eres ahora|a partir de ahora eres|actúa como si fueras)\b/i,
  },
  { name: 'role override', pattern: /\byou are now\b|\bact as if you were\b/i },
  {
    name: 'extracción del prompt de sistema',
    pattern: /\b(revela|muestra|imprime|repite)\b[^.\n]{0,30}\b(system prompt|prompt de sistema|instrucciones del sistema)\b/i,
  },
  {
    name: 'system-prompt extraction',
    pattern: /\b(reveal|print|repeat|show)\b[^.\n]{0,30}\b(system prompt|your instructions)\b/i,
  },
  { name: 'modo sin restricciones', pattern: /\b(developer mode|jailbreak|DAN mode|sin restricciones de seguridad)\b/i },
]);

/**
 * The names of the injection signals present in `text`.
 *
 * Names, never matches: the matched sentence is attacker-controlled text, and
 * copying it into a finding puts it back into whatever reads findings.
 */
export function findInjectionSignals(text: string): string[] {
  const found: string[] = [];
  for (const signal of INJECTION_SIGNALS) {
    if (signal.pattern.test(text) && !found.includes(signal.name)) found.push(signal.name);
  }
  return found;
}
