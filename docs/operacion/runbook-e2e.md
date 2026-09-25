# Runbook — Las pruebas E2E: cómo corren, cómo leer un fallo, cuándo añadir una cuenta

## Cómo corren

`.github/workflows/e2e.yml`, sólo en PR:

1. Levanta un Supabase local y reconstruye el esquema desde las migraciones
   (`scripts/supabase/local.sh start` y `reset`).
2. Construye `dist/` con valores `VITE_*` de E2E.
3. Siembra las cuentas (`npm run e2e:seed`, es decir, `scripts/seedE2E.mjs`).
   El script se niega a ejecutarse contra una URL que no sea local.
4. Lanza Playwright contra `vite preview` de `dist/`, en Chromium de escritorio
   e iPad Safari. `fullyParallel` está activado, y en CI cada prueba que falla
   se reintenta una vez.

Tres decisiones que conviene conocer antes de escribir un recorrido:

- **Los recorridos autenticados y `chunks.spec.ts` corren sólo en Chromium
  de escritorio.** La sesión de Auth en WebKit contra el stack local no es
  fiable, y el smoke sin sesión cubre iPad. De ahí que haya 36 casos y 19 se
  ejecuten.
- **No hay proveedor de IA.** Un recorrido que necesita un modelo lo
  sustituye detrás de `/api/ai` (`fakeAiProvider` en `e2e/support/backend.ts`).
  Sólo se sustituye al proveedor: el motor, el transporte y las guardas son
  los reales.
- **Lo que se afirma se lee de la base, no de la pantalla**, con `rpc()` de
  `e2e/support/backend.ts`. Usa la sesión del usuario y la clave publicable,
  nunca `service_role`. Una escritura que sólo se ve en el estado de React de
  la pestaña que la hizo no es una escritura.

## Las cuentas sembradas, y por qué hay cuatro

| Cuenta | Rol | Para qué |
|---|---|---|
| `architect@arky.e2e` | superadmin | la cuenta por defecto; es dueña de los datos semilla |
| `reviewer@arky.e2e` | reviewer | firma en el comité: el autor no puede firmar lo suyo |
| `preferences@arky.e2e` | viewer | cambia el idioma de la interfaz |
| `projections@arky.e2e` | architect | afirma que un pendiente existe antes de que se procese |

**Regla para añadir una cuenta:** un recorrido necesita cuenta propia cuando
cambia algo que **otra pestaña de la misma cuenta vería o consumiría**
mientras las pruebas corren en paralelo. Los dos casos de hoy son el idioma y
un pendiente de proyección que el arranque de otra prueba procesaría. La
cuenta se añade en `scripts/seedE2E.mjs` (`ACCOUNTS`) **y** en
`e2e/support/auth.ts`, en el mismo cambio.

## Leer un fallo

`toHaveURL` y un `click` que agota el tiempo dicen poco. Hay que descargar los
artefactos de la ejecución:

```bash
gh run download <run-id>
```

Hay una carpeta por intento; la del reintento termina en `-retry1`.

- `error-context.md`: el árbol de accesibilidad de la página en el momento
  del fallo. Casi siempre basta para ver qué había en pantalla: un error, una
  carga, un diálogo.
- `trace.zip`: se descomprime. Los ficheros `*.trace` traen la consola de la
  página (los registros de observabilidad y los errores de React), y los
  `*.network`, las peticiones con su estado. Un `-1` es una petición abortada.

**Un fallo E2E en una pantalla que la PR no toca no es inestabilidad hasta que
se demuestre.** Los dos casos de F6-04 que parecían de la prueba eran defectos
de producción:

- el código de iniciativa se calculaba en el cliente, y un segundo usuario no
  podía crear ninguna;
- el Workspace no cargaba, por un ciclo de imports que sólo el bundle de
  producción expone.

Si el fallo muestra «Error en la aplicación», se sigue
`runbook-ruta-no-carga.md`.

## Local

Sin Docker no hay Supabase local, así que los recorridos autenticados sólo
corren en CI. `e2e/chunks.spec.ts` sí corre en local contra un `vite preview`
del build: ver `runbook-ruta-no-carga.md` § 2.
