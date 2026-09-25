/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { describe, expect, it, vi } from 'vitest';
import { importWithRetry, isChunkLoadError } from '../../../components/routing/lazyWithRetry';

const instantSleep = async (): Promise<void> => {};
const fakeModule = { default: () => null };

const chunkError = (msg = 'Failed to fetch dynamically imported module: /assets/Workspace.js') =>
  new Error(msg);

describe('isChunkLoadError', () => {
  it('recognises the common chunk-load failure shapes', () => {
    expect(isChunkLoadError(new Error('Loading chunk 5 failed'))).toBe(true);
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed'))).toBe(true);
    expect(isChunkLoadError(new Error('Load failed'))).toBe(true);
    expect(isChunkLoadError('error loading dynamically imported module')).toBe(true);
  });

  it('does not treat genuine application errors as chunk failures', () => {
    expect(isChunkLoadError(new ReferenceError('x is not defined'))).toBe(false);
    expect(isChunkLoadError(new TypeError('cannot read properties of undefined'))).toBe(false);
  });
});

describe('importWithRetry', () => {
  it('returns the module on the first successful attempt', async () => {
    const factory = vi.fn(async () => fakeModule);
    const result = await importWithRetry(factory, { sleep: instantSleep });
    expect(result).toBe(fakeModule);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('retries a transient chunk failure and then succeeds', async () => {
    let calls = 0;
    const factory = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw chunkError();
      return fakeModule;
    });
    const result = await importWithRetry(factory, { retries: 3, sleep: instantSleep });
    expect(result).toBe(fakeModule);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('retries an import that resolved without a module — a preload failure Vite swallowed', async () => {
    // With `vite:preloadError` prevented, Vite resolves the import to
    // `undefined` instead of rejecting it. Returning that to React.lazy crashed
    // the route reading `.default` (F6-04).
    let calls = 0;
    const factory = vi.fn(async () => {
      calls += 1;
      return (calls < 2 ? undefined : fakeModule) as unknown as typeof fakeModule;
    });
    const result = await importWithRetry(factory, { retries: 2, sleep: instantSleep });
    expect(result).toBe(fakeModule);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('never hands React a module without `default`, even when every attempt resolves empty', async () => {
    const factory = vi.fn(async () => undefined as unknown as typeof fakeModule);
    await expect(importWithRetry(factory, {
      retries: 1,
      sleep: instantSleep,
      isReloadGuarded: () => true,
    })).rejects.toThrowError(/resolved without a module/);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('surfaces a genuine module-evaluation error immediately without retrying', async () => {
    const factory = vi.fn(async () => {
      throw new ReferenceError('broken module');
    });
    await expect(
      importWithRetry(factory, { retries: 3, sleep: instantSleep }),
    ).rejects.toThrowError('broken module');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('reloads once when every retry fails and the guard is not set', async () => {
    const factory = vi.fn(async () => {
      throw chunkError();
    });
    const reload = vi.fn();
    const markReloaded = vi.fn();
    // The promise intentionally never settles (keeps the Suspense fallback up
    // during the imminent reload), so we assert on the side effects instead.
    void importWithRetry(factory, {
      retries: 2,
      sleep: instantSleep,
      reload,
      isReloadGuarded: () => false,
      markReloaded,
    });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(markReloaded).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('throws instead of reloading when a reload already happened this session', async () => {
    const factory = vi.fn(async () => {
      throw chunkError();
    });
    const reload = vi.fn();
    await expect(
      importWithRetry(factory, {
        retries: 1,
        sleep: instantSleep,
        reload,
        isReloadGuarded: () => true,
      }),
    ).rejects.toThrowError(/dynamically imported module/);
    expect(reload).not.toHaveBeenCalled();
  });
});
