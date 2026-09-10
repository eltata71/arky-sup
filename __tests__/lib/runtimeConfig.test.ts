import { describe, expect, it } from 'vitest';
import {
  assertProductionRuntimeConfig,
  validateProductionRuntimeConfig,
  type RuntimeEnvironment,
} from '../../lib/runtimeConfig';

const secureProductionEnv = (overrides: Partial<RuntimeEnvironment> = {}): RuntimeEnvironment => ({
  MODE: 'production',
  PROD: true,
  VITE_AI_PROXY_URL: '/api/ai',
  VITE_FIREBASE_API_KEY: 'firebase-public-key',
  VITE_FIREBASE_PROJECT_ID: 'arky-production',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
  ...overrides,
});

describe('production runtime configuration', () => {
  it('accepts a fail-closed proxy with public Firebase client configuration', () => {
    expect(validateProductionRuntimeConfig(secureProductionEnv())).toEqual([]);
    expect(() => assertProductionRuntimeConfig(secureProductionEnv())).not.toThrow();
  });

  it('rejects missing Firebase boundaries', () => {
    const issues = validateProductionRuntimeConfig({ MODE: 'production' });
    expect(issues.map(({ code }) => code)).toEqual([
      'missing-firebase-config',
      'missing-firebase-config',
      'missing-firebase-config',
    ]);
  });

  it('accepts an unset proxy URL: the build defaults to the /api/ai it deploys', () => {
    // The gate used to demand the variable, so a deployment that had not set it
    // switched the whole gate off — losing the operator-key check with it. The
    // boundary now holds by default; only a value that is set can be wrong.
    expect(validateProductionRuntimeConfig(secureProductionEnv({
      VITE_AI_PROXY_URL: undefined,
    }))).toEqual([]);
  });

  it('still rejects a proxy URL that is not a local /api route or HTTPS', () => {
    expect(validateProductionRuntimeConfig(secureProductionEnv({
      VITE_AI_PROXY_URL: 'http://insecure.example/ai',
    }))).toContainEqual(expect.objectContaining({ code: 'invalid-ai-proxy' }));
  });

  it.each([
    'VITE_GEMINI_API_KEY',
    'VITE_OPENROUTER_API_KEY',
    'VITE_ANTHROPIC_API_KEY',
    'VITE_LUCID_API_KEY',
  ] as const)('rejects a browser-visible operator credential in %s', (variable) => {
    const issues = validateProductionRuntimeConfig(secureProductionEnv({ [variable]: 'real-secret-value' }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'client-provider-secret',
      variable,
    }));
  });

  it('allows deterministic CI placeholders without normalising them as deployable secrets', () => {
    expect(validateProductionRuntimeConfig(secureProductionEnv({
      VITE_GEMINI_API_KEY: 'ci-placeholder',
    }))).toEqual([]);
  });

  it('rejects disabling strict proxy enforcement in production', () => {
    expect(validateProductionRuntimeConfig(secureProductionEnv({
      VITE_AI_STRICT_PROXY: 'false',
    }))).toContainEqual(expect.objectContaining({ code: 'proxy-not-strict' }));
  });

  it('does not apply production requirements to local development', () => {
    expect(() => assertProductionRuntimeConfig({ MODE: 'development', PROD: false })).not.toThrow();
  });

  it('can be disabled per deployment with the explicit opt-out flag', () => {
    // The escape hatch must skip every check — including missing Firebase and
    // a browser-visible operator key — because its only purpose is to let a
    // deployment provision its variables outside this repository.
    const unsafe = { MODE: 'production', PROD: true } as RuntimeEnvironment;
    expect(validateProductionRuntimeConfig(unsafe).length).toBeGreaterThan(0);
    expect(() => assertProductionRuntimeConfig({
      ...unsafe,
      VITE_DISABLE_RUNTIME_CONFIG_GATE: 'true',
    })).not.toThrow();
  });
});
