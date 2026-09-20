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

  it('creates auth accounts only through the provisioning service', () => {
    // La superficie que un visitante puede alcanzar. Crear una identidad
    // necesita la clave de servicio, así que el navegador no puede hacerlo
    // aunque quisiera; lo que esta prueba impide es que alguien vuelva a poner
    // esa clave a su alcance.
    const surface = [
      'context/AuthContext.tsx',
      'pages/AuthPage.tsx',
      'pages/UserManagementPage.tsx',
      'services/identity/userService.ts',
      'services/identity/userProvisioningService.ts',
    ];
    for (const file of surface) {
      const code = readCode(file);
      expect(code, `${file} crea cuentas de autenticación`).not.toContain('auth.admin');
      expect(code, `${file} usa la clave de servicio`).not.toMatch(/SERVICE_ROLE/);
    }
    // El único sitio que la usa, y corre en el servidor.
    expect(read('supabase/functions/provision-user/index.ts')).toContain('inviteUserByEmail');
  });

  it('never lets an administrator choose someone elses first password', () => {
    // No hay contraseña que elegir: `inviteUserByEmail` crea la cuenta sin
    // credencial y manda un enlace. El secreto de un solo uso que la versión
    // anterior generaba desapareció con el API que lo exigía, que es una forma
    // mejor de cumplir la misma regla.
    const service = readCode('services/identity/userProvisioningService.ts');
    expect(service).not.toMatch(/password/i);

    const page = readCode('pages/UserManagementPage.tsx');
    expect(page).not.toMatch(/type="password"/);
  });

  it('checks the caller permission on the server, not only in the screen', () => {
    // La Edge Function es la única que puede crear identidades, así que una
    // que aceptara cualquier llamada sería un registro abierto con otro nombre.
    const fn = read('supabase/functions/provision-user/index.ts');
    expect(fn).toContain("rpc('current_permissions')");
    expect(fn).toContain("includes('users:create')");
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
  provisionProfile: vi.fn(),
  currentAccessToken: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../../services/identity/userService', () => ({
  userService: { provisionProfile: mocks.provisionProfile },
}));

vi.mock('../../services/identity/authService', () => ({
  currentAccessToken: mocks.currentAccessToken,
  isAuthAvailable: () => true,
}));

vi.mock('../../services/observability', () => ({
  observabilityService: { recordWarning: vi.fn(), reportError: vi.fn() },
}));

const invited = (body: Record<string, unknown>, status = 200) =>
  ({ status, ok: status < 400, json: async () => body });

describe('provisionUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    vi.stubGlobal('window', { location: { origin: 'https://arky.test' } });
    mocks.currentAccessToken.mockResolvedValue('admin-token');
    mocks.provisionProfile.mockResolvedValue(undefined);
    mocks.fetch.mockResolvedValue(invited({ ok: true, uid: 'uid-1', email: 'ana@empresa.com' }));
  });

  it('invites the identity and writes the profile with the administrator session', async () => {
    const { provisionUser } = await import('../../services/identity/userProvisioningService');
    const result = await provisionUser({
      email: '  Ana@Empresa.com ',
      displayName: 'Ana Torres',
      role: 'architect',
    });

    expect(result.ok).toBe(true);
    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    // Normalised on the way in so the directory has one spelling per person.
    expect(JSON.parse(String(init.body))).toMatchObject({
      action: 'invite', email: 'ana@empresa.com', displayName: 'Ana Torres',
    });
    // El token del administrador viaja: la función comprueba su permiso.
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer admin-token');
    // El rol lo escribe la RPC, con la sesión del administrador y su auditoría.
    expect(mocks.provisionProfile).toHaveBeenCalledWith('uid-1', 'architect', 'Ana Torres');
  });

  it('defaults to the least capable role', async () => {
    const { provisionUser } = await import('../../services/identity/userProvisioningService');
    await provisionUser({ email: 'a@b.com', displayName: 'Ana Torres' });
    expect(mocks.provisionProfile).toHaveBeenCalledWith('uid-1', 'viewer', 'Ana Torres');
  });

  it('does not write a profile when the invitation failed', async () => {
    mocks.fetch.mockResolvedValue(invited({ error: 'invite_failed' }, 400));
    const { provisionUser } = await import('../../services/identity/userProvisioningService');

    const result = await provisionUser({ email: 'a@b.com', displayName: 'Ana Torres' });

    expect(result.ok).toBe(false);
    // Un perfil con rol para una identidad que no existe es una fila que
    // concede permisos a nadie, y que el siguiente invitado heredaría.
    expect(mocks.provisionProfile).not.toHaveBeenCalled();
  });

  it('explains a duplicate address instead of reporting a generic failure', async () => {
    mocks.fetch.mockResolvedValue(invited({ error: 'email_already_in_use' }, 409));
    const { provisionUser } = await import('../../services/identity/userProvisioningService');

    const result = await provisionUser({ email: 'a@b.com', displayName: 'Ana Torres' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('email_already_in_use');
    expect(result.message).toMatch(/Ya existe una cuenta/);
  });

  it('says the session expired rather than failing opaquely', async () => {
    mocks.currentAccessToken.mockResolvedValue(null);
    const { provisionUser } = await import('../../services/identity/userProvisioningService');

    const result = await provisionUser({ email: 'a@b.com', displayName: 'Ana Torres' });
    expect(result.reason).toBe('unauthenticated');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('refuses malformed input before touching the backend', async () => {
    const { provisionUser } = await import('../../services/identity/userProvisioningService');

    expect((await provisionUser({ email: 'sin-arroba', displayName: 'Ana' })).reason).toBe('invalid_email');
    expect((await provisionUser({ email: 'a@b.com', displayName: 'A' })).reason).toBe('invalid_name');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
