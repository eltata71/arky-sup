import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Verifies that the Firebase bootstrap module never throws out — even when
 * VITE_FIREBASE_* env vars are missing or the SDK rejects initialisation.
 *
 * Why this matters: a top-level `throw` from `firebase.ts` would kill the
 * `import './firebase'` graph in `index.tsx`, leaving the static
 * "Inicializando aplicación resiliente" shell visible forever. The new
 * bootstrap contract is: log + flag, never throw.
 */
describe('firebase bootstrap (graceful init)', () => {
    const originalEnv = { ...import.meta.env };

    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        // Restore env vars that we mutated.
        for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
            (import.meta.env as Record<string, unknown>)[key as string] = originalEnv[key];
        }
        vi.restoreAllMocks();
    });

    it('does not throw when minimum env vars are missing', async () => {
        const env = import.meta.env as Record<string, string | undefined>;
        env.VITE_FIREBASE_API_KEY = '';
        env.VITE_FIREBASE_PROJECT_ID = '';
        env.VITE_FIREBASE_APP_ID = '';

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(import('../../firebase')).resolves.toBeDefined();
        expect(warnSpy).toHaveBeenCalled();
        const firebaseModule = await import('../../firebase');
        expect(firebaseModule.isFirebaseAvailable).toBe(false);
        expect(firebaseModule.db).toBeNull();
        expect(firebaseModule.auth).toBeNull();
    });

    it('does not throw when firebase SDK initialisation rejects', async () => {
        const env = import.meta.env as Record<string, string | undefined>;
        env.VITE_FIREBASE_API_KEY = 'fake-key';
        env.VITE_FIREBASE_PROJECT_ID = 'fake-project';
        env.VITE_FIREBASE_APP_ID = 'fake-app';

        // Force the SDK to throw inside the try/catch — the module must swallow
        // the error and expose null services rather than tearing down the import.
        vi.doMock('firebase/app', () => ({
            initializeApp: vi.fn(() => { throw new Error('boom — invalid api key'); }),
            getApps: vi.fn(() => []),
            getApp: vi.fn(),
        }));
        vi.doMock('firebase/firestore', () => ({
            connectFirestoreEmulator: vi.fn(),
            getFirestore: vi.fn(),
        }));
        vi.doMock('firebase/auth', () => ({
            connectAuthEmulator: vi.fn(),
            getAuth: vi.fn(),
        }));
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(import('../../firebase')).resolves.toBeDefined();
        expect(errSpy).toHaveBeenCalled();
        const firebaseModule = await import('../../firebase');
        expect(firebaseModule.isFirebaseAvailable).toBe(false);
    });
});
