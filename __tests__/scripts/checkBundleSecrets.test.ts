/**
 * Specs for the build-time bundle secret scanner.
 *
 * A scanner nobody trusts is a scanner that gets disabled, so the false
 * positives matter as much as the true ones. Both are asserted: a real Gemini
 * key must be caught, and Firebase's public client key — which is *supposed*
 * to be in the bundle — must not be.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanBundle, scannableEnvValues, looksLikeFirebaseClientConfig } from '../../scripts/checkBundleSecrets.mjs';

let dist: string;

const write = (name: string, content: string) => {
  const full = join(dist, name);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
};

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'arky-dist-'));
});

afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe('shape scan', () => {
  it('catches a Gemini key inlined into a chunk', () => {
    write('assets/index-abc123.js', `const k="AIza${'B'.repeat(35)}";export{k};`);
    const findings = scanBundle(dist, {});
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toContain('Gemini');
  });

  it('catches an OpenRouter key', () => {
    write('assets/vendor.js', `fetch(x,{headers:{Authorization:"Bearer sk-or-v1-${'a'.repeat(64)}"}})`);
    expect(scanBundle(dist, {})).toHaveLength(1);
  });

  it('catches a private key block anywhere in the output', () => {
    write('index.html', '<script>/* -----BEGIN PRIVATE KEY----- */</script>');
    expect(scanBundle(dist, {})).toHaveLength(1);
  });

  it('walks nested directories', () => {
    write('assets/deep/nested/chunk.js', `"AIza${'C'.repeat(35)}"`);
    expect(scanBundle(dist, {})).toHaveLength(1);
  });

  it('never puts the secret itself in the report', () => {
    const secret = `AIza${'D'.repeat(35)}`;
    write('assets/a.js', `"${secret}"`);
    const [finding] = scanBundle(dist, {});
    expect(finding.evidence).not.toContain(secret);
    expect(finding.evidence).toContain('39 chars');
  });
});

