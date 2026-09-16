# Fase 5 — Cierre: parámetros globales de referencia + operativa IA

**Fecha:** 2026-09-14
**Rama de trabajo:** `feat/f5-reference-parameters` → fusionada a `main` (PR #16, squash `276281d`)
**Proyecto remoto:** ArkyDB-US (`us-east-1`)
**Estado:** F5-datos **cerrada**. F5-operativa **cerrada con salvedad**
(ver "Cierre con salvedad" al final): smoke sin auth verificado; inferencia
autenticada E2E diferida a Fase 6 tras evidencia de `429` en prueba de usuario.

## Por qué costó cerrar (causas reales, no del código de negocio)

1. **CI de GitHub con fallo de infraestructura.** Todos los jobs fallan en 2–4 s
   sin runner asignado, sin pasos ni logs (`runner_name` vacío). Afecta a PR #15,
   PR #16 y a `main`. Reintentos múltiples sin cambio. Precedente: PR #15 se
   fusionó con idéntica evidencia local en verde.
2. **`vercel.json` enrutaba `/api/*` al SPA.** El rewrite `/(.*) → /` capturaba
   `/api/ai` y `/api/gemini`. Fix: `/((?!api/).*)`, con test de regresión
   `__tests__/config/vercelApiRoutes.test.ts`.
3. **Cola de builds Vercel atascada.** Cuatro deploys CLI seguidos quedaron
   `UNKNOWN` sin arrancar el build. Se resolvió eliminando los deploys atascados
   y redesplegando con `--force`: build Ready en 2 min.
4. **Criterio de cierre demasiado conjunto.** Se separó F5-datos (migraciones,
   ETL, RPC) de F5-operativa (deploy + smoke), y se difirió a F6 lo que depende
   de terceros (plan HIBP, mapa UID completo, runners CI).

## F5-datos: cerrada

- Alcance estricto: solo `settings/global`. Sin proyectos, artefactos, cursos
  ni preferencias por usuario.
- Migraciones aplicadas (19/19, `dry-run up-to-date`):
  - `20260913223956_platform_reference_parameters` — singleton + RPC admin
    (`users:read`), concurrencia optimista, guard de secretos recursivo.
  - `20260913230744_platform_reference_secret_guard_else` — el guard admite
    escalares JSON (boolean/number/null).
  - `20260913232706_platform_reference_pii_and_initial_revision_guard` —
    guard de PII recursivo + primera escritura exige revisión esperada 0.
- ETL `scripts/migration/platform_settings_etl.py`: filtra solo
  `settings/global`, elimina secretos (nombres normalizados + formas incrustadas
  en texto), rechaza PII, manifest con fuente constante
  `authorized-global-settings-export`. 6/6 tests OK.
- Sonda remota transaccional (`BEGIN`/`ROLLBACK`): **8/8 OK** — admin RW,
  viewer denied, secret field/shape denied, PII denied, direct-table denied,
  revoked-session denied, initial-revision guard.
- Catálogo: RLS activa, sin acceso directo `authenticated`, RPC solo por
  `EXECUTE`, helper `private` sin grants.

## F5-operativa: verificada

- Deploy producción Ready `9am1651fi` con alias canónico
  `https://arkypro-1-0.vercel.app`, functions `λ api/ai` + `λ api/gemini`.
- Smoke sin auth (prueba que runtime, routing y gate responden):
  - `POST /api/ai` → `401 {"error":"unauthenticated","reason":"missing_bearer_token"}` con `requestId`.
  - `POST /api/gemini` → idem.
  - Antes del fix: `FUNCTION_INVOCATION_FAILED` (ESM) / HTML del SPA (rewrite).
- Clave Gemini anterior tratada como comprometida; `GEMINI_API_KEY` solo
  server-side, sin `VITE_GEMINI_API_KEY` en producción.

## Diferido explícito (no bloquea F5)

- **HIBP** (`auth_leaked_password_protection` off): requiere plan compatible o
  aceptación de riesgo. Dueño: operación/Fase 6.
- **Mapa Firebase UID → UUID Supabase:** 7 proyectos sin propietario mapeado +
  63 documentos sin mapa aprobado. Excluidos del corte. Dueño: negocio/Fase 6.
- **CI en verde total:** bloqueado por infra Actions. Evidencia sustituta: gates
  locales en verde + revisiones independientes.
- **pgTAP local:** sin Docker/stack. Contrato cubierto por tests + sonda remota.
- **Inferencia autenticada E2E:** requiere sesión de usuario piloto contra
  producción. Paso de verificación del usuario (sección siguiente).

## Verificación pendiente del usuario (5 min)

1. Abrir `https://arkypro-1-0.vercel.app`, iniciar sesión piloto.
2. Usar el laboratorio IA del LMS (texto): debe responder sin pedir clave.
3. Si responde → F5 100 % cerrada y se habilita Fase 6.

## Criterios de salida a Fase 6

Criterios originales del acta: (a) inferencia autenticada OK por el usuario,
(b) decisión HIBP (plan o riesgo aceptado), (c) mapa UID aprobado o exclusión
formal firmada, (d) CI de infra recuperado o evidencia local equivalente
acordada.

## Cierre con salvedad (2026-09-14, sesión con usuario)

**Decisión del usuario:** cerrar F5 con salvedad y desplazar la verificación
pendiente a Fase 6 para no bloquear desarrollo.

**Evidencia que motiva la salvedad:** prueba de usuario en producción
(`https://arkypro-1-0.vercel.app`, sesión piloto OK, datos OK) — el
Laboratorio IA del LMS falla con "El proxy de IA está limitando las
solicitudes". Logs del cliente: `ai.proxy.enforcement` / `rate-limited` en
`/training`, 2 intentos (22:14 y 22:15 UTC). El proxy contestó `429` y, como
producción es `fail-closed`, se bloqueó la llamada directa. No se capturó el
cuerpo de `POST /api/ai` (`requestId`, `error`, `source`, `provider`), así que
está sin distinguir: `429` local del proxy (`proxy_rate_limited`, 60/min por
defecto) frente a `429` del proveedor (`provider_rate_limited`, cuota
Gemini/OpenRouter). Dos intentos separados 25 s no deberían pegar el límite
local: apunta a cuota del proveedor, sin afirmar.

**Salvedad registrada:** F5 se cierra sin el criterio (a). Los cuatro criterios
(a)–(d) pasan a backlog de Fase 6 / F7 según encaje (ver
`docs/fase-6/plan-fase-6.md`). La inferencia autenticada con texto devuelto
sigue siendo el gate antes de cualquier corte productivo (F8).
