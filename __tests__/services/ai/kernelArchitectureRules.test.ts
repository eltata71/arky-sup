/**
 * The rules that make the AI layer a kernel rather than a folder.
 *
 * Each one exists because it was broken, and each is scanned on the file rather
 * than argued in review: a convention that lives only in a docblock is a
 * convention that lasts until the next hurried change.
 *
 * The rules the previous passes could not state, because the code contradicted
 * them, were the interesting ones. `core` was documented as provider-agnostic
 * while `AIRequestExecutor` imported `geminiErrorClassifier` and used it by
 * default on the "provider-driven" path; `AIRequest` was documented as neutral
 * while carrying `rawContents?: unknown` described as Gemini `Content[]`.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const AI_ROOT = 'services/ai';
const ADAPTER_DIR = join(AI_ROOT, 'providers');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const read = (file: string): string => readFileSync(file, 'utf8');

/**
 * The file with its comments removed.
 *
 * Every rule below is about what the code *does*, and each of these rules has a
 * docblock somewhere explaining the thing it forbids — this file included. A
 * scan that read comments would forbid documenting the rule, which is the one
 * place the reasoning survives.
 */
const codeOf = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Import statements only — a rule about coupling must not fire on a comment. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/^\s*import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
}

describe('no provider SDK or endpoint outside an adapter', () => {
  const VENDOR_MODULES = [/@google\/genai/, /@anthropic-ai/, /^openai$/];
  const VENDOR_ENDPOINTS = [
    /generativelanguage\.googleapis\.com/,
    /api\.anthropic\.com/,
    /openrouter\.ai\/api/,
    /api\.openai\.com/,
  ];

  it.each(filesUnder(AI_ROOT).filter((f) => !f.startsWith(ADAPTER_DIR)))(
    '%s imports no vendor SDK',
    (file) => {
      for (const pattern of VENDOR_MODULES) {
        expect(importsOf(read(file)).some((i) => pattern.test(i))).toBe(false);
      }
    },
  );

  it.each(filesUnder(AI_ROOT).filter((f) => !f.startsWith(ADAPTER_DIR)))(
    '%s names no vendor endpoint',
    (file) => {
      const code = codeOf(file);
      for (const pattern of VENDOR_ENDPOINTS) expect(pattern.test(code)).toBe(false);
    },
  );
});

