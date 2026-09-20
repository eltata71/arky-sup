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
  VITE_SUPABASE_URL: 'https://arky-production.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public-by-design',
  ...overrides,
});

describe('production runtime configuration', () => {
  it('accepts a fail-closed proxy with the public Supabase client configuration', () => {
    expect(validateProductionRuntimeConfig(secureProductionEnv())).toEqual([]);
    expect(() => assertProductionRuntimeConfig(secureProductionEnv())).not.toThrow();
  });

  it('rejects a production build with no backend boundary', () => {
    const issues = validateProductionRuntimeConfig({ MODE: 'production' });
    expect(issues.map(({ code }) => code)).toEqual([
      'missing-backend-config',
      'missing-backend-config',
    ]);
    expect(issues.map(({ variable }) => variable)).toEqual([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
    ]);
  });

  // Una variable presente y mal escrita no es una variable configurada, y ésta
  // es la que se escribe a mano en el panel de Vercel. Antes de F9.2 el gate
  // sólo la comprobaba presente: el valor sin esquema pasó el build entero y
  // falló dentro de `createClient`, al pulsar «Iniciar sesión».
  it.each([
    ['sin esquema', 'btbhkmckrazoayaoorys.supabase.co'],
    ['sólo la referencia del proyecto', 'btbhkmckrazoayaoorys'],
    ['entrecomillada', '"https://btbhkmckrazoayaoorys.supabase.co"'],
    ['con la asignación pegada', 'VITE_SUPABASE_URL=https://x.supabase.co'],
  ])('rejects a Supabase URL that is present but %s', (_case, value) => {
    const issues = validateProductionRuntimeConfig(secureProductionEnv({
      VITE_SUPABASE_URL: value,
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'invalid-backend-url',
      variable: 'VITE_SUPABASE_URL',
    }));
  });

  it('never repeats the offending value: a build log is public', () => {
    const issues = validateProductionRuntimeConfig(secureProductionEnv({
      VITE_SUPABASE_URL: 'sospechoso-y-mal-escrito',
    }));
    expect(issues.every(({ message }) => !message.includes('sospechoso'))).toBe(true);
  });

  it('accepts the local stack the E2E suite builds against', () => {
    // Exigir `https` habría roto `e2e.yml`, que construye contra
    // `http://127.0.0.1:54321`. El gate aplica la regla del SDK, ni más
    // estricta ni más laxa: un gate que rechaza algo que funciona es uno que
    // alguien apaga, y apagarlo se lleva también la comprobación de claves.
    expect(validateProductionRuntimeConfig(secureProductionEnv({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
    }))).toEqual([]);
  });

  it('reports a missing URL as missing, not as malformed', () => {
    const codes = validateProductionRuntimeConfig(secureProductionEnv({
      VITE_SUPABASE_URL: '',
    })).map(({ code }) => code);
    expect(codes).toContain('missing-backend-config');
    expect(codes).not.toContain('invalid-backend-url');
  });

  it('never demands the service key: a VITE_* variable travels in the bundle', () => {
    // No es una comprobación redundante. La tentación al migrar es pedir «las
    // claves de Supabase» en bloque, y la de servicio publicada como `VITE_*`
    // sería una puerta de administración servida a cada visitante.
    const issues = validateProductionRuntimeConfig({ MODE: 'production' });
    expect(issues.some(({ variable }) => /SERVICE_ROLE|SECRET/i.test(variable))).toBe(false);
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
    // The escape hatch must skip every check — including the missing backend
    // boundary and a browser-visible operator key — because its only purpose is
    // to let a deployment provision its variables outside this repository.
    const unsafe = { MODE: 'production', PROD: true } as RuntimeEnvironment;
    expect(validateProductionRuntimeConfig(unsafe).length).toBeGreaterThan(0);
    expect(() => assertProductionRuntimeConfig({
      ...unsafe,
      VITE_DISABLE_RUNTIME_CONFIG_GATE: 'true',
    })).not.toThrow();
  });
});
