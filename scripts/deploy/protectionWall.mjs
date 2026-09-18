/**
 * ¿Esta respuesta la escribió la aplicación, o el muro de Vercel Authentication?
 *
 * Vive aparte del smoke porque el smoke se ejecuta al importarlo —tiene `await`
 * de nivel superior y termina en `process.exit`—, así que la única forma de
 * probar esta decisión es que no comparta fichero con él.
 *
 * La decisión **no mira el código de estado**, y ahí estaba el defecto que este
 * módulo corrige: el muro contesta `200` con HTML en la página y `401` con JSON
 * en una función. Una detección basada en «401 o 403» saluda al muro de la
 * página como si fuera la aplicación, y luego acusa al proxy de devolver un 401
 * mal formado. El despliegue aparece roto cuando lo que pasa es que nadie pudo
 * mirarlo.
 *
 * Lo que sí mira son marcas que sólo Vercel escribe, y un redirect que se lleva
 * la petición a otro host. Ser estricto aquí importa en la dirección contraria:
 * si esto diera positivo de más, un fallo real del proxy se archivaría como
 * «protegido» y el smoke pasaría en verde sobre un despliegue roto.
 */
export const PROTECTION_MARKERS =
  /_vercel_sso_nonce|vercel_auth_callback|vercel\.com\/sso-api|Authentication Required|Protected deployment/i;

export function looksLikeProtectionWall({ body = '', finalUrl = '', requestedUrl = '' } = {}) {
  if (PROTECTION_MARKERS.test(body)) return true;
  try {
    if (finalUrl && requestedUrl && new URL(finalUrl).host !== new URL(requestedUrl).host) {
      return true;
    }
  } catch {
    // Una URL que no parsea no es señal de nada; que lo decidan las marcas.
  }
  return false;
}