describe('`core` does not depend on the adapters it exists to hide', () => {
  it.each(filesUnder(join(AI_ROOT, 'core')))('%s imports no provider implementation', (file) => {
    for (const specifier of importsOf(read(file))) {
      expect(specifier).not.toMatch(/providers\//);
    }
  });

  /**
   * The specific coupling this refactor removed. The executor's constructor
   * read `classifier: AIErrorClassifier = geminiErrorClassifier`, so every
   * failure from every backend was stamped `provider: 'gemini'` and judged by
   * heuristics scoped to Google's SDK — on the path documented as
   * provider-driven, while `AIProvider.classifyError` sat uncalled.
   */
  it('never defaults to a vendor-scoped error classifier', () => {
    const code = codeOf(join(AI_ROOT, 'core/AIRequestExecutor.ts'));
    expect(code).not.toMatch(/geminiErrorClassifier/);
    expect(code).toMatch(/classifyError\(/);
  });
});

describe('the canonical request carries no vendor payload', () => {
  const request = codeOf(join(AI_ROOT, 'core/AIRequest.ts'));

  it('has no untyped `rawContents` hatch', () => {
    expect(request).not.toMatch(/rawContents/);
  });

  it('types tools as definitions rather than as `unknown[]`', () => {
    expect(request).toMatch(/tools\?: readonly AIToolDefinition\[\]/);
  });

  /**
   * `providerConfig` survives, because some parameters genuinely have no
   * neutral meaning. What does not survive is the flat record: a value written
   * for one backend used to be merged verbatim into whichever body was built,
   * so switching provider sent Google's keys to Anthropic.
   */
  it('keys the remaining escape hatch by provider', () => {
    expect(request).toMatch(/providerConfig\?: Partial<Record<AIProviderId,/);
  });
});

describe('no capability is declared without an implementation behind it', () => {
  it('publishes only capability names the provider contract can answer', () => {
    const names = codeOf(join(AI_ROOT, 'core/AICapabilities.ts'));
    // `embeddings` was in the factory's union with no method on `AIProvider`,
    // so `createForCapability` could only ever throw for it.
    expect(names).not.toMatch(/'embeddings'/);
    expect(codeOf(join(AI_ROOT, 'providers/AIProviderFactory.ts'))).not.toMatch(/'embeddings'/);
  });

  it('makes every adapter declare the full record, with no optional cast', () => {
    for (const file of filesUnder(ADAPTER_DIR).filter((f) => /Provider\.ts$/.test(f))) {
      const source = codeOf(file);
      expect(source, `${file} must declare capabilities`).toMatch(/readonly capabilities/);
      expect(source).not.toMatch(/readonly supports(Streaming|StructuredOutput|Images|Audio)/);
    }
    // And the probe that guessed is gone.
    expect(codeOf(join(AI_ROOT, 'capabilities/negotiate.ts'))).not.toMatch(
      /as AIProvider & \{ supportsTools/,
    );
  });
});

describe('the tool contract points one way', () => {
  it('has no adapter that reads definitions back out of a vendor shape', () => {
    for (const file of filesUnder(join(AI_ROOT, 'tools'))) {
      expect(codeOf(file)).not.toMatch(/fromGeminiTools/);
    }
  });

  it('declares the assistant tool once, outside the legacy monolith', () => {
    const monolith = codeOf('services/ai/generation/artifacts/artifactGenerationEngine.ts');
    expect(monolith).not.toMatch(/functionDeclarations/);
    // The agent turn left the engine in F5-01 (corte 8) and took the tool
    // with it: the assistant vertical names the one declaration.
    expect(codeOf('services/ai/generation/assistant/agentTurn.ts')).toMatch(/MODIFY_ARTIFACT_TOOL/);
  });
});

describe('the guardrails stay pure, and every route to a provider passes one', () => {
  const GUARDRAIL_DIR = join(AI_ROOT, 'guardrails');

  it('has rules that depend on nothing but text', () => {
    // The rules take a purpose and a string. That is what lets the same two
    // rule sets serve the executor, the proxy client and the legacy façade
    // without any of them depending on the others — and it is what keeps
    // `core` free to import them, since a rule that imported `core` back would
    // be a cycle inside the module that owns the request contract.
    for (const file of filesUnder(GUARDRAIL_DIR)) {
      for (const specifier of importsOf(codeOf(file))) {
        expect(specifier).not.toMatch(/\/core\//);
        expect(specifier).not.toMatch(/providers|routing|tracing/);
      }
    }
  });

  it('guards each of the three paths that reach a provider', () => {
    // Three, because the strangler migration is not finished: the canonical
    // executor, the serverless proxy, and the legacy façade's own model chain.
    // A guardrail on the first alone would leave the largest prompt surface in
    // the product ungoverned while the docs claimed otherwise.
    expect(codeOf(join(AI_ROOT, 'core/AIRequestExecutor.ts'))).toMatch(/guardRequest\(/);
    expect(codeOf(join(AI_ROOT, 'aiProxyClient.ts'))).toMatch(/assertPromptAllowed\(/);
    expect(codeOf(join(AI_ROOT, 'generation/legacyGeminiBridge.ts'))).toMatch(
      /assertPromptAllowed\(/,
    );
  });

  it('never lets the proxy turn a refusal into an outcome', () => {
    // Every outcome that client returns sends the caller on to a direct
    // provider call, so a guardrail swallowed by its catch would route the
    // blocked prompt around itself. The body — where the guard runs — is built
    // before the `try`.
    const proxy = codeOf(join(AI_ROOT, 'aiProxyClient.ts'));
    for (const fn of ['callAiProxyDetailed', 'streamAiProxyDetailed']) {
      const body = proxy.slice(proxy.indexOf(`export async function ${fn}`));
      const built = body.indexOf('buildRequestBody');
      const opened = body.indexOf('try {');
      expect(built).toBeGreaterThan(0);
      expect(built).toBeLessThan(opened);
    }
  });
});
