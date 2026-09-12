# F3 — Cierre: fundaciones modulares y deuda bloqueante

Rama: `feature/fase3-fundaciones-modulares`. Sin cambios de proveedor activo
(Firebase sigue sirviendo a la app), sin dependencias nuevas, sin secretos.

## F3.1 Puertos (contratos del dominio)

- `services/ports/`: `IdentityPort`, `ClockPort`, `FileStoragePort`,
  `RepositoryPort` (upsert idempotente, apta para reintentos y ETL de F5),
  `BackendUnavailableError`, `SystemClock` + fakes en memoria
  (`ManualClock`, `MemoryFileStorage`, `MemoryRepository`).
- Cero imports de React/Firebase/Supabase/SDK. Registrado en `modules.json`
  (capa `domain`, con `api`) y enrolado en `tsconfig.strict.json` desde el
  nacimiento.
- Pruebas: `__tests__/services/ports/portsContract.test.ts` — dominio
  testeable sin DOM ni emulador.

## F3.2 Adaptadores (los SDK viven aquí y en los repositorios listados)

- `services/adapters/backendSelection.ts`: `resolveBackend(env, contexto)` —
  función pura. Por defecto `firebase`; override `VITE_BACKEND_<CONTEXTO>`
  por corte vertical; valor desconocido cae al seguro y se marca no honrado.
- `firebaseIdentityAdapter.ts`: `IdentityPort` sobre `services/identity`
  (entra por su barril, como exige el gate). Nada más toca sesión.
- `supabaseDataBackend.ts`: puerta cerrada — `isSupabaseDataBackendConfigured`
  (URL + publishable, nunca service role) y `requireSupabaseDataBackend` que
  lanza hasta F4/F5. Ninguna escritura puede llegar a Supabase por accidente.
- Pruebas: `__tests__/services/adapters/backendSelection.test.ts`.
- `modules.json` + `strict` igual que puertos. Sin cambios en
  `eslint.config.js`: ningún fichero nuevo importa un SDK directamente.

## F3.3 Reglas fuera de la UI, presupuestos que solo bajan

- `PublicationCenter` entraba por ruta profunda a
  `artifactPresentationCompiler` y `artifactPresentationFlags`; ahora entra
  por el barril `services/artifacts` (se publican solo compilación, caché y
  flags; los compiladores parciales siguen internos). La ruta de publicación
  es perezosa, así que el barril es el acceso correcto.
- `components -> services/artifacts`: 16 → **14**, presupuesto bajado para
  fijar la ganancia. Resto de presupuestos intactos; ciclos y capas sin
  violaciones nuevas (gate en verde).
- Agregados ya protegidos por `noAggregateLiterals.test.ts` (sin cambios).

## F3.4 Deuda vigente (alcance acotado, sin re-refactors)

- No se toca `geminiService` (16 `any`, Ola 5), `ExcalidrawViewer` (6, borde
  sin tipos) ni `lazyWithRetry` (1, tipado propio de `React.lazy`):
  el presupuesto `any` queda en 23 con causa nombrada por grupo, como documenta
  `countAnyTokens.mjs`. Bajarlo por cosmética rompería el criterio del gate.
- Caracterización nueva: 11 pruebas de puertos/adaptadores + 27 existentes de
  artefactos re-verificadas. Persistencia duplicada y tipos compartidos quedan
  para los cortes F5, donde cada vertical los elimina al migrar.

## F3.5 Strict progresivo

- `typecheck` (repo) y `typecheck:strict` en verde con los dos módulos nuevos
  enrolados. `any` sin cambios justificados arriba.

## F3.6 Kernel IA y credenciales

- Sin cambios en rutas de IA: `api/ai.ts` mantiene las claves organizacionales
  en servidor (rechaza `VITE_*`), el cliente falla cerrado salvo BYOK, y las
  pruebas `aiProxyPolicy`/`aiProxyEnforcement` siguen verdes. Ningún fichero
  nuevo introduce claves ni llamadas directas a proveedor.

## Verificación

- `check:module-boundaries`, `check:module-size`, `check:any-budget`,
  `check:no-orphan-scripts`: verde.
- `typecheck`, `typecheck:strict`, `lint`: verde.
- Nuevas: 11/11. Artefactos relacionadas: 27/27.
- Build (placeholders) + `check:bundle-budget` + `check:bundle-secrets`: exit 0;
  eager **432.8 KB** sin cambios — el barril de publicación no añade bytes al
  arranque. Logs en `docs/fase-3/evidencias/` (excluidos de Git por `*.log`).
- Suite completa `npx vitest run`: **434 ficheros, 4233 pruebas en verde**
  (59 saltadas, igual que en F0; +2 ficheros / +11 pruebas aportadas por F3).

## Pendientes (no bloquean F4 con contratos)

1. Adaptador Supabase Auth + repositorios por corte (F4/F5) contra estos puertos.
2. `FileStoragePort` real por contexto en F6 (hoy solo fake en memoria).
3. `geminiService` (Ola 5) y tipos compartidos por vertical (F5).
