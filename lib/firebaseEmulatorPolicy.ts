/** A production bundle may reach emulators only on loopback and a demo project. */
export interface FirebaseEmulatorEnvironment {
  readonly VITE_FIREBASE_USE_EMULATORS?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function shouldUseFirebaseEmulators(
  env: FirebaseEmulatorEnvironment,
  hostname: string,
): boolean {
  if (env.VITE_FIREBASE_USE_EMULATORS !== 'true') return false;
  if (env.VITE_FIREBASE_PROJECT_ID !== 'demo-arky-e2e') {
    throw new Error('Firebase emulators are restricted to the demo-arky-e2e project.');
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error('Firebase emulators are restricted to a loopback host.');
  }
  return true;
}
