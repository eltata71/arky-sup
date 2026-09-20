// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { authReturnUrl } from '../../lib/authReturnUrl';

describe('authReturnUrl', () => {
  it('devuelve /auth sobre el origen actual', () => {
    expect(authReturnUrl()).toBe(`${window.location.origin}/auth`);
  });

  it('devuelve undefined fuera del navegador, en vez de inventar un dominio', () => {
    // `redirectTo: undefined` deja que el SDK use la Site URL, que es el
    // comportamiento correcto cuando nadie puede decir desde dónde se pidió.
    vi.stubGlobal('window', undefined);
    expect(authReturnUrl()).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