describe('what it deliberately does not flag', () => {
  it('passes a clean bundle', () => {
    write('assets/index.js', 'export const greet=()=>"hola";');
    write('index.html', '<!doctype html><div id="root"></div>');
    expect(scanBundle(dist, {})).toEqual([]);
  });

  it('does not flag a Firebase client config, which belongs in the bundle', () => {
    // Public by design: restricted by Firestore rules and authorised domains.
    // Note the shape is identical to a Google AI key — only the sibling fields
    // tell them apart, which is exactly what the context rule reads.
    write('assets/index.js',
      `const firebaseConfig={apiKey:"AIza${'F'.repeat(35)}",authDomain:"x.firebaseapp.com",`
      + 'projectId:"p",storageBucket:"x.appspot.com",messagingSenderId:"1",appId:"1:1:web:a"};');
    expect(scanBundle(dist, {})).toEqual([]);
  });

  it("does not flag a dependency's own vendored Firebase config", () => {
    // Regression guard for a real finding: `@excalidraw/excalidraw` ships its
    // own Firebase client config inside its published bundle, so without the
    // context rule this gate failed on a completely clean build, every time.
    write('assets/vendor-excalidraw-BFGvduVX.js',
      `VITE_APP_FIREBASE_CONFIG:'{"apiKey":"AIza${'G'.repeat(35)}",`
      + '"authDomain":"excalidraw-room-persistence.firebaseapp.com","projectId":"e"}\'');
    expect(scanBundle(dist, {})).toEqual([]);
  });

  it('still flags a provider key that merely sits near unrelated config', () => {
    // The exclusion must be narrow: proximity to some settings object is not
    // proof of a Firebase config, or it becomes a way to hide a real key.
    write('assets/index.js', `const settings={theme:"dark",key:"AIza${'H'.repeat(35)}"};`);
    expect(scanBundle(dist, {})).toHaveLength(1);
  });

  it('reads the Firebase context by sibling fields, not by the word apiKey', () => {
      const near = `x apiKey AIza${'I'.repeat(35)} authDomain y`;
      expect(looksLikeFirebaseClientConfig(near, near.indexOf('AIza'), 39)).toBe(true);
      // The minifier spreads a config's sibling fields well past the old 240-char
      // window: a measured local build separated apiKey from authDomain by ~635
      // chars. The context search must still find them — that is what keeps the
      // gate green on a legitimate build that uses a real Firebase key.
      const minified = `const c={apiKey:"AIza${'J'.repeat(35)}"};${' '.repeat(600)}const d={authDomain:"x",appId:"y"};`;
      expect(looksLikeFirebaseClientConfig(minified, minified.indexOf('AIza'), 39)).toBe(true);
      // A model-provider key carries no Firebase sibling fields anywhere nearby.
      const far = `const k="AIza${'K'.repeat(35)}";${' '.repeat(2100)}authDomain`;
      expect(looksLikeFirebaseClientConfig(far, far.indexOf('AIza'), 39)).toBe(false);
    });

    it('recognises the all-caps env dump Vite inlines for a real Firebase config', () => {
      // Vite writes the public Firebase config into the bundle as VITE_FIREBASE_*
      // variables, all-caps — the exact shape that made a legitimate local build
      // fail this gate. A real provider key is never surrounded by them.
      const envDump = `const env={VITE_FIREBASE_API_KEY:"AIza${'L'.repeat(35)}",VITE_FIREBASE_AUTH_DOMAIN:"x.firebaseapp.com",VITE_FIREBASE_APP_ID:"1:y:web:z"};`;
      expect(looksLikeFirebaseClientConfig(envDump, envDump.indexOf('AIza'), 39)).toBe(true);
    });

    it('still flags a Google AI key that is not part of any Firebase config', () => {
      const content = `const k="AIza${'M'.repeat(35)}";const x={apiKey:1,cache:true};`;
      expect(looksLikeFirebaseClientConfig(content, content.indexOf('AIza'), 39)).toBe(false);
    });

    it('does not flag minified identifiers that merely look random', () => {
      write('assets/index.js', 'const a1b2c3d4e5f6g7h8=1;const sk_ratio=2;');
      expect(scanBundle(dist, {})).toEqual([]);
    });

  it('ignores non-served file types', () => {
    write('stats.txt', `AIza${'E'.repeat(35)}`);
    expect(scanBundle(dist, {})).toEqual([]);
  });
});

describe('value scan', () => {
  it('catches a key whose shape the scanner does not know', () => {
    write('assets/index.js', 'const k="totally-custom-provider-secret-value";');
    const findings = scanBundle(dist, { GEMINI_API_KEY: 'totally-custom-provider-secret-value' });
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toContain('GEMINI_API_KEY');
  });

  it('skips the CI placeholder so the gate does not cry wolf on every build', () => {
    write('assets/index.js', 'const k="ci-placeholder";');
    expect(scanBundle(dist, { VITE_GEMINI_API_KEY: 'ci-placeholder' })).toEqual([]);
  });

  it('skips values too short to prove anything', () => {
    expect(scannableEnvValues({ GEMINI_API_KEY: 'abc' })).toEqual([]);
    expect(scannableEnvValues({ GEMINI_API_KEY: '' })).toEqual([]);
  });

  it('scans every provider variable, VITE_-prefixed included', () => {
    const names = scannableEnvValues({
      GEMINI_API_KEY: 'gemini-secret-value-long',
      VITE_GEMINI_API_KEY: 'vite-gemini-secret-value',
      OPENROUTER_API_KEY: 'openrouter-secret-value',
      VITE_OPENROUTER_API_KEY: 'vite-openrouter-secret-v',
    }).map((entry) => entry.name);
    expect(names).toEqual([
      'GEMINI_API_KEY',
      'VITE_GEMINI_API_KEY',
      'OPENROUTER_API_KEY',
      'VITE_OPENROUTER_API_KEY',
    ]);
  });
});
