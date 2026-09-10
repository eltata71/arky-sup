import { errorDetailOf, errorMessageOf } from '../../lib/errorMessage';
import { isChunkLoadFailure, isResizeObserverLoopNotice } from './browserFailureClassification';
export type ObservabilitySeverity = 'info' | 'success' | 'warning' | 'error' | 'critical';
export type ObservabilityStatus = 'started' | 'succeeded' | 'failed' | 'observed';
export type ObservabilitySource =
  | 'app'
  | 'resilience'
  | 'react-boundary'
  | 'runtime'
  | 'network'
  | 'resource'
  | 'operation'
  | 'user-action';

export interface ObservabilityEvent {
  id: string;
  at: string;
  severity: ObservabilitySeverity;
  source: ObservabilitySource;
  status: ObservabilityStatus;
  title: string;
  message: string;
  detail?: string;
  operationId?: string;
  operationName?: string;
  /**
   * Correlates this event with the proxy log line and the provider call it
   * came from. Optional because most events are purely local; present on
   * anything that crossed the wire. See `lib/traceId`.
   */
  traceId?: string;
  route?: string;
  recoverable: boolean;
  userVisible: boolean;
  metadata?: Record<string, string | number | boolean | undefined>;
}

export interface ObservabilityErrorInput {
  source?: ObservabilitySource;
  title?: string;
  message?: string;
  detail?: string;
  severity?: Extract<ObservabilitySeverity, 'error' | 'critical' | 'warning'>;
  operationId?: string;
  operationName?: string;
  traceId?: string;
  recoverable?: boolean;
  userVisible?: boolean;
  metadata?: ObservabilityEvent['metadata'];
}

export interface ObservabilityOperationHandle {
  id: string;
  name: string;
  succeed: (message?: string, metadata?: ObservabilityEvent['metadata']) => ObservabilityEvent;
  fail: (error: unknown, input?: Omit<ObservabilityErrorInput, 'operationId' | 'operationName'>) => ObservabilityEvent;
}

type Listener = (events: ObservabilityEvent[]) => void;

const MAX_EVENTS = 80;
const STORAGE_KEY = 'arky.observability.events.v1';
const SESSION_STATE_KEY = 'arky.resilience.session-state.v1';
const SESSION_ID_KEY = 'arky.resilience.session-id.v1';
const RESILIENCE_MODE_KEY = 'arky.resilience.mode.v1';
const SESSION_STALE_AFTER_MS = 30 * 60 * 1000;

let events: ObservabilityEvent[] = [];
let acknowledgedEventIds = new Set<string>();
let listeners: Listener[] = [];
let globalHandlersInstalled = false;

const isBrowser = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined';

const nowIso = (): string => new Date().toISOString();

