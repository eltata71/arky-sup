/**
 * An account comes into existence in exactly one place.
 *
 * The rule the product is built on is not a preference: nobody creates their own
 * account. Enforcing it is not one change but the *absence* of a capability
 * across several files, and an absence is precisely what a refactor restores by
 * accident — someone re-adds `register` to the auth context because a screen
 * seems to want it, and public sign-up is back with no test failing.
 *
 * So the first half of this file is a source scan over the auth surface, and the
 * second half exercises the one sanctioned path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/* --------------------------------------------------------- the absence */

const read = (file: string) => readFileSync(file, 'utf8');

/**
 * The file with its comments stripped.
 *
 * Negative assertions run against this: a comment explaining why a phrase must
 * never be shown would otherwise trip the check that the phrase is never shown.
 */
const readCode = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('nobody can create their own account', () => {
  it('the auth context exposes no registration method', () => {
    const source = readCode('context/AuthContext.tsx');
    expect(source).not.toMatch(/\bregister\s*[,:(]/);
    expect(source).not.toContain('createUserWithEmailAndPassword');
  });

  it('the sign-in screen offers no registration mode', () => {
    const source = readCode('pages/AuthPage.tsx');
    expect(source).not.toContain('createUserWithEmailAndPassword');
    // The old screen toggled with `isLogin`; there is no second mode that
    // creates anything now.
    expect(source).not.toMatch(/setIsLogin/);
    expect(source).not.toMatch(/Regístrate/);
  });

  it('offers the two things a person may legitimately do alone', () => {
    const source = read('pages/AuthPage.tsx');
    expect(source).toContain('sendPasswordReset');
    expect(source).toContain('¿Olvidaste tu contraseña?');
  });

  it('does not leak whether an address has an account', () => {
    // A recovery form that answers differently for a known address is a
    // directory of who works here, readable by anyone.
    const source = readCode('pages/AuthPage.tsx');
    expect(source).toMatch(/Si esa dirección tiene una cuenta/);
    expect(source).not.toMatch(/no encontramos|no existe esa cuenta|correo no registrado/i);
  });

  it('creates auth accounts only from the provisioning service', () => {
    // The one call site in the app. `api/` and tests are out of scope; this is
    // about the client surface a visitor can reach.
    const surface = [
      'context/AuthContext.tsx',
      'pages/AuthPage.tsx',
      'pages/UserManagementPage.tsx',
      'services/identity/userService.ts',
    ];
    for (const file of surface) {
      expect(readCode(file), `${file} crea cuentas de autenticación`).not.toContain(
        'createUserWithEmailAndPassword',
      );
    }
    expect(read('services/identity/userProvisioningService.ts')).toContain(
      'createUserWithEmailAndPassword',
    );
  });

  it('never lets an administrator choose someone elses first password', () => {
    const service = readCode('services/identity/userProvisioningService.ts');
    // The secret is generated, used once, and never returned to the caller.
    expect(service).toContain('crypto.getRandomValues');
    expect(service).toContain('sendPasswordResetEmail');
    expect(service).not.toMatch(/password\s*[:,]\s*secret/);

    const page = readCode('pages/UserManagementPage.tsx');
    expect(page).not.toMatch(/type="password"/);
  });

  it('does not bootstrap a superadmin from whoever registers first', () => {
    // The old bootstrap made the first visitor to reach the URL the owner of
    // the deployment.
    const source = readCode('context/AuthContext.tsx');
    expect(source).not.toContain('ALLOW_FIRST_USER_SUPERADMIN');
    expect(source).not.toMatch(/first.?user.?superadmin/i);
  });
});

/* ------------------------------------------------------- the one path */

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  updateProfile: vi.fn(),
  sendReset: vi.fn(),
  signOut: vi.fn(),
  deleteApp: vi.fn(),
  createUserProfile: vi.fn(),
}));

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: 'arky-user-provisioning' })),
  getApp: vi.fn(() => ({ name: 'arky-user-provisioning' })),
  getApps: vi.fn(() => []),
  deleteApp: mocks.deleteApp,
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ name: 'secondary' })),
  createUserWithEmailAndPassword: mocks.createUser,
  updateProfile: mocks.updateProfile,
  sendPasswordResetEmail: mocks.sendReset,
  signOut: mocks.signOut,
}));

