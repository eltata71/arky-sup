/**
 * lazyWithRetry — resilient dynamic-import loading for code-split routes.
 *
 * Why this exists
 * ---------------
 * `React.lazy(() => import('./Page'))` performs a single dynamic `import()`.
 * On iPad/Safari that import frequently fails *transiently* — background-tab
 * throttling, a dropped CORS preflight, memory pressure while a 2 MB route
 * chunk streams in — and a single failure permanently breaks the route:
 * React memoises the rejected lazy factory and never re-invokes it. The user
 * is left on a black "Cargando…" screen and the app surfaces
 * "No se pudo cargar una actualización de la aplicación".
 *
 * Strategy
 * --------
 *  1. Retry the dynamic import a few times with exponential backoff + jitter.
 *     This absorbs the overwhelmingly-common transient Safari fetch failures.
 *  2. If every retry still fails with a chunk-shaped error, the deployed
 *     bundle is most likely stale (a new deploy rotated the chunk hashes).
 *     Reload the page exactly once per session to pull the fresh
 *     `index.html` + chunk graph. The one-shot guard prevents reload loops.
 *  3. If a reload already happened (or we are not in a browser), surface the
 *     error so the React `ErrorBoundary` renders a recoverable fallback
 *     instead of an infinite spinner.
 *
 * Genuine application errors (a real `ReferenceError` thrown while the module
 * evaluates) are NOT retried — they are surfaced immediately so real bugs are
 * never masked by the resilience layer.
 *
 * It lived in `lib/`, which `CLAUDE.md` defines as framework-agnostic helpers
 * with no React and no Firebase — and this file imports `lazy`, `ComponentType`
 * and the observability service. That made the bottom layer depend on a domain
 * service, and the rule that was supposed to prevent it was a sentence in a
 * document. Route loading is a UI concern; it now lives in the UI layer, where
 * depending on a service is what the layering allows.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { observabilityService } from '../../services/observability';

type ModuleFactory<T> = () => Promise<{ default: T }>;

export interface LazyRetryOptions {
  /** Retries after the first attempt (default 2 → up to 3 attempts). */
  retries?: number;
  /** Base backoff delay in ms (default 350). */
  baseDelayMs?: number;
  /** Human-readable chunk name for diagnostics. */
  chunkName?: string;
  /** Test seam — backoff sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Test seam — full-page reload. */
  reload?: () => void;
  /** Test seam — whether the one-shot reload guard is already set. */
  isReloadGuarded?: () => boolean;
  /** Test seam — set the one-shot reload guard. */
  markReloaded?: () => void;
}

/**
 * Shared with `observabilityService.recoverStaleBundleOnce` so the lazy
 * loader and the global error handler never double-reload the page.
 */
export const STALE_BUNDLE_RELOAD_GUARD_KEY = 'arky.runtime.stale-bundle-reloaded.v1';

const isBrowser = (): boolean => typeof window !== 'undefined';

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultReload = (): void => {
  if (isBrowser()) window.location.reload();
};

const defaultIsReloadGuarded = (): boolean => {
  if (!isBrowser()) return true;
  try {
    return window.sessionStorage.getItem(STALE_BUNDLE_RELOAD_GUARD_KEY) === '1';
  } catch {
    return false;
  }
};

const defaultMarkReloaded = (): void => {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(STALE_BUNDLE_RELOAD_GUARD_KEY, '1');
  } catch {
    /* sessionStorage unavailable (private mode) — best effort only. */
  }
};

/**
 * True when `error` looks like a failed module/chunk download (as opposed to
 * a genuine error thrown while the module evaluates).
 */
export function isChunkLoadError(error: unknown): boolean {
  const fragments: string[] = [];
  if (error instanceof Error) {
    fragments.push(error.name, error.message);
  } else if (typeof error === 'string') {
    fragments.push(error);
  } else if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') fragments.push(message);
  }
  const text = fragments.join(' ').toLowerCase();
  if (!text) return false;
  return (
    /loading chunk|chunkloaderror|failed to fetch dynamically imported module/.test(text) ||
    /error loading dynamically imported module|importing a module script failed/.test(text) ||
    /module script|dynamically imported module|failed to fetch|networkerror|load failed/.test(text)
  );
}

/**
 * Load a module with retry + one-shot stale-bundle reload. Exported for unit
 * testing; `lazyWithRetry` wraps it for `React.lazy`.
 */
export async function importWithRetry<T>(
  factory: ModuleFactory<T>,
  options: LazyRetryOptions = {},
): Promise<{ default: T }> {
  const retries = Math.max(0, options.retries ?? 2);
  const baseDelayMs = Math.max(50, options.baseDelayMs ?? 350);
  const sleep = options.sleep ?? defaultSleep;
  const chunkName = options.chunkName ?? 'route';

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await factory();
    } catch (error) {
      lastError = error;
      // A genuine module-evaluation error is a real bug — never retry it.
      if (!isChunkLoadError(error)) throw error;
      if (attempt < retries) {
        const backoff = baseDelayMs * 2 ** attempt * (0.7 + Math.random() * 0.6);
        await sleep(backoff);
      }
    }
  }

  // Every retry failed with a chunk-shaped error → the deployed bundle is
  // almost certainly stale. Reload once to sync with the latest deploy.
  const guarded = (options.isReloadGuarded ?? defaultIsReloadGuarded)();
  if (isBrowser() && !guarded) {
    (options.markReloaded ?? defaultMarkReloaded)();
    observabilityService.trackEvent({
      severity: 'warning',
      source: 'resilience',
      status: 'observed',
      title: 'Sincronizando con la última versión',
      message:
        `No se pudo cargar el módulo "${chunkName}" tras varios intentos. ` +
        'Se recargará una sola vez para obtener el despliegue más reciente.',
      recoverable: true,
      userVisible: false,
      metadata: { chunkName },
    });
    (options.reload ?? defaultReload)();
    // Keep the Suspense fallback on screen during the imminent reload so the
    // user never sees an error flash for a recoverable situation.
    await new Promise<never>(() => {});
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No se pudo cargar el módulo de la aplicación "${chunkName}".`);
}

/**
 * Drop-in replacement for `React.lazy` that retries transient chunk-load
 * failures and recovers from a stale deployed bundle.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: ModuleFactory<T>,
  options: LazyRetryOptions = {},
): LazyExoticComponent<T> {
  return lazy(() => importWithRetry(factory, options));
}
