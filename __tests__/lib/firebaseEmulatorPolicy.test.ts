import { describe, expect, it } from 'vitest';
import { shouldUseFirebaseEmulators } from '../../lib/firebaseEmulatorPolicy';

describe('Firebase emulator policy', () => {
  it('stays disabled unless explicitly requested', () => {
    expect(shouldUseFirebaseEmulators({}, 'localhost')).toBe(false);
  });

  it('allows only the dedicated demo project on loopback', () => {
    expect(shouldUseFirebaseEmulators({
      VITE_FIREBASE_USE_EMULATORS: 'true',
      VITE_FIREBASE_PROJECT_ID: 'demo-arky-e2e',
    }, '127.0.0.1')).toBe(true);
  });

  it('refuses a real project or a non-loopback host', () => {
    expect(() => shouldUseFirebaseEmulators({
      VITE_FIREBASE_USE_EMULATORS: 'true',
      VITE_FIREBASE_PROJECT_ID: 'production-project',
    }, 'localhost')).toThrow(/demo-arky-e2e/);

    expect(() => shouldUseFirebaseEmulators({
      VITE_FIREBASE_USE_EMULATORS: 'true',
      VITE_FIREBASE_PROJECT_ID: 'demo-arky-e2e',
    }, 'preview.example.com')).toThrow(/loopback/);
  });
});
