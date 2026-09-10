#!/usr/bin/env node
/**
 * checkBundleSecrets — fail the build when a provider credential reaches `dist/`.
 *
 * Vite inlines every `VITE_*` variable into the client bundle. That is correct
 * for a Firebase config, which is public by design, and catastrophic for a
 * model-provider key, which is not. The difference is invisible in a diff and
 * invisible in a deploy log: the app works either way, and the only symptom of
 * getting it wrong is a bill.
 *
 * So it is checked mechanically, after `npm run build`:
 *
 *  1. **Shape scan** — the published prefixes of the providers this app talks
 *     to. Independent of configuration, so it catches a key committed into a
 *     source file just as well as one injected through the environment.
 *  2. **Value scan** — the literal value of any provider variable set in the
 *     environment right now. Catches keys whose shape the scanner does not know
 *     yet, which is the case that would otherwise age badly.
 *
 * Firebase's `apiKey` is deliberately NOT flagged. It is a public client
 * identifier, restricted by Firestore rules and authorised domains, and it is
 * *supposed* to be in the bundle. Flagging it would train everyone to ignore
 * this check, which is worse than not having it.
 *
 * That exclusion is not optional politeness — it is required for the check to
 * run at all. A Firebase web key and a Google AI key are the same shape
 * (`AIza…`), and `@excalidraw/excalidraw` ships its own Firebase client config
 * inside its published bundle. Without the context rule below, this gate fails
 * on a completely clean build, every time.
 *
 * Usage: `node scripts/checkBundleSecrets.mjs [distDir]`
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

/** Extensions that end up served to a browser. */
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.map', '.json']);

/**
 * Published key shapes. Each pattern is anchored on a vendor prefix rather
 * than on entropy: a high-entropy-string heuristic flags minified hashes and
 * source-map segments constantly, and a check that cries wolf gets disabled.
 *
 * The same list exists at runtime, in `lib/secretShapes.ts`, doing the opposite
 * job: this one catches a key that leaked *out* into `dist/`, that one stops a
 * key travelling *to a provider* inside a prompt. Two lists is one too many the
 * moment they disagree — a shape only the scanner knows is a shape the
 * guardrail will let through — so `__tests__/security/secretShapes.test.ts`
 * compares them entry by entry, the way `rulesMatrix.test.ts` compares
 * `lib/authz` with `firestore.rules`.
 *
 * `sk-ant-` was missing here while Anthropic was already a shipped provider:
 * an Anthropic key in the bundle was reported as an "OpenAI-style" one, or, at
 * 23 characters of suffix, not reported at all.
 */
