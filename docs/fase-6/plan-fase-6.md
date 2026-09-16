# Fase 6 — Plan operativo (pista dev + arrastre F5)

**Fecha:** 2026-09-14
**Estado:** cerrada para el alcance del PoC (F6.1–F6.3 hechas; F6.4 no aplica;
F6.5 movida a F7).

## Nota de encaje con el plan definido

En `docs/plan-transformacion-supabase-ddd.md`, F6 es **Almacenamiento y
documentos** (F6.1–F6.5: buckets, políticas, migración de binarios). Los
pendientes que arrastra F5 **no** son F6 de ese plan: la inferencia E2E, el
diagnóstico del `429`, HIBP, CI y pgTAP pertenecen a **F7 (Calidad integral,
F7.1/F7.2/F7.4)**; el mapa UID pertenece a **F5 (F5.4/F5.5)**.

Esta Fase 6 se abre como **pista operativa de desarrollo**: backlog ordenado
para seguir programando sin bloquearse en terceros (cuota de proveedor,
infra CI, decisiones de negocio). Cuando el equipo retome el plan formal, los
ítems F7/F5 se mueven a su fase sin reescribirse — la traza está en la columna
"Encaje plan".

## Backlog (orden sugerido)

| # | Ítem | Encaje plan | Dueño | Estado actual | Gate de cierre |
|---|------|-------------|-------|---------------|----------------|
| 6.0 | **Diagnóstico 429 del proxy IA.** Capturar `POST /api/ai`: `requestId`, `error`, `source`, `provider`, `retryAfterMs` + hora. Distinguir `proxy_rate_limited` (local, 60/min) de `provider_rate_limited` (cuota). Según hallazgo: subir `AI_PROXY_MAX_REQUESTS_PER_WINDOW`, rotar/subir cuota, o retry con backoff en LMS. | F7.2/F7.4 | dev | **Pendiente; se ejecuta en F7** | Causa identificada + fix o workaround |
| 6.1 | **Inferencia autenticada E2E.** Laboratorio IA del LMS devuelve texto en producción con sesión piloto, sin pedir clave. Es el criterio (a) diferido de F5 y gate previo a F8. | F5-salida / F7.6 | usuario + dev | **Movido a F7.6**; requiere prueba de usuario | Texto generado OK en prod |
| 6.2 | **Decisión HIBP** (`auth_leaked_password_protection` off): plan compatible o aceptación de riesgo firmada. | F7.2 | operación | **Pendiente de operación; se ejecuta en F7** | Decisión registrada |
| 6.3 | **Mapa Firebase UID → UUID Supabase**: 7 proyectos sin propietario + 63 documentos sin mapa aprobado. Mapa aprobado o exclusión formal firmada. | F5.4/F5.5 | negocio | **Pendiente de negocio; no se fuerza carga** | Mapa o exclusión firmada |
| 6.4 | **CI en verde**: infra Actions falla sin runner (`runner_name` vacío, runs 34803722186/34850096650). Recuperar runners o acordar evidencia local sustituta. 10 PRs Dependabot abiertos pendientes de triaje. | F7.1 | dev/ops | **Pendiente de dev/ops; se ejecuta en F7** | CI verde o acuerdo firmado |
| 6.5 | **pgTAP local**: sin Docker/stack; contrato cubierto por tests + sonda remota. | F7.1 | dev | **Pendiente de entorno; se ejecuta en F7** | pgTAP corriendo o diferido formal |
| 6.6.1 | **Inventario Storage/documentos**: archivos, URLs, incrustaciones y proveedores observados en fuentes versionadas; consulta remota Supabase. | F6.1 | dev | **Cerrado** — 845 fuentes versionadas escaneadas; sin SDK Firebase Storage ni objetos históricos importados | Inventario PII-safe y estado remoto documentado |
| 6.6.2 | **Diseño Storage**: buckets privados, rutas, metadata, límites, cuarentena, retención y borrado. | F6.2 | dev | **Cerrado**; buckets privados creados sin objetos históricos | Diseño revisable |
| 6.6.3 | **Implementación Storage**: políticas, metadata, estados y permisos. | F6.3 | dev | **Cerrado para PoC**; SQL aplicado, pgTAP 29/29 y sonda remota 20/20; owner-only y sesión activa verificados; ACL interna administrada documentada | Políticas y sonda negativa |
| 6.6.4 | **Migración de binarios**: checksums, manifest, referencias y versiones. | F6.4 | dev + negocio | **No aplicable al PoC**; no se importan documentos de Firebase | Exclusión de migración documentada |
| 6.6.5 | **Verificación funcional**: carga, descarga, previews, exportación y reconciliación. | F6.5 / F7.1 / F7.6 | usuario + dev | **Movida a F7** cuando exista implementación | Sin referencias rotas ni exposición no autorizada |

