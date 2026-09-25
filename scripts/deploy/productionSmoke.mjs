#!/usr/bin/env node
/**
 * Smoke de despliegue: comprueba que lo que acaba de publicarse responde como
 * la aplicación y no como otra cosa.
 *
 * Dos comprobaciones, y ninguna de las dos es decorativa:
 *
 *  1. **La SPA sirve HTML.** Un despliegue puede quedar `READY` y servir un
 *     404 de plataforma; el estado del deploy no lo distingue.
 *  2. **`/api/ai` contesta el envoltorio del proxy, no el HTML del SPA.** Ese
 *     fallo concreto ya ocurrió: el rewrite `/(.*) → /` capturaba `/api/*` y
 *     el cliente recibía la página de la aplicación con un 200 alegre en vez
 *     de una respuesta del proxy. `vercel.json` lo arregló y
 *     `__tests__/config/vercelApiRoutes.test.ts` lo fija en el repositorio,
 *     pero sólo una llamada real contra el host publicado demuestra que el
 *     despliegue lo respeta.
 *
 * Sin credenciales: se envía una petición deliberadamente **no autenticada**.
 * La respuesta correcta es `401 {"error":"unauthenticated",...}`, que prueba a
 * la vez que la función existe, que el enrutado llega a ella y que el gate de
 * identidad está activo. Un 200 aquí sería el fallo grave opuesto.
 */

import { looksLikeProtectionWall } from './protectionWall.mjs';

const target = process.argv[2];

if (!target) {
  console.error('[deploy-smoke] Falta la URL del despliegue.');
  process.exit(1);
}

const base = target.startsWith('http') ? target.trim() : `https://${target.trim()}`;
const failures = [];

/**
 * El proyecto tiene *Vercel Authentication* activada
 * (`ssoProtection: all_except_custom_domains`) y no tiene dominio propio, así
 * que una petición sin credenciales a la URL del despliegue recibe el muro de
 * inicio de sesión de Vercel y no la aplicación.
 *
 * `VERCEL_AUTOMATION_BYPASS_SECRET` es el mecanismo previsto para esto: Vercel
 * → *Project Settings* → *Deployment Protection* → *Protection Bypass for
 * Automation*. Con él, el smoke ve la aplicación real.
 *
 * Sin él, el smoke **no falla el despliegue**: no ha podido comprobar nada, y
 * un rojo aquí no revertiría un despliegue que ya está publicado ni describiría
 * un fallo de la aplicación. Lo que hace es decirlo en voz alta, con el remedio,
 * en vez de pasar en verde fingiendo que comprobó algo.
 */
const bypass = (process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? '').trim();
const headers = bypass ? { 'x-vercel-protection-bypass': bypass } : {};
let protectionBlocked = false;

const noteProtection = () => {
  if (protectionBlocked) return;
  protectionBlocked = true;
  console.warn(
    `[deploy-smoke] OMITIDO — ${base} está detrás de Vercel Authentication y no hay `
    + 'VERCEL_AUTOMATION_BYPASS_SECRET. El despliegue se publicó; el smoke no pudo '
    + 'comprobarlo. Remedio: Project Settings → Deployment Protection → Protection '
    + 'Bypass for Automation, y añadir el valor como secreto del repositorio.',
  );
};

const record = (check, detail) => {
  failures.push(`${check}: ${detail}`);
  console.error(`[deploy-smoke] FALLO ${check} — ${detail}`);
};

async function checkSpa() {
  const response = await fetch(base, { redirect: 'follow', headers });
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  // El cuerpo se lee siempre: el muro contesta 200 con HTML, así que mirarlo
  // sólo cuando la respuesta no es `ok` es exactamente cómo se coló antes.
  const body = await response.text().catch(() => '');
  if (looksLikeProtectionWall({ body, finalUrl: response.url, requestedUrl: base })) {
    noteProtection();
    return;
  }
  if (!response.ok) {
    record('spa', `esperaba 2xx en ${base}, recibió ${response.status}`);
    return;
  }
  if (!contentType.includes('html')) {
    record('spa', `esperaba HTML en ${base}, recibió content-type "${contentType}"`);
    return;
  }
  console.log(`[deploy-smoke] OK spa — ${response.status} ${contentType}`);
}

async function checkProxyContract(path) {
  if (protectionBlocked) return;

  const url = `${base}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ prompt: 'deploy smoke' }),
  });
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  const raw = await response.text().catch(() => '');

  // El muro también intercepta las funciones, y ahí contesta 401 con su propio
  // JSON. Sin esta rama, ese 401 se lee como un envoltorio de proxy mal formado.
  if (looksLikeProtectionWall({ body: raw, finalUrl: response.url, requestedUrl: url })) {
    noteProtection();
    return;
  }

  // El síntoma que este paso existe para detectar: el fallback del SPA
  // devolviendo su HTML por una ruta de función.
  if (contentType.includes('html')) {
    record(path, 'la ruta devuelve HTML del SPA — el rewrite está capturando /api/*');
    return;
  }
  if (response.status !== 401) {
    record(path, `esperaba 401 sin credenciales, recibió ${response.status} ${raw.slice(0, 160)}`);
    return;
  }
  let body = null;
  try { body = JSON.parse(raw); } catch { /* un cuerpo no-JSON se trata como ausente */ }
  if (!body || body.error !== 'unauthenticated') {
    record(path, `401 sin el envoltorio esperado del proxy: ${raw.slice(0, 160)}`);
    return;
  }
  console.log(`[deploy-smoke] OK ${path} — 401 unauthenticated (requestId ${body.requestId ?? 'n/d'})`);
}

await checkSpa();
await checkProxyContract('/api/ai');
// `/api/gemini` se retiró en F6-01: un solo proxy, el agnóstico.

if (failures.length > 0) {
  console.error(`[deploy-smoke] ${failures.length} comprobación(es) fallida(s) sobre ${base}.`);
  process.exit(1);
}

if (protectionBlocked) {
  console.warn(`[deploy-smoke] SIN VERIFICAR — ${base} está protegido y no hay secreto de bypass.`);
  process.exit(0);
}

console.log(`[deploy-smoke] OK — ${base} responde como la aplicación desplegada.`);
