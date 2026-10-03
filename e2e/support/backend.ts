import { expect, type APIRequestContext, type Page, type Route } from '@playwright/test';

/**
 * Lo que un recorrido necesita del backend más allá de la interfaz (F6-04).
 *
 * Dos cosas, y ninguna esquiva lo que se prueba:
 *
 *  - **El proxy de IA, simulado.** El navegador sólo llega a un modelo por
 *    `/api/ai` (el build de E2E lo fija en modo estricto), y el stack de CI no
 *    tiene proveedor. Interceptar esa ruta sustituye *al proveedor*, nada más:
 *    el motor, el transporte, las guardas, la escritura en PostgreSQL y la
 *    bitácora de proyecciones siguen siendo los reales.
 *  - **Llamadas RPC con la sesión del usuario**, para dos usos: leer lo que la
 *    base guardó de verdad —no lo que la pestaña cree— y hacer de «otro
 *    dispositivo» que escribe mientras esta pestaña está cerrada.
 */

/** Marca que el documento simulado lleva, para reconocerlo en la base. */
export const FAKE_DOCUMENT_MARKER = 'Arquitectura objetivo E2E';

const FAKE_DOCUMENT = `# Visión de la Arquitectura

## Resumen ejecutivo
${FAKE_DOCUMENT_MARKER}: la plataforma de reclamos pasa de un núcleo monolítico a servicios
desacoplados detrás de APIs, con trazabilidad completa de cada decisión.

## Estado actual
- Núcleo de reclamos en AS/400 con procesos por lotes nocturnos.
- Integraciones punto a punto con el bróker y con el portal de asegurados.

## Estado futuro (To-Be)
- Servicios de dominio para siniestros, pólizas y pagos, publicados como APIs.
- Integración por eventos con el bróker y el portal.

## Principios guía
1. API-First y Contract-First.
2. Zero Trust y mínimo privilegio.
3. Observabilidad nativa en cada servicio.

## Riesgos
- Migración de datos históricos de siniestros.
- Dependencia del proveedor del núcleo durante la transición.

## Próximos pasos
1. Validar los principios con el comité de arquitectura.
2. Priorizar el primer dominio a extraer.
`;

/**
 * Sustituye al proveedor detrás de `/api/ai`. Devuelve el documento para una
 * petición de texto y un JSON vacío para una que pide JSON: los pasos que
 * esperan un JSON estructurado (crítica, sugerencias) ya degradan ante uno que
 * no traiga nada, que es el comportamiento que el producto promete sin modelo.
 */
export async function fakeAiProvider(page: Page): Promise<{ calls: () => number }> {
  let calls = 0;
  await page.route('**/api/ai', async (route: Route) => {
    calls += 1;
    let body: Record<string, unknown>;
    try {
      body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const wantsJson = body.responseMimeType === 'application/json';
    const text = wantsJson ? '{}' : FAKE_DOCUMENT;
    if (body.stream === true) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`,
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ requestId: `e2e-${calls}`, text, provider: 'gemini', model: 'e2e-fake-model' }),
    });
  });
  return { calls: () => calls };
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

/** El workflow de E2E exporta estas dos; fuera de él, los recorridos se saltan. */
export const hasBackendAccess = (): boolean => SUPABASE_URL.length > 0 && ANON_KEY.length > 0;

/** El token de acceso de la sesión que el SDK guardó en esta página. */
export async function accessTokenOf(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) ?? '';
      if (/^sb-.*-auth-token$/.test(key)) {
        const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string };
        if (stored.access_token) return stored.access_token;
      }
    }
    return null;
  });
  expect(token, 'La página no tiene sesión de Supabase guardada').toBeTruthy();
  return token!;
}

/** Llama a una RPC del esquema `api` como el usuario de ese token. */
export async function rpc<T = unknown>(
  request: APIRequestContext,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'api',
      'Accept-Profile': 'api',
    },
    data: args,
  });
  const text = await response.text();
  expect(response.ok(), `rpc ${name} → ${response.status()}: ${text.slice(0, 300)}`).toBe(true);
  return (text ? JSON.parse(text) : null) as T;
}

/** Los retardos del proveedor simulado con streaming (10.0). */
export interface StreamingTiming {
  /** Hasta el primer fragmento: lo que tarda un modelo en empezar a escribir. */
  readonly firstChunkMs: number;
  /** Entre fragmentos. */
  readonly chunkMs: number;
  /** En cuántos fragmentos se parte el documento. */
  readonly chunks: number;
  /** Lo que tarda una petición que pide JSON (crítica, sugerencias). */
  readonly jsonMs: number;
}

export const REALISTIC_TIMING: StreamingTiming = { firstChunkMs: 1_500, chunkMs: 400, chunks: 8, jsonMs: 300 };

/**
 * El proveedor simulado **con tiempo** (plan de clase mundial 10.0).
 *
 * `fakeAiProvider` contesta al instante y de una vez, que es lo correcto para
 * afirmar qué se guarda y lo incorrecto para medir una espera: con él el
 * recorrido entero dura lo que tarda la aplicación, y nunca lo que tarda un
 * modelo. Éste sustituye `fetch` en la página —`route.fulfill` de Playwright
 * entrega el cuerpo entero de una vez y no puede emitir por partes— y responde
 * como un modelo: el primer fragmento tarde, los demás poco a poco, por SSE si
 * la petición pidió `stream` y entero al final si no. Sólo sustituye al
 * proveedor: el motor, el transporte y las guardas siguen siendo los reales.
 */
export async function fakeStreamingAiProvider(page: Page, timing: StreamingTiming = REALISTIC_TIMING): Promise<{ calls: () => Promise<number> }> {
  await page.addInitScript(({ document, timing: t }) => {
    const original = window.fetch.bind(window);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const w = window as unknown as { __arkyAiCalls: number };
    w.__arkyAiCalls = 0;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!/\/api\/ai(\?|$)/.test(url)) return original(input, init);
      w.__arkyAiCalls += 1;
      let body: Record<string, unknown>;
      try { body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>; } catch { body = {}; }
      if (body.responseMimeType === 'application/json') {
        await sleep(t.jsonMs);
        return new Response(JSON.stringify({ requestId: 'e2e-json', text: '{}', provider: 'gemini', model: 'e2e-fake-model' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const size = Math.ceil(document.length / t.chunks);
      const pieces = Array.from({ length: t.chunks }, (_, i) => document.slice(i * size, (i + 1) * size)).filter(Boolean);
      if (body.stream === true) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            await sleep(t.firstChunkMs);
            for (const [i, piece] of pieces.entries()) {
              if (i > 0) await sleep(t.chunkMs);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: piece })}\n\n`));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      await sleep(t.firstChunkMs + t.chunkMs * (pieces.length - 1));
      return new Response(JSON.stringify({ requestId: 'e2e-text', text: document, provider: 'gemini', model: 'e2e-fake-model' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, { document: FAKE_DOCUMENT, timing });
  return { calls: () => page.evaluate(() => (window as unknown as { __arkyAiCalls?: number }).__arkyAiCalls ?? 0) };
}