vi.mock('../../firebase', () => ({
  firebaseConfig: { apiKey: 'test' },
  isFirebaseAvailable: true,
  db: {},
  auth: {},
}));

vi.mock('../../services/identity/userService', () => ({
  userService: { createUserProfile: mocks.createUserProfile },
}));

vi.mock('../../services/observability', () => ({
  observabilityService: { recordWarning: vi.fn(), reportError: vi.fn() },
}));

describe('provisionUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUser.mockResolvedValue({ user: { uid: 'uid-1' } });
    mocks.updateProfile.mockResolvedValue(undefined);
    mocks.sendReset.mockResolvedValue(undefined);
    mocks.createUserProfile.mockResolvedValue(undefined);
    mocks.signOut.mockResolvedValue(undefined);
    mocks.deleteApp.mockResolvedValue(undefined);
  });

  it('creates the account, writes the profile and sends the invitation', async () => {
    const { provisionUser } = await import('../../services/identity/userProvisioningService');
    const result = await provisionUser({
      email: '  Ana@Empresa.com ',
      displayName: 'Ana Torres',
      role: 'architect',
    });

    expect(result.ok).toBe(true);
    // Normalised on the way in so the directory has one spelling per person.
    expect(mocks.createUser).toHaveBeenCalledWith(expect.anything(), 'ana@empresa.com', expect.any(String));
    expect(mocks.createUserProfile).toHaveBeenCalledWith({
      uid: 'uid-1',
      email: 'ana@empresa.com',
      displayName: 'Ana Torres',
      role: 'architect',
    });
    expect(mocks.sendReset).toHaveBeenCalledWith(expect.anything(), 'ana@empresa.com');
  });

  it('generates a secret nobody chose and nobody sees', async () => {
    const { provisionUser } = await import('../../services/identity/userProvisioningService');
    await provisionUser({ email: 'a@b.com', displayName: 'Ana Torres' });

    const secret = mocks.createUser.mock.calls[0][2] as string;
    expect(secret.length).toBeGreaterThan(24);
    // It is not returned, not logged as a value, and not derived from the input.
    expect(secret).not.toContain('a@b.com');

    mocks.createUser.mockClear();
    await provisionUser({ email: 'a@b.com', displayName: 'Ana Torres' });
    expect(mocks.createUser.mock.calls[0][2]).not.toBe(secret);
  });

  it('defaults to the least capable role', async () => {
    const { provisionUser } = await import('../../services/identity/userProvisioningService');
    await provisionUser({ email: 'a@b.com', displayName: 'Ana Torres' });
    expect(mocks.createUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'viewer' }),
    );
  });

  it('always leaves the secondary session signed out, even when it fails', async () => {
    mocks.createUserProfile.mockRejectedValue(new Error('permission-denied'));
    const { provisionUser } = await import('../../services/identity/userProvisioningService');

    const result = await provisionUser({ email: 'a@b.com', displayName: 'Ana Torres' });

    expect(result.ok).toBe(false);
    // A lingering session on the secondary app is a second identity nobody is
    // watching — and it belongs to the account that just failed to be governed.
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.deleteApp).toHaveBeenCalled();
  });

  it('explains a duplicate address instead of reporting a generic failure', async () => {
    mocks.createUser.mockRejectedValue(new Error('auth/email-already-in-use'));
    const { provisionUser } = await import('../../services/identity/userProvisioningService');

    const result = await provisionUser({ email: 'a@b.com', displayName: 'Ana Torres' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('email_already_in_use');
    expect(result.message).toMatch(/Ya existe una cuenta/);
  });

  it('refuses malformed input before touching Firebase', async () => {
    const { provisionUser } = await import('../../services/identity/userProvisioningService');

    expect((await provisionUser({ email: 'sin-arroba', displayName: 'Ana' })).reason).toBe('invalid_email');
    expect((await provisionUser({ email: 'a@b.com', displayName: 'A' })).reason).toBe('invalid_name');
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});
