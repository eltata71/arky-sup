# Matriz de auditoría F0–F7 (estado verificado 2026-09-16, rama `feature/fase7-calidad`)

Fuente: cierres de cada fase + reverificación F7 donde se indica. Nada se
declara por memoria: cada fila cita su evidencia.

## F0 — Línea base (`docs/fase-0/cierre-fase-0.md`)

| Tarea | Estado | Evidencia |
|---|---|---|
| F0.1 inventario funcional | Hecha, aceptación aprobada 2026-09-12 | `docs/fase-0/inventario-funcional-datos.md` |
| F0.2 entorno reproducible | Hecha (`npm ci` ± scripts) | `docs/fase-0/evidencias/entorno.json` |
| F0.3 quality + reglas + E2E + build | Hecha; webkit solo CI | `quality.log`, `f03-rules*.log`, `pruebas-integracion.md` |
| F0.4 arquitectura/seguridad | Hecha (diagnóstico local) | `auditoria-arquitectura.md`, `auditoria-seguridad.md` |
| F0.5 inventario datos | Hecha, aprobado 2026-09-12 | inventario funcional/datos |
| F0.6 backlog deuda D-01…D-20 | Hecho | `backlog-deuda.md` |

Reverificado en F7: suite completa (shards), build, bundle — ver cierre F7.
Pendientes F0 que siguen: P-03 CI/hosting, P-04 webkit local, P-05
decisiones F1 (resueltas en diseño §7 el 2026-09-12 salvo presupuesto/SLO).

## F1 — Diseño (`docs/fase-1/cierre-fase-1.md`)

F1.1–F1.6 hechas (lenguaje, 7 contextos, agregados, autorización,
PostgreSQL, ADR-001…008 con Vercel aprobado). F1.7 parcial: nota F1 en
`AGENTS.md` hecha; `CLAUDE.md` pendiente por protección del archivo
(requiere aprobación explícita del usuario, no reintentada).
Decisiones §7 cerradas 2026-09-12: single-tenant, auth simple sin MFA/SSO,
residencia EE. UU., PII sin salud, PoC sin ambientes múltiples.

## F2 — Plataforma (`docs/fase-2/cierre-fase-2.md`)

| Tarea | Estado | Evidencia |
|---|---|---|
| F2.1 proyecto ArkyDB-US us-east-1, Free, PG17 | Hecho | catálogo; `~/.arky/secrets` fuera del repo |
| F2.2–F2.4 fundación, grants/RLS, CI, tipos | Hecho | migración `20260912001855`, `database.types.ts` sin drift, `supabase.yml` |
| F2.5 operación manual | Base manual (no SaaS) | `operacion-recuperacion.md` |
| F2.6 backup/restore | **Ensayado en F7** (era pendiente) | `docs/fase-7/evidencias/recuperacion-f26.md` |

## F3 — Fundaciones (`docs/fase-3/cierre-fase-3.md`)

Puertos (`services/ports`), adaptadores con puerta cerrada Supabase,
presupuestos a la baja, strict progresivo, kernel IA intacto. Suite F3:
434 ficheros / 4233 tests entonces; F7 la supera (ver cierre).

## F4 — Identidad (`docs/fase-4/cierre-fase-4.md`)

| Tarea | Estado | Evidencia |
|---|---|---|
| F4.1 adaptador Supabase Auth | Hecho (21 pruebas); service-role en Edge, pendiente | `supabaseIdentityAdapter.ts` |
| F4.2 roles/RLS/RPC | Hecho, verificado remoto | migraciones `20260912044359`, `20260912052000` |
| F4.3 paridad 63 celdas + negativos | Hecho; **contrato actualizado en F7** (grant F6) | `sqlMatrixParity` 5/5, pgTAP 52/52, sonda 23 casos |
| F4.4 migración usuarios | No aplica PoC (sin usuarios reales) | ADR-004, inventario aprobado |
| F4.5 convivencia | No aplica (proveedor único) | ADR-004 |
| F4.6 sesión/revocación | Hecho, verificado remoto | `20260912060500_session_guard.sql`, 4 negativos |

## F5 — Datos (`docs/fase-5/cierre-fase-5.md`, cerrada con salvedad 2026-09-14)

F5-datos cerrada (singleton settings/global, ETL 6/6, sonda 8/8, 19/19
migraciones entonces). F5-operativa: deploy Ready + smoke 401 (reverificado
en F7). Criterios (a)–(d) desplazados: (a) inferencia→F7.6, (b) HIBP→F7.2,
(c) mapa UID→negocio, (d) CI→F7.1.

## F6 — Storage (`docs/fase-6/cierre-fase-6.md`)

F6.1–F6.3 hechas (inventario 845 fuentes, diseño, 12 migraciones aplicadas,
pgTAP 29→30/30, sonda 20/20, buckets privados vacíos). F6.4 no aplicable
(decisión PoC 2026-09-15). F6.5 movida a F7.1/F7.6.

## F7 — Calidad (este cierre)

Ver `plan-fase-7.md`, `cierre-fase-7.md` y `evidencias/`.

## Pendientes por dueño (tras F7)

- **Organización:** UAT/firma F7.6 (incluye inferencia piloto con texto),
  decisión HIBP, mapa UID o exclusión formal, acuerdo CI o runners,
  backup remoto autorizado, presupuesto/SLO.
- **Bloqueado por entorno (vía CI):** paridad PG17 + stack Docker
  (`supabase.yml`, tipos generados), E2E webkit si el runner lo cubre.
- **Mío:** nada abierto tras el commit de F7.
