# Runbook — Una pantalla muestra «Error en la aplicación» o no carga

**Síntoma:** al abrir una ruta aparece el recuadro «Error en la aplicación»
(el ErrorBoundary) o el overlay «Fallo observable», o la pantalla se queda en
«Cargando». Suele afectar a una ruta y no a las demás.

**El caso real que dejó este runbook:** F6-04, 2026-09-25. Durante horas nadie
pudo abrir un proyecto en producción, y todos los gates estaban en verde.

## 1. ¿Descarga o evaluación?

Las dos se ven igual en pantalla y tienen causas opuestas.

| | Descarga | Evaluación |
|---|---|---|
| Qué pasa | el chunk no llega (red, despliegue que rotó los hashes) | el chunk llega con 200 y **lanza al ejecutarse** |
| ¿Se arregla solo? | a menudo: `lazyWithRetry` reintenta y recarga una vez | **nunca**: falla igual en cada intento y tras recargar |
| Mensaje típico | `Failed to fetch dynamically imported module` | `Cannot access 'X' before initialization`, `X is not a function` |

**Para distinguirlas:** en el centro de observabilidad (botón inferior
derecho), o en la consola del navegador, se busca la entrada «Precarga de
módulo interrumpida». Desde F6-04 registra el `payload` de Vite, es decir, el
error real. Si el mismo error se repite tras «Sincronizando con la última
versión», es un fallo de evaluación.

## 2. Reproducir un fallo de evaluación en local

Un fallo de evaluación depende del orden de los módulos **en el bundle de
producción**. Vitest no lo reproduce, porque evalúa cada fichero por su lado,
y `npm run dev` tampoco.

```bash
export VITE_AI_PROXY_URL=/api/ai VITE_AI_STRICT_PROXY=true \
       VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=placeholder
npm run build
npx vite preview --port 4310 --host 127.0.0.1 &
PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4310 \
  npx playwright test e2e/chunks.spec.ts --project=desktop-chromium
```

`e2e/chunks.spec.ts` importa cada chunk del build y lista los que lanzan, con
su mensaje. Es la misma prueba que corre en cada PR.

## 3. Encontrar la causa

1. Se abre el chunk que falla en `dist/assets/` y se va a la columna que da el
   error. Casi siempre es un `const X = new Algo()` al nivel de módulo que usa
   algo definido **más abajo** en el mismo chunk.
2. Con `npx vite build --sourcemap --outDir /tmp/dist-map`, el `.map` de ese
   chunk dice de qué ficheros fuente vienen las dos piezas.
3. La causa habitual es **un ciclo de imports dentro de un módulo**: un
   fichero importa el barril (`./index`) que lo reexporta a él. Desde F6-04,
   `__tests__/architecture/noBarrelSelfImport.test.ts` impide esa forma.

## 4. Arreglar y verificar

- Se rompe el ciclo: el fichero importa el fichero que define lo que
  necesita, nunca el barril.
- Se reconstruye y se vuelve a pasar `chunks.spec.ts`: deben evaluarse todos.
- Después de desplegar, se comprueba producción **abriendo la ruta como una
  persona**. No se lanza un bucle de peticiones contra `arky-sup.vercel.app`:
  la protección de Vercel («Security Checkpoint») bloquea la máquina que lo
  hace, incluidos los navegadores sin cabeza, y la comprobación deja de ser
  posible.

## 5. Si es de descarga y no se recupera sola

Casi siempre es un despliegue que rotó los hashes mientras alguien tenía la
aplicación abierta. `lazyWithRetry` recarga una vez por sesión
(`arky.runtime.stale-bundle-reloaded.v1` en `sessionStorage`). Si alguien
queda bloqueado, cerrar la pestaña y abrir una nueva lo resuelve. Si le pasa
a todo el mundo, el despliegue está incompleto: se revierte con
`docs/ci-cd-pipeline.md` § 6.
