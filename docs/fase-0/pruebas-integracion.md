# F0.3 — Pruebas de integración: reglas Firestore y E2E (evidencia local)

Base: `8731fcdd9af7a5ee57eaaf3049b162ef722e55d7`.
Solo entorno local desechable (`demo-arky-e2e`, `demo-arky`); ningún dato
productivo, ninguna credencial real.

## 1. Reglas Firestore — 59/59 en emulador

- Comando (idéntico al gate del proyecto):
  `npm run test:rules` → `emulators:exec --only firestore --project demo-arky`
  + `vitest run __tests__/rules`.
- Resultado: `Test Files 1 passed (1)`, `Tests 59 passed (59)`, exit 0.
- Java: Temurin 21.0.12.1 local (`~/.local/share/f03-java`), sin sudo.
- Evidencias: `f03-rules.log`, `f03-rules-firestore.log`, `f03-rules.json`.

## 2. E2E Playwright con emuladores + seed — Chromium 8/8, 0 fallos de app

Procedimiento CI reproducido localmente:

1. `npm run build` con las variables E2E de `.github/workflows/e2e.yml`
   (incluye `VITE_FIREBASE_USE_EMULATORS=true`): build OK en 2m28s
   (`f03-e2e-build.log`).
2. `firebase-tools emulators:exec --config firebase.e2e.json --only
   auth,firestore --project demo-arky-e2e "npm run e2e:seed && npm run e2e"`:
   seed `[e2e:seed] isolated authenticated fixture ready`.

Resultado (`f03-e2e-full.log`, 24 tests, 2 workers, 32.2s):

| Proyecto | Pasados | Fallados | Omitidos |
| --- | --- | --- | --- |
| desktop-chromium | 8 | 0 | 4 (specs de diagrama, skip declarado) |
| ipad-safari | 0 | 5 (lanzamiento del navegador, causa entorno §3) | 7 |

Los 8 de Chromium incluyen rutas protegidas de la Oficina, panel autenticado
con proyecto seedeado, aprobación ARB y smoke sin excepciones JS. Con seed,
los 3 fallos de autenticación de la primera pasada sin emuladores
(`f03-e2e-chromium.log`) quedan resueltos: eran falta de fixture, no defecto.

## 3. ipad-safari bloqueado por el sandbox, no por la app

Los 5 fallos son `browserType.launch: Host system is missing dependencies`.
Sin sudo, se extrajeron 30+ paquetes `.deb` de noble a
`~/.local/share/f03-webkit/` y se expusieron vía `LD_LIBRARY_PATH`
(`f03-e2e-webkit*.log`, `f03-webkit-debs.log`):

- Ronda 1: 22 faltantes → 6.
- Ronda 2 (`libcairo-script-interpreter2`, GL/abseil): 6 → 1 (`libgles2`).
- Ronda 3: `libGLESv2.so.2` resuelve por `ldd`, pero Playwright sigue
  pidiendo el paquete; y el WebKit 2287 exige además `libjxl.so.0.8`
  (noble distribuye 0.7), `libsoup-3.0.so.0` y `libbacktrace.so.0` con
  dependencias transitivas de una distro más nueva.

Se detiene aquí por criterio coste/beneficio: encadenar librerías de otra
release sobre un sandbox sin sudo es frágil y no aporta señal sobre la app.
El proyecto iPad es variante de viewport/user-agent de los mismos journeys
que pasan en Chromium; CI (`ubuntu-latest` + `install-deps`) sí dispone de
las dependencias. Queda como pendiente de entorno, no como defecto.

## 4. Límites

- No se ejecutó la matriz completa de CI (shards, coverage merge, CodeQL).
- E2E valida el artefacto con placeholders + emuladores, no producción.
- Cobertura de journeys: smoke, acceso Oficina, engagement y personas; los
  specs de diagrama están en skip declarado por el proyecto.
