/**
 * Production configuration is a trust boundary, not a deployment convention.
 *
 * Vite exposes every `VITE_*` value to the browser. These checks run both from
 * the Vite build configuration and at application boot so an unsafe deployment
 * fails before it can silently publish an operator credential or run without
 * its mandatory proxy/persistence boundary.
 *
 * The gate is opt-out per deployment: a production build that sets
 * `VITE_DISABLE_RUNTIME_CONFIG_GATE=true` skips it. This exists so a deployment
 * whose environment variables are provisioned outside this repository (the
 * Vercel dashboard, today) can keep shipping while its configuration is being
 * brought under the contract — it is an escape hatch, not a setting: the
 * deployment opt-outs lose every check below, including the one that keeps
 * operator keys out of the browser bundle.
 */

export interface RuntimeEnvironment {
  readonly MODE?: string;
  readonly PROD?: boolean;
  readonly VITE_DISABLE_RUNTIME_CONFIG_GATE?: string;
  readonly VITE_AI_PROXY_URL?: string;
  readonly VITE_AI_STRICT_PROXY?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_OPENROUTER_API_KEY?: string;
  readonly VITE_ANTHROPIC_API_KEY?: string;
  readonly VITE_LUCID_API_KEY?: string;
}

export type ProductionConfigIssueCode =
  | 'invalid-ai-proxy'
  | 'proxy-not-strict'
  | 'missing-backend-config'
  | 'client-provider-secret';

export interface ProductionConfigIssue {
  code: ProductionConfigIssueCode;
  variable: string;
  message: string;
}

const CLIENT_SECRET_VARIABLES = [
  'VITE_GEMINI_API_KEY',
  'VITE_OPENROUTER_API_KEY',
  'VITE_ANTHROPIC_API_KEY',
  'VITE_LUCID_API_KEY',
] as const;

/**
 * Sin estas dos no hay autenticación ni base de datos, y la aplicación arranca
 * hasta la pantalla de inicio de sesión para no poder hacer nada. Que el build
 * falle aquí es preferible a descubrirlo en producción: es exactamente el fallo
 * que la primera publicación del proyecto nuevo tuvo, y le costó una sesión.
 *
 * La clave de servicio **no** está en esta lista y no puede estarlo: una
 * variable `VITE_*` viaja dentro del bundle. Las operaciones que la necesitan
 * viven en `supabase/functions/`.
 */
const REQUIRED_BACKEND_VARIABLES = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
] as const;

const valueOf = (env: RuntimeEnvironment, key: keyof RuntimeEnvironment): string => {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
};

const isRecognisedPlaceholder = (value: string): boolean => (
  value === 'ci-placeholder' || value.startsWith('test-')
);

const isValidProxyUrl = (value: string): boolean => {
  if (value.startsWith('/')) return value.startsWith('/api/');
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

export const isProductionEnvironment = (env: RuntimeEnvironment): boolean => (
  env.PROD === true || env.MODE === 'production'
);

/** Return every unsafe production setting without ever returning its value. */
export function validateProductionRuntimeConfig(env: RuntimeEnvironment): ProductionConfigIssue[] {
  const issues: ProductionConfigIssue[] = [];
  const proxyUrl = valueOf(env, 'VITE_AI_PROXY_URL');

  // An unset variable is no longer "no proxy": a production build defaults to
  // the `/api/ai` this repository deploys beside it (`DEFAULT_AI_PROXY_PATH` in
  // `services/ai/aiProxyClient`), so the boundary holds without being declared.
  // Demanding the variable anyway is what made this gate look like paperwork,
  // and a deployment answered it by switching the whole gate off — including
  // the check that keeps an operator key out of the browser bundle. A value
  // that *is* set still has to be a real proxy endpoint.
  if (proxyUrl && !isValidProxyUrl(proxyUrl)) {
    issues.push({
      code: 'invalid-ai-proxy',
      variable: 'VITE_AI_PROXY_URL',
      message: 'The AI proxy must be a local /api/* route or an HTTPS URL.',
    });
  }

  if (valueOf(env, 'VITE_AI_STRICT_PROXY') === 'false') {
    issues.push({
      code: 'proxy-not-strict',
      variable: 'VITE_AI_STRICT_PROXY',
      message: 'Production proxy enforcement cannot be disabled.',
    });
  }

  for (const variable of REQUIRED_BACKEND_VARIABLES) {
    if (!valueOf(env, variable)) {
      issues.push({
        code: 'missing-backend-config',
        variable,
        message: `${variable} is required for production authentication and persistence.`,
      });
    }
  }

  for (const variable of CLIENT_SECRET_VARIABLES) {
    const value = valueOf(env, variable);
    if (value && !isRecognisedPlaceholder(value)) {
      issues.push({
        code: 'client-provider-secret',
        variable,
        message: `${variable} would be public in the browser bundle; use its server-only equivalent or BYOK.`,
      });
    }
  }

  return issues;
}

export function assertProductionRuntimeConfig(env: RuntimeEnvironment): void {
  if (!isProductionEnvironment(env)) return;
  if (env.VITE_DISABLE_RUNTIME_CONFIG_GATE === 'true') return;
  const issues = validateProductionRuntimeConfig(env);
  if (issues.length === 0) return;

  const details = issues.map(({ variable, message }) => `- ${variable}: ${message}`).join('\n');
  throw new Error(`Unsafe production configuration:\n${details}`);
}
