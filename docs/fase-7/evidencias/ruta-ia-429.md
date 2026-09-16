# F7.2/F7.4 — Ruta piloto IA y diagnóstico 429

## Ruta piloto Supabase → proxy (cerrada en esta fase)

El cliente ya enviaba el token de sesión Supabase para correos piloto
(`proxyAuthHeaders.ts`); el servidor solo verificaba Firebase, así que todo
piloto caía a 401 → ruta directa. Ahora:

- `api/_shared/verifySupabaseToken.ts` (nuevo): verifica contra Auth con
  `GET /auth/v1/user` (la firma/expiración/audiencia las valida el servidor,
  nunca el cliente); solo usuarios no anónimos con `id` no vacío y correo
  perteneciente al allowlist servidor `SUPABASE_PILOT_EMAILS` (fallback de
  configuración compatible: `VITE_SUPABASE_PILOT_EMAILS`); uid `supabase:<id>`.
  La consulta a Auth tiene timeout de 5 segundos y falla cerrado.
- `api/_shared/authenticateProxyCaller.ts`: enruta por `iss` no verificado
  (pista, no prueba — cada verificador valida completo); sin Firebase ni
  Supabase configurados sigue `proxy_missing_project_id`; el resto va al
  verificador Firebase intacto.

Tests: `supabaseProxyAuthentication` 9/9 (identidad del servidor, allowlist
piloto, allowlist ausente fail-closed, 401 ante token desconocido, red caída
fail-closed, anónimo rechazado, no cross-call a getUser con iss Firebase,
`readTokenIssuer`); `proxyAuthentication`
Firebase intacto; `proxyAuthHeaders`, `aiProxyApi`, `geminiProxyApi`,
`aiProxyClient`, `aiProxyPolicy`, `aiProxyEnforcement` en verde (61 + 31).

## BYOK por proveedor

`byokConsent.ts`: el consentimiento se resuelve con `resolveProviderId` y el
slot propio (`user_anthropic_key` añadido); sin slot no hay consentimiento.
Tipos: mapa como `Partial<Record<AIProviderId, string>>` (cubre `openai`,
`azure`, `mock` como no-consentidos por construcción).

## Diagnóstico 429

- Producción (`https://arkypro-1-0.vercel.app`, 2026-09-16):
  `POST /api/ai` → `401 {error: unauthenticated, reason:
  missing_bearer_token, requestId: aiproxy-…}`; `POST /api/gemini` → idem.
  Runtime, routing y gate responden en ambos endpoints.
- El código ya distingue `proxy_rate_limited` (límite local 60/min por uid
  verificado) de `provider_rate_limited` (cuota, con `retryAfterMs`), con
  cobertura en `aiProxyApi`/`geminiProxyApi`/`guidedProjectCreationService`.
- **Inferencia autenticada con texto devuelto (criterio F5-a) sigue pendiente
  de sesión piloto humana (F7.6/UAT):** sin una llamada autenticada real que
  devuelva texto no se puede atribuir el 429 histórico a cuota de proveedor
  frente a límite local. No se reintentó a ciegas.