const createId = (prefix: string): string => {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${random}`;
};

const safeLocation = (): string | undefined => {
  if (!isBrowser()) return undefined;
  return window.location.pathname + window.location.search + window.location.hash;
};

interface BrowserResilienceProfile {
  isMobileSafari: boolean;
  lowMemoryDevice: boolean;
  prefersReducedMotion: boolean;
  shouldUseResilienceMode: boolean;
  deviceMemory?: number;
}

interface SessionState {
  id: string;
  status: 'booting' | 'active' | 'closed';
  at: number;
  route?: string;
}

const readSessionState = (): SessionState | null => {
  if (!isBrowser()) return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STATE_KEY) ?? window.localStorage.getItem(SESSION_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<SessionState>;
    if (typeof candidate.id !== 'string' || typeof candidate.status !== 'string' || typeof candidate.at !== 'number') return null;
    if (candidate.status !== 'booting' && candidate.status !== 'active' && candidate.status !== 'closed') return null;
    return {
      id: candidate.id,
      status: candidate.status,
      at: candidate.at,
      route: typeof candidate.route === 'string' ? candidate.route : undefined,
    };
  } catch {
    return null;
  }
};

const writeSessionState = (state: SessionState): void => {
  if (!isBrowser()) return;
  const serialized = JSON.stringify(state);
  try {
    window.sessionStorage.setItem(SESSION_STATE_KEY, serialized);
  } catch (error) {
    console.warn('[observability] sessionStorage resilience marker failed', error);
  }
  try {
    window.localStorage.setItem(SESSION_STATE_KEY, serialized);
  } catch (error) {
    console.warn('[observability] localStorage resilience marker failed', error);
  }
};

const getNavigatorWithMemory = (): Navigator & { deviceMemory?: number } => navigator as Navigator & { deviceMemory?: number };

const getBrowserResilienceProfile = (): BrowserResilienceProfile => {
  if (!isBrowser()) {
    return { isMobileSafari: false, lowMemoryDevice: false, prefersReducedMotion: false, shouldUseResilienceMode: false };
  }

  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isWebKit = /WebKit/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const nav = getNavigatorWithMemory();
  const deviceMemory = nav.deviceMemory;
  const lowMemoryDevice = typeof deviceMemory === 'number' ? deviceMemory <= 4 : isIos;
  const prefersReducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const storedMode = (() => {
    try { return window.sessionStorage.getItem(RESILIENCE_MODE_KEY) ?? window.localStorage.getItem(RESILIENCE_MODE_KEY); }
    catch { return null; }
  })();

  return {
    isMobileSafari: isIos && isWebKit,
    lowMemoryDevice,
    prefersReducedMotion,
    shouldUseResilienceMode: storedMode === 'on' || prefersReducedMotion || lowMemoryDevice || (isIos && isWebKit),
    deviceMemory,
  };
};

const setResilienceMode = (enabled: boolean, reason: string): void => {
  if (!isBrowser()) return;
  document.documentElement.dataset.resilienceMode = enabled ? 'on' : 'off';
  if (enabled) document.documentElement.classList.add('arky-resilience-mode');
  else document.documentElement.classList.remove('arky-resilience-mode');
  try {
    const value = enabled ? 'on' : 'off';
    window.sessionStorage.setItem(RESILIENCE_MODE_KEY, value);
    if (enabled) window.localStorage.setItem(RESILIENCE_MODE_KEY, value);
  } catch (error) {
    console.warn('[observability] resilience mode persistence failed', { reason, error });
  }
};

/**
 * Message and stack for an unknown thrown value.
 *
 * The message logic lives in `lib/errorMessage` so the UI can read an error
 * without importing this module; keeping a second copy here is how the two
 * would eventually disagree about what a given failure says.
 *
 * The object branch differs on purpose: an operator reading the observability
 * centre benefits from the serialised object, where a user reading a toast
 * benefits from a sentence.
 */
export const readUnknownError = (value: unknown): { message: string; detail?: string } => {
  if (value instanceof Error) {
    return {
      message: errorMessageOf(value, 'Error JavaScript sin mensaje.'),
      detail: errorDetailOf(value),
    };
  }

  if (value && typeof value === 'object' && typeof (value as { message?: unknown }).message !== 'string') {
    try {
      return { message: JSON.stringify(value) };
    } catch {
      return { message: 'Objeto de error no serializable.' };
    }
  }

  return { message: errorMessageOf(value, 'Error desconocido.') };
};

const hydrateFromSession = (): void => {
  if (!isBrowser() || events.length > 0) return;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    events = parsed.filter((event): event is ObservabilityEvent => (
      !!event && typeof event === 'object' && typeof (event as { id?: unknown }).id === 'string'
    )).slice(0, MAX_EVENTS);
  } catch (error) {
    console.warn('[observability] session hydration failed', error);
  }
};

const notify = (): void => {
  const snapshot = events.filter((event) => !acknowledgedEventIds.has(event.id));
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[observability] listener failed', error);
    }
  });
};

const persist = (): void => {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, 30)));
  } catch (error) {
    console.warn('[observability] session persistence failed', error);
  }
};

const push = (event: ObservabilityEvent): ObservabilityEvent => {
  events = [event, ...events].slice(0, MAX_EVENTS);
  acknowledgedEventIds.delete(event.id);
  const logPayload = {
    id: event.id,
    source: event.source,
    status: event.status,
    message: event.message,
    detail: event.detail,
    metadata: event.metadata,
  };

  if (event.severity === 'critical' || event.severity === 'error') {
    console.error(`[observability] ${event.title}`, logPayload);
  } else if (event.severity === 'warning') {
    console.warn(`[observability] ${event.title}`, logPayload);
  } else {
    console.info(`[observability] ${event.title}`, logPayload);
  }

  persist();
  notify();
  return event;
};

export const observabilityService = {
  subscribe(listener: Listener): () => void {
    hydrateFromSession();
    listeners = [...listeners, listener];
    listener(events.filter((event) => !acknowledgedEventIds.has(event.id)));
    return () => {
      listeners = listeners.filter((current) => current !== listener);
    };
  },

  getSnapshot(): ObservabilityEvent[] {
    hydrateFromSession();
    return events.filter((event) => !acknowledgedEventIds.has(event.id));
  },

  acknowledge(eventId: string): void {
    acknowledgedEventIds.add(eventId);
    notify();
  },

  clear(): void {
    events = [];
    acknowledgedEventIds = new Set<string>();
    persist();
    notify();
  },

  trackEvent(input: Omit<ObservabilityEvent, 'id' | 'at' | 'route'> & { id?: string; at?: string; route?: string }): ObservabilityEvent {
    return push({
      ...input,
      id: input.id ?? createId(input.source),
      at: input.at ?? nowIso(),
      route: input.route ?? safeLocation(),
    });
  },

  reportError(error: unknown, input: ObservabilityErrorInput = {}): ObservabilityEvent {
    const parsed = readUnknownError(error);
    return this.trackEvent({
      severity: input.severity ?? 'error',
      source: input.source ?? 'runtime',
      status: 'failed',
      title: input.title ?? 'Error capturado por monitoreo global',
      message: input.message ?? parsed.message,
      detail: input.detail ?? parsed.detail,
      operationId: input.operationId,
      operationName: input.operationName,
      traceId: input.traceId,
      recoverable: input.recoverable ?? true,
      userVisible: input.userVisible ?? true,
      metadata: input.metadata,
    });
  },

  /**
   * Convenience for non-error warnings (e.g. "operation degraded but recovered",
   * "security policy enforced"). Sets `severity: 'warning'` and `status: 'observed'`.
   */
  recordWarning(input: Omit<ObservabilityErrorInput, 'severity'> & { source?: ObservabilitySource }): ObservabilityEvent {
    return this.trackEvent({
      severity: 'warning',
      source: input.source ?? 'app',
      status: 'observed',
      title: input.title ?? 'Aviso',
      message: input.message ?? 'Se registró un aviso sin descripción.',
      detail: input.detail,
      operationId: input.operationId,
      operationName: input.operationName,
      traceId: input.traceId,
      recoverable: input.recoverable ?? true,
      userVisible: input.userVisible ?? false,
      metadata: input.metadata,
    });
  },

  getResilienceProfile(): BrowserResilienceProfile {
    return getBrowserResilienceProfile();
  },

  enableResilienceMode(reason: string): void {
    setResilienceMode(true, reason);
    this.trackEvent({
      severity: 'warning',
      source: 'resilience',
      status: 'observed',
      title: 'Modo resiliente activado',
      message: 'La aplicación redujo animaciones, blur y carga visual para priorizar estabilidad en este navegador/dispositivo.',
      recoverable: true,
      userVisible: true,
      metadata: { reason },
    });
  },

  registerBootSession(): void {
    if (!isBrowser()) return;
    const previous = readSessionState();
    const stalePrevious = previous ? Date.now() - previous.at > SESSION_STALE_AFTER_MS : false;
    const sessionId = (() => {
      try {
        const existing = window.sessionStorage.getItem(SESSION_ID_KEY);
        if (existing) return existing;
        const next = createId('session');
        window.sessionStorage.setItem(SESSION_ID_KEY, next);
        return next;
      } catch {
        return createId('session');
      }
    })();

    if (previous && previous.status !== 'closed' && !stalePrevious) {
      setResilienceMode(true, 'previous-session-not-closed');
      this.trackEvent({
        severity: 'warning',
        source: 'resilience',
        status: 'observed',
        title: 'Recuperación tras recarga inesperada',
        message: 'Se detectó que la sesión anterior no cerró limpiamente. Se activó modo resiliente para evitar una nueva pantalla negra o recarga de Safari.',
        recoverable: true,
        userVisible: true,
        metadata: { previousRoute: previous.route, previousStatus: previous.status },
      });
    }

    const profile = getBrowserResilienceProfile();
    if (profile.shouldUseResilienceMode) {
      setResilienceMode(true, profile.isMobileSafari ? 'mobile-safari-profile' : 'device-resilience-profile');
    }

    writeSessionState({ id: sessionId, status: 'booting', at: Date.now(), route: safeLocation() });
  },

  markAppMounted(): void {
    if (!isBrowser()) return;
    let sessionId = createId('session');
    try { sessionId = window.sessionStorage.getItem(SESSION_ID_KEY) ?? sessionId; } catch { /* noop */ }
    writeSessionState({ id: sessionId, status: 'active', at: Date.now(), route: safeLocation() });
  },

  startOperation(name: string, metadata?: ObservabilityEvent['metadata']): ObservabilityOperationHandle {
    const id = createId('op');
    this.trackEvent({
      id,
      severity: 'info',
      source: 'operation',
      status: 'started',
      title: 'Operación iniciada',
      message: name,
      operationId: id,
      operationName: name,
      recoverable: true,
      userVisible: true,
      metadata,
    });

    return {
      id,
      name,
      succeed: (message = `${name} completada correctamente.`, successMetadata) => this.trackEvent({
        severity: 'success',
        source: 'operation',
        status: 'succeeded',
        title: 'Operación completada',
        message,
        operationId: id,
        operationName: name,
        recoverable: true,
        userVisible: true,
        metadata: successMetadata,
      }),
      fail: (error, errorInput) => this.reportError(error, {
        ...errorInput,
        operationId: id,
        operationName: name,
        source: errorInput?.source ?? 'operation',
        title: errorInput?.title ?? 'Operación interrumpida',
      }),
    };
  },

  installGlobalErrorHandlers(): void {
    if (!isBrowser() || globalHandlersInstalled) return;
    globalHandlersInstalled = true;

    const profile = getBrowserResilienceProfile();
    if (profile.shouldUseResilienceMode) {
      setResilienceMode(true, profile.isMobileSafari ? 'mobile-safari-profile' : 'device-resilience-profile');
    }

    const markActive = (): void => {
      const current = readSessionState();
      writeSessionState({
        id: current?.id ?? createId('session'),
        status: 'active',
        at: Date.now(),
        route: safeLocation(),
      });
    };

    const markClosed = (): void => {
      const current = readSessionState();
      writeSessionState({
        id: current?.id ?? createId('session'),
        status: 'closed',
        at: Date.now(),
        route: safeLocation(),
      });
    };

    const recoverStaleBundleOnce = (reason: string): void => {
      try {
        const key = 'arky.runtime.stale-bundle-reloaded.v1';
        if (window.sessionStorage.getItem(key) === '1') return;
        window.sessionStorage.setItem(key, '1');
        window.setTimeout(() => window.location.reload(), 700);
        console.warn('[observability] stale bundle detected; reloading once', reason);
      } catch {
        window.setTimeout(() => window.location.reload(), 700);
      }
    };

    const onError = (event: ErrorEvent) => {
      const message = event.message || String(event.error ?? '');
      if (isResizeObserverLoopNotice(message)) {
        event.stopImmediatePropagation();
        event.preventDefault();
        return;
      }
      const chunkFailure = isChunkLoadFailure(message);
      this.reportError(event.error ?? message, {
        source: 'runtime',
        title: chunkFailure
          ? 'No se pudo cargar un módulo de la aplicación'
          : 'Error global de JavaScript',
        message: message || undefined,
        severity: 'critical',
        recoverable: true,
        metadata: {
          filename: event.filename,
          line: event.lineno,
          column: event.colno,
        },
      });
      if (chunkFailure) recoverStaleBundleOnce(message);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const parsed = readUnknownError(event.reason);
      if (isResizeObserverLoopNotice(`${parsed.message} ${parsed.detail ?? ''}`)) {
        event.preventDefault();
        return;
      }
      const chunkFailure = isChunkLoadFailure(`${parsed.message} ${parsed.detail ?? ''}`);
      this.reportError(event.reason, {
        source: 'runtime',
        title: chunkFailure ? 'No se pudo cargar una actualización de la aplicación' : 'Promesa rechazada sin manejar',
        severity: chunkFailure ? 'critical' : 'error',
        recoverable: true,
      });
      if (chunkFailure) recoverStaleBundleOnce(parsed.message);
    };

    const onResourceError = (event: Event) => {
      const target = event.target;
      if (target === window || !(target instanceof HTMLElement)) return;
      const tag = target.tagName.toLowerCase();
      const source = target.getAttribute('src') ?? target.getAttribute('href') ?? 'recurso sin URL';
      this.reportError(`${tag}: ${source}`, {
        source: 'resource',
        title: 'Recurso de interfaz no cargado',
        severity: 'warning',
        recoverable: true,
        metadata: { tag, source },
      });
      if (tag === 'script' && isChunkLoadFailure(source)) recoverStaleBundleOnce(source);
    };

    const onVitePreloadError = (event: Event) => {
      // Vite fires this before rejecting the import. Let `lazyWithRetry` absorb
      // transient WebKit cancellations; reloading here races every retry and
      // leaves navigation at the bootstrap spinner.
      event.preventDefault();
      const custom = event as CustomEvent<unknown>;
      this.reportError(custom.detail ?? 'vite:preloadError', {
        source: 'runtime',
        title: 'Precarga de módulo interrumpida; reintentando',
        severity: 'warning',
        recoverable: true,
        userVisible: false,
      });
    };

    const onOffline = () => {
      this.trackEvent({
        severity: 'warning',
        source: 'network',
        status: 'observed',
        title: 'Conexión perdida',
        message: 'La aplicación detectó que el navegador quedó sin conexión. Algunas operaciones pueden pausarse.',
        recoverable: true,
        userVisible: true,
      });
    };

    const onOnline = () => {
      this.trackEvent({
        severity: 'success',
        source: 'network',
        status: 'observed',
        title: 'Conexión restablecida',
        message: 'El navegador volvió a estar en línea.',
        recoverable: true,
        userVisible: true,
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onResourceError, true);
    window.addEventListener('vite:preloadError', onVitePreloadError);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', markActive);
    window.addEventListener('visibilitychange', markActive);
    window.addEventListener('pagehide', markClosed);
    window.addEventListener('beforeunload', markClosed);
  },
};
