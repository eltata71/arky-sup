/**
 * Published API-key shapes, for code that must not let one travel.
 *
 * Anchored on a vendor prefix rather than on entropy, for the reason
 * `scripts/checkBundleSecrets.mjs` gives about the same problem: a
 * high-entropy-string heuristic flags minified hashes and base64 fragments
 * constantly, and a check that cries wolf gets disabled.
 *
 * That scanner reads built files looking for a key that leaked *out*; this list
 * serves the runtime guardrail that stops a key travelling *to a provider* in a
 * prompt. Same shapes, different jobs — and
 * `__tests__/security/secretShapes.test.ts` compares the two lists so the pair
 * cannot drift, which is how `lib/authz` and `firestore.rules` are kept in step.
 *
 * Its own file rather than a section of `lib/security.ts`, and that placement
 * is the repository's own rule read twice. `lib/security.ts` value-imports
 * DOMPurify through the one sanitiser; a guardrail that runs on every prompt
 * would then pull a browser HTML sanitiser into the AI kernel and into the
 * Office, to obtain five regular expressions. It is the same reason
 * `deterministicCompactionDigest` left the file that calls a model: a pure
 * function does not live behind a door that costs something to open.
 */
export interface SecretShape {
  /** What a reader should be told was found. Never the value itself. */
  readonly name: string;
  readonly pattern: RegExp;
}

export const SECRET_KEY_SHAPES: readonly SecretShape[] = Object.freeze([
  { name: 'Google AI (Gemini) API key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'OpenRouter API key', pattern: /sk-or-v1-[0-9a-f]{64}/ },
  // Before the generic `sk-` shape, which would otherwise claim it.
  { name: 'Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{24,}/ },
  { name: 'OpenAI-style API key', pattern: /sk-[A-Za-z0-9]{32,}/ },
  { name: 'Private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]);

/**
 * The names of the key shapes present in `text`.
 *
 * Returns names, never the matched value: a guardrail that quotes the secret it
 * found writes it into the log it was protecting.
 */
export function findSecretShapes(text: string): string[] {
  const found: string[] = [];
  for (const shape of SECRET_KEY_SHAPES) {
    if (shape.pattern.test(text) && !found.includes(shape.name)) found.push(shape.name);
  }
  return found;
}
