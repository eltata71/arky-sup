/**
 * The two lists of key shapes must not drift.
 *
 * `scripts/checkBundleSecrets.mjs` scans `dist/` for a credential that leaked
 * *out*; `lib/secretShapes.ts` stops one travelling *to a provider* inside a
 * prompt. Same shapes, opposite directions — and a shape only one of them knows
 * is a hole in the other: a key the scanner would catch in the bundle would be
 * sent to a third party without a word, or the reverse.
 *
 * It is the same defect `rulesMatrix.test.ts` exists to prevent between
 * `lib/authz` and `firestore.rules`, and the same fix: compare them, entry by
 * entry, in a test that fails when one gains a shape the other lacks.
 */

import { describe, expect, it } from 'vitest';
import { SECRET_KEY_SHAPES, findSecretShapes } from '../../lib/secretShapes';
import { SECRET_PATTERNS } from '../../scripts/checkBundleSecrets.mjs';

describe('secret key shapes', () => {
  it('names the same shapes at build time and at runtime', () => {
    expect(SECRET_KEY_SHAPES.map((s) => s.name)).toEqual(SECRET_PATTERNS.map((s) => s.name));
  });

  it('matches with the same expressions, in the same order', () => {
    // Order is part of the contract: the generic `sk-` shape must stay behind
    // `sk-ant-`/`sk-or-v1-`, or an Anthropic key gets reported under OpenAI's
    // name in whichever list got it wrong.
    expect(SECRET_KEY_SHAPES.map((s) => s.pattern.source)).toEqual(
      SECRET_PATTERNS.map((s) => s.pattern.source),
    );
  });

  it('recognises a key from each shipped provider', () => {
    expect(findSecretShapes(`clave: AIza${'a'.repeat(35)}`)).toEqual(['Google AI (Gemini) API key']);
    expect(findSecretShapes(`sk-or-v1-${'a'.repeat(64)}`)).toEqual(['OpenRouter API key']);
    expect(findSecretShapes(`sk-ant-api03-${'A'.repeat(30)}`)).toEqual(['Anthropic API key']);
    expect(findSecretShapes('-----BEGIN RSA PRIVATE KEY-----')).toEqual(['Private key block']);
  });

  it('reports the name and never the value', () => {
    const secret = `AIza${'b'.repeat(35)}`;
    const found = findSecretShapes(`la clave es ${secret}`);
    expect(found).toHaveLength(1);
    expect(found[0]).not.toContain(secret);
  });

  it('leaves ordinary architecture prose alone', () => {
    expect(
      findSecretShapes('El broker publica en SQS y el consumidor firma con una clave rotada.'),
    ).toEqual([]);
  });
});
