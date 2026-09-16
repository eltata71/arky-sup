# Fase 7 — Cierre: calidad integral, resiliencia y experiencia (PoC)

**Rama:** `feature/fase7-calidad`. **Base:** `7b31739` (cierre F6).
**Plan:** `docs/fase-7/plan-fase-7.md`. **Matriz F0–F7:**
`docs/fase-7/matriz-auditoria-f0-f7.md`.

## 1. Estado por tarea

| Tarea | Estado | Evidencia |
|---|---|---|
| F7.1 tests unitarios/contratos/integración/RLS/E2E | Hecha (ver límites) | suite por shards; `evidencias/contratos-sql.md`; E2E abajo |
| F7.2 seguridad API/funciones/políticas/deps/secretos/IA | Hecha (ver límites) | `evidencias/ruta-ia-429.md`; audit; advisors; bundle-secrets |
| F7.3 rendimiento | Hecha a escala PoC | bundle-budget eager; advisors performance (1 aviso preexistente) |
| F7.4 resiliencia (red/sesión/reintentos/proveedor) | Hecha en contrato + código; 429 distinguido | tests sesión (51→52), retry/fallback, `ruta-ia-429.md` |
| F7.5 UX/a11y/i18n | Revisión básica; WCAG 2.2 AA queda propuesta | esta acta (sin certificación) |
| F7.6 UAT con usuarios | **No ejecutada: requiere sesión humana** | pendiente de organización |

## 2. Resultados verificados

- **Suite:** 4319 passed / 0 failed / 59 skipped (shards 1126 + 989 +
  1017 + 1187). Una ejecución previa de los cuatro shards informó 1 fallo
  en shard 4, pero su wrapper descartó el detalle al conservar solo `tail -6`;
  no se usa como evidencia. La verificación posterior aislada y la pasada
  completa con logs persistentes terminaron en exit 0.
- **Contratos SQL:** nativa PG16.15 ×2 iteraciones + remoto fail-closed
  10/10 (266 aserciones). Detalle en `evidencias/contratos-sql.md`.
- **F2.6:** drill backup/verify/restore-local real en verde con 2 fixes del
  tool. Detalle en `evidencias/recuperacion-f26.md`.
- **IA/proxy:** ruta piloto Supabase verificada en ambos extremos (9/9);
  Firebase intacto; BYOK por proveedor; smoke prod 401 en `/api/ai` y
  `/api/gemini`. Detalle en `evidencias/ruta-ia-429.md`.
- **Estáticos:** typecheck directo con Node heap ampliado, strict typecheck,
  lint, any-budget (23), module-size, module-boundaries, no-orphan-scripts y
  diff-check: exit 0. El wrapper `npm run typecheck` sin heap aborta con 134
  por memoria en este host; no es un error TypeScript y se valida con
  `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit`.
- **Build final:** `build:placeholders`, `check:bundle-secrets` y
  `check:bundle-budget`: exit 0 sobre el mismo `dist/`.
- **Dependencias prod:** `npm audit --omit=dev`: 0 vulnerabilidades.
- **Advisors remoto:** security = RLS-sin-política (postura deny-by-default
  por diseño) + HIBP off (pendiente 6.2 de operación); performance = 1 aviso
  preexistente (`user_profiles` multi-permisiva). Sin hallazgos nuevos.
- **Storage:** inventario 6/6; buckets remotos privados, 0 objetos.
- **E2E Playwright (CI-parity, build + emuladores + seed, 24 tests):**
  desktop-chromium **8 passed / 0 failed** (incluye wizard con proyecto
  seedeado y aprobación ARB con entrega); 11 skipped por diseño
  (`browserName !== 'chromium'`); ipad-safari 5 fallos todos
  `browserType.launch: missing system deps` (sin sudo; el encadenado en
  userspace lo derrota el saneado de entorno del launcher) → bloqueado de
  entorno, cubierto por CI con `install-deps`. Sin fallos de app.
- **Reglas Firestore (`test:rules`, emulador):** 59/59 en verde.

## 3. Límites de la verificación (leídos antes de firmar)

1. F7.6/UAT humana no realizada (incluye inferencia piloto con texto y
   pruebas de carga/descarga): gate previo a F8, dueño organización.
2. Paridad PG17, stack Docker (`supabase.yml`), tipos generados: vía CI.
3. HIBP, mapa UID, backup remoto autorizado, presupuesto/SLO: operación.
4. WCAG 2.2 AA es propuesta; p95/carga formal no medidos (sin volumen PoC).
5. El gap nativo pineado de Storage se prueba en remoto (ver evidencia).

## 4. Cambios del árbol

Código: `api/_shared/verifySupabaseToken.ts` (nuevo),
`api/_shared/authenticateProxyCaller.ts` (ruta piloto),
`services/ai/byokConsent.ts` (slot Anthropic + tipos),
`services/ai/proxyAuthHeaders.ts` + tests (ya en rama),
`scripts/supabase/test-remote.py` (runner fail-closed),
`scripts/supabase/test_remote_runner.py` (nuevo),
`scripts/supabase/test-native.py` (equivalencia gestionada + gaps pineados),
`scripts/supabase/sql-contract-bootstrap.sql` (stub Storage fiel),
`scripts/operations/recovery.py` (TOC filtrada + LD_LIBRARY_PATH),
contratos `identity_authorization` (grant F6) y `storage_private_objects`
(TAP puro + grants service_role test-only),
`__tests__/services/proxyAuthentication.test.ts` (higiene env).
Docs: `docs/fase-7/` (plan, matriz, cierre, evidencias).

## 5. Pendientes (dueño)

- **Organización:** UAT F7.6, HIBP, mapa UID, CI/acuerdo, backup remoto,
  presupuesto/SLO, URLs externas (enlace vs administrado).
- **CI/entorno:** PG17/Docker, webkit si aplica.
- **Dev:** nada abierto.
