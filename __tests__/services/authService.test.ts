/**
 * Specs for the Firebase Auth boundary.
 *
 * These could not be written before: the calls lived inside a React context,
 * so exercising "what happens when auth is unavailable" meant rendering a
 * provider tree. That is the practical cost of an SDK held in a component, and
 * the reason the extraction was worth doing beyond tidiness.
 *
 * The degraded mode is the interesting half. `auth` is null whenever the
 * `VITE_FIREBASE_*` variables are unset — a supported way to run the app, not
 * a fault — and the old code checked for it at some call sites and not others.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(async () => ({})),
  signInWithPopup: vi.fn(async () => ({})),
  signInAnonymously: vi.fn(async () => ({ user: { uid: 'dev-1' } })),
  signOut: vi.fn(async () => undefined),
  sendPasswordResetEmail: vi.fn(async () => undefined),
  reauthenticateWithCredential: vi.fn(async () => undefined),
  updatePassword: vi.fn(async () => undefined),
  updateProfile: vi.fn(async () => undefined),
  getIdTokenResult: vi.fn(async () => ({ claims: { role: 'architect' } })),
  credential: vi.fn((email: string, password: string) => ({ email, password })),
}));

vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: mocks.credential },
  GoogleAuthProvider: class {},
  createUserWithEmailAndPassword: vi.fn(),
  getIdTokenResult: mocks.getIdTokenResult,
  onAuthStateChanged: mocks.onAuthStateChanged,
  reauthenticateWithCredential: mocks.reauthenticateWithCredential,
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
  signInAnonymously: mocks.signInAnonymously,
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  signInWithPopup: mocks.signInWithPopup,
  signOut: mocks.signOut,
  updatePassword: mocks.updatePassword,
  updateProfile: mocks.updateProfile,
}));

const firebaseState = vi.hoisted(() => ({ auth: { currentUser: null } as unknown, isFirebaseAvailable: true }));
vi.mock('../../firebase', () => firebaseState);

import {
  AuthUnavailableError,
  currentUser,
  isAuthAvailable,
  observeAuthState,
  readRoleClaim,
  reauthenticateAndUpdatePassword,
  sendPasswordReset,
  signInAnonymouslyForDevBypass,
  signInWithEmail,
  signInWithGooglePopup,
  signOutCurrentUser,
  updateDisplayName,
} from '../../services/identity/authService';

const withAuth = () => {
  firebaseState.auth = { currentUser: { uid: 'u1', email: 'u1@empresa.com' } };
  firebaseState.isFirebaseAvailable = true;
};
const withoutAuth = () => {
  firebaseState.auth = null;
  firebaseState.isFirebaseAvailable = false;
};

beforeEach(() => {
  vi.clearAllMocks();
  withAuth();
});

describe('when Firebase is configured', () => {
  it('signs in with email', async () => {
    await signInWithEmail('u1@empresa.com', 'secreto');
    expect(mocks.signInWithEmailAndPassword).toHaveBeenCalledWith(firebaseState.auth, 'u1@empresa.com', 'secreto');
  });

  it('signs in with Google', async () => {
    await signInWithGooglePopup();
    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
  });

  it('returns the user from the developer bypass rather than the credential wrapper', async () => {
    expect(await signInAnonymouslyForDevBypass()).toMatchObject({ uid: 'dev-1' });
  });

  it('forces a token refresh when reading the role claim', async () => {
    // Not an optimisation to skip: a freshly granted role must not require
    // signing out, and a revoked one must not survive for up to an hour.
    const user = { uid: 'u1' } as never;
    expect(await readRoleClaim(user)).toBe('architect');
    expect(mocks.getIdTokenResult).toHaveBeenCalledWith(user, true);
  });

  it('re-authenticates before changing a password, in that order', async () => {
    const order: string[] = [];
    mocks.reauthenticateWithCredential.mockImplementation(async () => { order.push('reauth'); });
    mocks.updatePassword.mockImplementation(async () => { order.push('update'); });

    await reauthenticateAndUpdatePassword({ uid: 'u1' } as never, 'u1@empresa.com', 'vieja', 'nueva-larga');

    // Exposed as one function precisely so a call site cannot do only the
    // second half.
    expect(order).toEqual(['reauth', 'update']);
  });

  it('updates only the display name', async () => {
    await updateDisplayName({ uid: 'u1' } as never, 'Nombre Nuevo');
    expect(mocks.updateProfile).toHaveBeenCalledWith({ uid: 'u1' }, { displayName: 'Nombre Nuevo' });
  });

  it('reports the current identity', () => {
    expect(currentUser()).toMatchObject({ uid: 'u1' });
    expect(isAuthAvailable()).toBe(true);
  });

  it('subscribes to state changes through the SDK', () => {
    const unsubscribe = vi.fn();
    mocks.onAuthStateChanged.mockReturnValue(unsubscribe);
    const listener = vi.fn();
    expect(observeAuthState(listener)).toBe(unsubscribe);
    expect(mocks.onAuthStateChanged).toHaveBeenCalledWith(firebaseState.auth, listener);
  });
});

describe('when Firebase is not configured — a supported degraded mode', () => {
  beforeEach(withoutAuth);

  it('reports itself unavailable instead of pretending', () => {
    expect(isAuthAvailable()).toBe(false);
    expect(currentUser()).toBeNull();
  });

  it('tells the subscriber there is no session, and its cleanup still works', () => {
    // A caller's teardown must not have to branch on configuration.
    const listener = vi.fn();
    const unsubscribe = observeAuthState(listener);
    expect(listener).toHaveBeenCalledWith(null);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('signing out is a no-op — there is nothing to end', () => {
    return expect(signOutCurrentUser()).resolves.toBeUndefined();
  });

  it.each([
    ['signInWithEmail', () => signInWithEmail('a@b.com', 'x')],
    ['signInWithGooglePopup', () => signInWithGooglePopup()],
    ['signInAnonymouslyForDevBypass', () => signInAnonymouslyForDevBypass()],
    ['sendPasswordReset', () => sendPasswordReset('a@b.com')],
  ])('%s fails with a typed error rather than a null dereference', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it('names the operation in the error, so the message is actionable', async () => {
    await expect(signInWithEmail('a@b.com', 'x')).rejects.toThrow(/signInWithEmail/);
  });
});