## Próximo paso técnico

1. Mantener los buckets vacíos: no se inicia ETL ni se consulta Firebase como
   dependencia del PoC.
2. Integrar el cliente de carga/descarga contra los RPC y políticas ya creados
   solo cuando exista un flujo de producto que lo necesite.
3. Ejecutar en F7 las pruebas de usuario de carga, descarga, preview,
   exportación y reconciliación; no se declaran realizadas desde SQL.
4. Mantener en F7 los diferidos de calidad, diagnóstico 429, HIBP, CI, pgTAP
   local e inferencia E2E.

## Evidencia de esta iteración

- `docs/fase-6/evidencias/inventario-storage.md`
- `docs/fase-6/evidencias/inventario-storage.json`
- `docs/fase-6/diseno-storage-fase-6.md`
- `supabase/migrations/20260915012714_storage_private_objects.sql`
- `supabase/migrations/20260915013614_storage_policy_error_guards.sql`
- `supabase/migrations/20260915023944_storage_authorization_hardening.sql`
- `supabase/migrations/20260915024652_storage_privilege_hardening.sql`
- `supabase/migrations/20260915024929_storage_anon_guard.sql`
- `supabase/migrations/20260915150556_storage_integrity_and_probe_hardening.sql`
- `supabase/migrations/20260915151825_storage_backend_schema_grant.sql`
- `supabase/migrations/20260915155724_storage_readiness_and_acl_hardening.sql`
- `supabase/migrations/20260915163356_storage_bucket_mime_and_mutation_hardening.sql`
- `supabase/migrations/20260915180409_storage_ready_claim_fail_closed.sql`
- `supabase/migrations/20260915191743_storage_owner_session_visibility.sql`
- `supabase/migrations/20260915192003_storage_session_guard_grant.sql`
- `supabase/tests/database/storage_private_objects.test.sql`
- `scripts/supabase/storage-private-objects-remote-probe.sql`

- Proxy: `api/ai.ts` + `api/_shared/authenticateProxyCaller.ts` (gate),
  `api/_shared/verifyIdToken.ts` (solo Firebase ID token, RS256/JWKS).
- Cliente: `services/ai/aiProxyClient.ts`, `services/ai/aiProxyPolicy.ts`
  (`describeProxyFailure`, `decideFallback` fail-closed en PROD),
  `services/ai/aiProxyEnforcement.ts` (`ai.proxy.enforcement`),
  `services/ai/proxyAuthHeaders.ts` (usa `auth.currentUser.getIdToken()` de Firebase).
- LMS: `services/ai/generation/learningService.ts` → `./learning/`;
  generación vía `aiGateway` → `geminiService.generateContentWithFallback` →
  `tryAiProxy`.
- Límite local: `api/_shared/proxyRuntime.ts` (`WINDOW_MS` 60s, default 60 req,
  env `AI_PROXY_MAX_REQUESTS_PER_WINDOW`, clave por uid verificado).
- Producción: `https://arkypro-1-0.vercel.app`, proyecto Vercel `arkypro-1-0`,
  Node 20.x, `GEMINI_API_KEY` solo server-side.
- Remoto: ArkyDB-US (`us-east-1`), migraciones 30/30 en sync.
