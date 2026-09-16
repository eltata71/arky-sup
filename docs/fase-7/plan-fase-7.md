# Fase 7 — Plan: calidad integral, resiliencia y experiencia (PoC)

**Rama:** `feature/fase7-calidad`. **Base:** cierre F6 (`7b31739`).
**Alcance:** app como PoC (sin datos productivos), proyecto **ArkyDB-US**
(`us-east-1`), hosting **Vercel**. F7 culmina F0–F6; F8/F9 quedan fuera.

## Encaje con el plan formal (`docs/plan-transformacion-supabase-ddd.md`)

| Tarea | Contenido PoC | Gate |
|---|---|---|
| F7.1 | Unit + contratos SQL (pgTAP local y remoto fail-closed) + integración PG/Auth/Storage + RLS + E2E (emuladores Firebase, desktop + iPad) + regresión visual de recorridos críticos | Suite verde por shards; 10/10 contratos remotos; E2E CI-parity |
| F7.2 | Seguridad API/proxy IA, funciones privilegiadas, vistas, políticas, dependencias (`npm audit`), secretos (bundle + árbol), auditoría, abuso IA (rate-limit local vs proveedor) | `npm audit` 0 high+; bundle-secrets; advisors sin hallazgos nuevos |
| F7.3 | Rendimiento representativo PoC: bundle eager ≤ 450 KB, consultas/índices (advisors performance), p95 manual donde aplique | bundle-budget; sin regresión eager |
| F7.4 | Resiliencia: cortes de red, expiración/revocación de sesión, reintentos, conflictos, fallos de proveedor sin corrupción ni falsa confirmación | Tests de sesión/retry en verde; 429 distinguido |
| F7.5 | Fricciones UX, accesibilidad básica, consistencia ES/EN; WCAG 2.2 AA como propuesta (no certificación) | Revisión documentada |
| F7.6 | UAT con arquitectos/revisores/admins, escenarios sanitizados; **requiere sesión humana: no se declara desde SQL ni scripts** | Acta de aceptación |

## Arrastre verificado (de `docs/fase-6/plan-fase-6.md`)

- **6.0 Diagnóstico 429** → F7.2/F7.4: capturar `POST /api/ai`
  (`requestId`, `error`, `source`, `provider`, `retryAfterMs`). Distinguir
  `proxy_rate_limited` (local 60/min) de `provider_rate_limited` (cuota).
- **6.1 Inferencia autenticada E2E** → F7.6: laboratorio LMS devuelve texto
  con sesión piloto, sin pedir clave. Gate previo a F8.
- **6.2 HIBP** (`auth_leaked_password_protection` off) → F7.2: plan
  compatible o aceptación de riesgo firmada (dueño: operación).
- **6.3 Mapa UID Firebase → UUID Supabase** → F5.4/F5.5 (negocio): mapa
  aprobado o exclusión formal. No se fuerza carga.
- **6.4 CI en verde** → F7.1: runners sin asignar (`runner_name` vacío);
  evidencia local sustituta + acuerdo.
- **6.5 pgTAP local** → F7.1: `scripts/supabase/test-native.py` (PG16
  desechable) + `test-remote.py` fail-closed contra remoto.
- **6.6.5 Verificación funcional Storage** → F7.1/F7.6: carga/descarga,
  previews, exportación, reconciliación cuando exista cliente de producto.

## Criterios de salida

1. Sin defectos bloqueantes; quality + shards + E2E + contratos en verde.
2. 429 distinguido con evidencia (cuerpo del 429, no solo banner).
3. Ruta piloto Supabase→proxy verificada en ambos lados con tests.
4. UAT humana firmada (F7.6) o salvedad explícita que la mueve a F8.
5. Riesgos residuales aceptados por responsables + `cierre-fase-7.md`.

## No objetivos

- Migración histórica Firebase (excluida del PoC, F6.4).
- Certificación WCAG, SLO/RPO/RTO productivos, alertas SaaS (F2.5 manual).
- Corte productivo (F8) ni retiro de legado (F9).
