/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isResizeObserverLoopNotice, observabilityService, readUnknownError } from '../../services/observability';

describe('global observability service', () => {
  afterEach(() => {
    observabilityService.clear();
    document.documentElement.classList.remove('arky-resilience-mode');
    delete document.documentElement.dataset.resilienceMode;
    window.sessionStorage.clear();
    window.localStorage.removeItem('arky.resilience.session-state.v1');
    window.localStorage.removeItem('arky.resilience.mode.v1');
    vi.restoreAllMocks();
  });

  it('normalizes unknown errors without throwing', () => {
    expect(readUnknownError(new Error('boom')).message).toBe('boom');
    expect(readUnknownError('plain failure').message).toBe('plain failure');
    expect(readUnknownError(undefined).message).toBe('Error desconocido.');
  });

  it('publishes successful and failed operation events for the global monitor', () => {
    const listener = vi.fn();
    const unsubscribe = observabilityService.subscribe(listener);

    const operation = observabilityService.startOperation('Generar artefacto');
    operation.succeed('Artefacto generado y persistido.');
    operation.fail(new Error('persist failed'), { severity: 'error' });

    const snapshot = observabilityService.getSnapshot();
    expect(snapshot[0]).toMatchObject({
      severity: 'error',
      source: 'operation',
      status: 'failed',
      operationName: 'Generar artefacto',
      message: 'persist failed',
    });
    expect(snapshot.some((event) => event.status === 'started')).toBe(true);
    expect(snapshot.some((event) => event.status === 'succeeded')).toBe(true);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
  });

  it('enables resilience mode and reports it as an observable event', () => {
    observabilityService.enableResilienceMode('test-hardening');

    expect(document.documentElement).toHaveClass('arky-resilience-mode');
    expect(document.documentElement.dataset.resilienceMode).toBe('on');
    expect(observabilityService.getSnapshot()[0]).toMatchObject({
      source: 'resilience',
      title: 'Modo resiliente activado',
      severity: 'warning',
      metadata: { reason: 'test-hardening' },
    });
  });

  it('detects a previous unclosed session and activates protected recovery', () => {
    window.localStorage.setItem('arky.resilience.session-state.v1', JSON.stringify({
      id: 'session-prev',
      status: 'active',
      at: Date.now(),
      route: '/workspace/project-1',
    }));

    observabilityService.registerBootSession();

    expect(document.documentElement).toHaveClass('arky-resilience-mode');
    expect(observabilityService.getSnapshot()[0]).toMatchObject({
      source: 'resilience',
      title: 'Recuperación tras recarga inesperada',
      severity: 'warning',
    });
  });

  it('captures reported runtime failures as user-visible recoverable events', () => {
    const event = observabilityService.reportError(new Error('unhandled rejection'), {
      source: 'runtime',
      title: 'Promesa rechazada sin manejar',
      severity: 'error',
    });

    expect(event).toMatchObject({
      title: 'Promesa rechazada sin manejar',
      message: 'unhandled rejection',
      recoverable: true,
      userVisible: true,
    });
    expect(observabilityService.getSnapshot()[0]?.id).toBe(event.id);
  });

  it('recognises the benign ResizeObserver loop notice in both phrasings', () => {
    expect(isResizeObserverLoopNotice('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isResizeObserverLoopNotice('ResizeObserver loop limit exceeded')).toBe(true);
    expect(isResizeObserverLoopNotice('Uncaught TypeError: x is not a function')).toBe(false);
  });

  it('suppresses ResizeObserver loop notices from the global error handler', () => {
    observabilityService.installGlobalErrorHandlers();
    const baseline = observabilityService.getSnapshot().length;

    const errorEvent = new ErrorEvent('error', {
      message: 'ResizeObserver loop completed with undelivered notifications.',
    });
    const preventDefault = vi.spyOn(errorEvent, 'preventDefault');
    const stopImmediate = vi.spyOn(errorEvent, 'stopImmediatePropagation');
    window.dispatchEvent(errorEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopImmediate).toHaveBeenCalled();
    expect(observabilityService.getSnapshot().length).toBe(baseline);
  });

  it('prevents a Vite preload error so the route loader can retry it', () => {
    observabilityService.installGlobalErrorHandlers();
    const preloadError = new CustomEvent('vite:preloadError', {
      cancelable: true,
      detail: new TypeError('Failed to fetch dynamically imported module'),
    });

    const dispatchResult = window.dispatchEvent(preloadError);

    expect(dispatchResult).toBe(false);
    expect(preloadError.defaultPrevented).toBe(true);
  });

  it('records the error Vite carries in `payload`, not just the event name', () => {
    observabilityService.installGlobalErrorHandlers();
    // Vite dispatches a plain Event with the failure on `payload`. In F6-04 that
    // failure was a module-evaluation ReferenceError, and it was lost.
    const preloadError = Object.assign(new Event('vite:preloadError', { cancelable: true }), {
      payload: new ReferenceError("Cannot access 'Tk' before initialization"),
    });
    window.dispatchEvent(preloadError);

    const recorded = observabilityService.getSnapshot().map((entry) => entry.message).join('\n');
    expect(recorded).toContain("Cannot access 'Tk' before initialization");
  });
});
