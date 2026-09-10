/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { isDeveloperLoginAllowed, sanitizeGeneratedHtml } from '../../lib/security';

describe('there is exactly one role model', () => {
  /**
   * This module used to define its own `AuthRole`, its own privileged set and
   * its own `parseAuthRole`, in parallel with `lib/authz`. Two definitions of
   * who may do what drift, and the drift is invisible because both compile.
   */
  it('does not redeclare roles here', () => {
    const source = readFileSync('lib/security.ts', 'utf8');
    expect(source).not.toMatch(/export type AuthRole/);
    expect(source).not.toMatch(/PUBLIC_REGISTRATION_ROLE/);
    expect(source).not.toMatch(/export function parseAuthRole/);
    expect(source).not.toMatch(/hasAdminAccess|hasSuperadminAccess/);
  });

  it('no longer offers a first-user superadmin bootstrap', () => {
    // The bootstrap made whoever reached the URL first the owner of the
    // deployment. With public registration gone it has no path to run, and a
    // dormant escalation path is still an escalation path.
    const source = readFileSync('lib/security.ts', 'utf8');
    expect(source).not.toContain('isFirstUserSuperadminBootstrapAllowed');
  });

  it('keeps the sanitiser, which is not a question about roles', () => {
    expect(sanitizeGeneratedHtml('<script>alert(1)</script><p>ok</p>')).toBe('<p>ok</p>');

    // The assertion is the guarantee, not the repair. The old regex rewrote a
    // `javascript:` href to `href="#"`; `lib/richText` drops the attribute
    // instead, which leaves the anchor genuinely inert rather than merely
    // pointing somewhere harmless. Pinning the old mechanism would have made
    // this test fail on a strictly safer implementation.
    const link = sanitizeGeneratedHtml('<a href="javascript:alert(1)">x</a>');
    expect(link).not.toContain('javascript:');
    expect(link).toContain('x');
  });
});

describe('lib/security — environment-gated bypasses', () => {
  const originalEnv = { ...import.meta.env };

  beforeEach(() => {
    vi.stubGlobal('import', { meta: { env: { ...originalEnv } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('developer bypass is disabled by default', () => {
    const env = import.meta.env as { DEV?: boolean; PROD?: boolean; VITE_ENABLE_DEV_LOGIN?: string };
    env.PROD = false;
    env.DEV = true;
    env.VITE_ENABLE_DEV_LOGIN = undefined;
    expect(isDeveloperLoginAllowed()).toBe(false);
  });

  it('developer bypass is permitted only with both DEV and the explicit flag', () => {
    const env = import.meta.env as { DEV?: boolean; PROD?: boolean; VITE_ENABLE_DEV_LOGIN?: string };
    env.PROD = false;
    env.DEV = true;
    env.VITE_ENABLE_DEV_LOGIN = 'true';
    expect(isDeveloperLoginAllowed()).toBe(true);
  });

  it('developer bypass is NEVER permitted in production builds', () => {
    const env = import.meta.env as { DEV?: boolean; PROD?: boolean; VITE_ENABLE_DEV_LOGIN?: string };
    env.PROD = true;
    env.DEV = false;
    env.VITE_ENABLE_DEV_LOGIN = 'true';
    expect(isDeveloperLoginAllowed()).toBe(false);
  });

});
