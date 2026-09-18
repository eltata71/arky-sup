import { describe, expect, it } from 'vitest';

import { looksLikeProtectionWall } from '../../scripts/deploy/protectionWall.mjs';

/**
 * Los cuerpos de esta prueba son los que devolvió el despliegue real del
 * 2026-09-18 (ejecución #46), no inventados.
 *
 * El defecto que fija: la detección anterior exigía un estado 401 o 403, y el
 * muro de Vercel contesta **200 con HTML** en la página. Así que el smoke
 * saludaba la pantalla de login de Vercel como si fuera la aplicación, y
 * después acusaba a `/api/ai` de devolver un 401 mal formado. Un despliegue
 * correcto quedaba en rojo, señalando al componente equivocado.
 *
 * Los dos casos negativos son la mitad importante: si esto diera positivo de
 * más, un fallo real del proxy se archivaría como «protegido» y el smoke
 * pasaría en verde sobre un despliegue roto — que es peor que el rojo que
 * vinimos a arreglar.
 */
describe('Vercel Authentication wall detection', () => {
  it('recognises the login wall served as 200 HTML on the page', () => {
    const body = '<html><head><title>Authentication Required</title>'
      + '<meta name="_vercel_sso_nonce" content="abc"></head></html>';
    expect(looksLikeProtectionWall({ body })).toBe(true);
  });

  it('recognises the wall intercepting a function with its own 401 JSON', () => {
    const body = '{"protection":{"vercel_auth_callback":"https://vercel.com/sso-api?url=…&nonce=1"}}';
    expect(looksLikeProtectionWall({ body })).toBe(true);
  });

  it('recognises the "Protected deployment" envelope', () => {
    const body = '{"error":{"code":"401","message":"Protected deployment"}}';
    expect(looksLikeProtectionWall({ body })).toBe(true);
  });

  it('recognises a redirect that carried the request to another host', () => {
    expect(looksLikeProtectionWall({
      body: '<html>login</html>',
      requestedUrl: 'https://arky-sup.vercel.app/',
      finalUrl: 'https://vercel.com/sso-api?url=x',
    })).toBe(true);
  });

  it('does not mistake the application itself for the wall', () => {
    const body = '<!DOCTYPE html><html lang="es"><head>'
      + '<title>Arky · Oficina de Arquitectura</title></head>'
      + '<body><div id="root">Inicializando aplicación resiliente</div></body></html>';
    expect(looksLikeProtectionWall({
      body,
      requestedUrl: 'https://arky-sup.vercel.app/',
      finalUrl: 'https://arky-sup.vercel.app/',
    })).toBe(false);
  });

  it('does not swallow a genuine unauthenticated answer from the proxy', () => {
    // Éste es el 401 que el smoke existe para exigir. Confundirlo con el muro
    // dejaría el contrato del proxy sin comprobar para siempre.
    const body = '{"requestId":"aiproxy-mu7govo6","error":"unauthenticated","source":"proxy"}';
    expect(looksLikeProtectionWall({ body })).toBe(false);
  });

  it('does not swallow the SPA fallback capturing an /api/* route', () => {
    // El fallo que ya ocurrió una vez (F5): el rewrite devolviendo la página.
    const body = '<!DOCTYPE html><html lang="es"><head><title>Arky</title></head></html>';
    expect(looksLikeProtectionWall({ body })).toBe(false);
  });
});
