# F6-01, segundo corte — el proxy heredado, y el defecto que escondía

**Fecha:** 2026-09-25 · **Base:** F6-01 corte 1 (#77).

## Lo que había

Dos proxies serverless con las mismas claves de proveedor:

- `api/ai.ts`, el agnóstico, que usa toda la aplicación a través de `aiGateway`;
- `api/gemini.ts`, el heredado, solo para Gemini, apuntado por
  `VITE_GEMINI_PROXY_URL`.

El heredado tenía **un solo consumidor**: la creación guiada de proyectos
(`guidedProjectCreationService`), que mantenía para él su propio `fetch`, su
propio mapeo de errores y su propio fallback.

## El defecto vivo

En el bundle publicado, la función que lee la variable quedó compilada así:

```js
function HZn(){const f="".trim();return f.length>0?f:null}
```

**`VITE_GEMINI_PROXY_URL` está vacía en producción.** Por tanto, la creación
guiada:

1. no encontraba el proxy heredado;
2. ejecutaba `assertDirectCallAllowedFor(settings, 'not-configured')`;
3. como en producción la política es estricta (`import.meta.env.PROD`), **se
   negaba a llamar al modelo a cualquiera sin clave personal**, con el mensaje
   *«La IA no está disponible en este despliegue: falta terminar de configurar
   el proxy de IA…»*.

Todo eso ocurría antes de llegar a `aiGateway`, que habría ido por `/api/ai`,
configurado y funcionando.

## El arreglo es la retirada

- `guidedProjectCreationService` tiene ahora **una** ruta: `aiGateway`, que
  intenta `/api/ai` primero y aplica la política estricta él mismo. Salen
  `callProxy`, el mapeo de errores propio y el fallback paralelo (unas 200
  líneas).
- Se borran `api/gemini.ts` y su prueba, `getGeminiProxyUrl` e
  `isGeminiProxyConfigured`, `VITE_GEMINI_PROXY_URL` (`env.d.ts`,
  `.env.example`) y `GEMINI_PROXY_MAX_REQUESTS_PER_WINDOW`.
- El smoke del despliegue deja de comprobar `/api/gemini`.

## La prueba reproduce el defecto

`guidedProjectCreationService.test.ts` añade el caso *«bajo la política
estricta y sin clave personal responde por el proxy en vez de negarse»*. Con el
código anterior falla con el mensaje exacto que veía el usuario en producción;
con el nuevo pasa. Las cuatro pruebas que ejercitaban el proxy heredado se
sustituyen por esa y por *«va primero por el proxy agnóstico, nunca por el
cliente directo»*.

## De paso: la «inestabilidad» de `OfficeContext.test.tsx`

Desde F5-02 esta prueba fallaba de vez en cuando en tandas grandes y se había
tratado como inestabilidad por carga. En este corte falló dentro de la suite
completa, así que se midió en vez de suponerlo. Con cobertura, su primera
prueba de creación tardaba **10,4 s sola**, y las siguientes entre 25 y 180 ms.
Era el coste de transformar los módulos que `OfficeContext` carga con
`import()`. Bajo carga pasaba de 20 s, agotaba el límite, y las catorce
siguientes caían en cascada con la lista vacía.

Ahora un `beforeAll` calienta esos imports con su propio límite, y la prueba
tarda **36 ms**. No era un defecto del producto, pero sí de la prueba: hacía
pagar a una aserción un coste que no era suyo.

## Operación

Tras desplegar, `/api/gemini` deja de existir: el rewrite de la SPA excluye
`/api/`, así que responde 404. Nada lo llama, porque la variable estaba vacía.
Si en Vercel quedan `VITE_GEMINI_PROXY_URL` o
`GEMINI_PROXY_MAX_REQUESTS_PER_WINDOW`, ya no las lee nadie y se pueden borrar
del panel.