export const SECRET_PATTERNS = [
  { name: 'Google AI (Gemini) API key', pattern: /AIza[0-9A-Za-z_-]{35}/g, allowFirebaseConfig: true },
  { name: 'OpenRouter API key', pattern: /sk-or-v1-[0-9a-f]{64}/g },
  // Before the generic `sk-` shape, which would otherwise claim it and report
  // an Anthropic key under another vendor's name.
  { name: 'Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{24,}/g },
  { name: 'OpenAI-style API key', pattern: /sk-[A-Za-z0-9]{32,}/g },
  { name: 'Private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

/** Environment variables whose literal value must never appear in the bundle. */
export const FORBIDDEN_VALUE_VARS = [
  'GEMINI_API_KEY',
  'VITE_GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'VITE_OPENROUTER_API_KEY',
];

/**
 * Values short enough or generic enough that finding them proves nothing.
 * CI builds with `ci-placeholder`, and a four-character value would match
 * somewhere inside any minified bundle by chance.
 */
const MIN_SCANNABLE_VALUE_LENGTH = 12;
const PLACEHOLDER_VALUES = new Set(['ci-placeholder', 'placeholder', 'test', 'dummy', 'changeme']);

export function collectFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (SCANNED_EXTENSIONS.has(extname(entry))) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/** Values worth searching for: long enough, and not a known placeholder. */
export function scannableEnvValues(env) {
  const values = [];
  for (const name of FORBIDDEN_VALUE_VARS) {
    const raw = (env[name] ?? '').trim();
    if (raw.length < MIN_SCANNABLE_VALUE_LENGTH) continue;
    if (PLACEHOLDER_VALUES.has(raw.toLowerCase())) continue;
    values.push({ name, value: raw });
  }
  return values;
}

/** Never print the secret itself — a CI log is not a safe place for it. */
const redact = (secret) => `${secret.slice(0, 4)}…${secret.slice(-2)} (${secret.length} chars)`;

/**
 * How far around a match to look for the sibling fields of a Firebase config.
 *
 * The minifier separates an `apiKey` from its `authDomain`/`appId` by more
 * than a tight window: a measured local build put the sibling fields ~635
 * characters away. A window sized for unminified source therefore flags every
 * legitimate local build that uses a real Firebase key — the exact failure the
 * check exists to avoid. 2 000 covers the spread minification produces while
 * still requiring the sibling *field name* (`authDomain` etc.) to be present,
 * which a leaked model-provider key never has nearby.
 */
const CONTEXT_WINDOW = 2000;

/**
 * A Google API key sitting inside a Firebase web config.
 *
 * A Firebase client config always carries sibling fields — `authDomain`,
 * `messagingSenderId`, `appId` — and a leaked model-provider key never does.
 * That is what separates the two, because their key *shape* is identical.
 */
export function looksLikeFirebaseClientConfig(content, index, matchLength) {
  const window = content.slice(
    Math.max(0, index - CONTEXT_WINDOW),
    index + matchLength + CONTEXT_WINDOW,
  );
  // A Firebase client config carries sibling fields — `authDomain`, `appId`,
  // `messagingSenderId`, `storageBucket` — in its own source, and Vite inlines
  // the same config as `VITE_FIREBASE_*` variables (all-caps) into the bundle's
  // env dump. Both are recognised here. A leaked model-provider key never has
  // either nearby.
  return /authDomain|messagingSenderId|storageBucket|appId|VITE_FIREBASE_/.test(window);
}

export function scanBundle(distDir, env = process.env) {
  const findings = [];
  const envValues = scannableEnvValues(env);

  for (const file of collectFiles(distDir)) {
    const content = readFileSync(file, 'utf8');

    for (const { name, pattern, allowFirebaseConfig } of SECRET_PATTERNS) {
      // Fresh regex per file: /g patterns carry lastIndex between calls.
      const seen = new Set();
      for (const match of content.matchAll(new RegExp(pattern.source, 'g'))) {
        const value = match[0];
        if (seen.has(value)) continue;
        if (allowFirebaseConfig && looksLikeFirebaseClientConfig(content, match.index, value.length)) {
          continue;
        }
        seen.add(value);
        findings.push({ file, kind: name, evidence: redact(value) });
      }
    }

    for (const { name, value } of envValues) {
      if (content.includes(value)) {
        findings.push({ file, kind: `value of ${name}`, evidence: redact(value) });
      }
    }
  }

  return findings;
}

function main() {
  const distDir = process.argv[2] ?? 'dist';

  if (!existsSync(distDir)) {
    console.error(`[check:bundle-secrets] "${distDir}" not found. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const findings = scanBundle(distDir);

  if (findings.length === 0) {
    console.log(`[check:bundle-secrets] OK — no provider credentials found in ${distDir}/.`);
    return;
  }

  console.error(`[check:bundle-secrets] FAILED — ${findings.length} credential(s) in the client bundle:\n`);
  for (const { file, kind, evidence } of findings) {
    console.error(`  ${file}\n    ${kind}: ${evidence}`);
  }
  console.error(
    '\nA provider key in dist/ is served to every visitor. Move it to a server-only\n'
    + 'variable (no VITE_ prefix) and route generation through the proxy (api/ai.ts).',
  );
  process.exit(1);
}

// Only run when invoked directly, so the test suite can import the internals.
if (process.argv[1] && process.argv[1].endsWith('checkBundleSecrets.mjs')) main();
