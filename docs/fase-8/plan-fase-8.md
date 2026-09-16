# Fase 8 — Plan PoC: pre-corte, no corte productivo

**Rama:** `feature/fase8-corte`. **Base:** `785535f` (cierre F0–F7).
**Alcance PoC:** sin datos productivos, sin ambientes múltiples (decisión F1 §7),
sin migración histórica Firebase (F6.4 excluida). F8 formal (`plan-transformacion-supabase-ddd.md` §4)
exige corte productivo; en PoC se ejecuta solo **pre-corte fail-closed**.

## Gates previos (bloquean corte)

| Gate | Estado 2026-09-16 | Dueño |
|---|---|---|
| F7.6 UAT humana + inferencia piloto con texto | No ejecutada | Organización |
| Diagnóstico 429 atribuido (cuota vs local) | Pendiente de llamada autenticada real | Organización + dev |
| HIBP (`auth_leaked_password_protection` off) | WARN activo, sin decisión | Operación |
| Mapa UID Firebase → UUID o exclusión formal | Pendiente | Negocio |
| CI verde / runners | 0 runners | Operación |
| Backup remoto autorizado + SLO/presupuesto/RPO-RTO | Pendientes | Operación |
| Node 20→24 antes 2026-10-01 | Pendiente | Dev/Ops |

## Tareas F8-PoC ejecutables

- F8.1 dry-run read-only: `migration list --linked`, `db advisors`, smoke prod `/api/ai` (401 esperado).
- F8.2–F8.6: solo preparación documental (ventana, rollback, comunicaciones). Sin congelar escrituras ni cambiar rutas sin aprobación org.
- Criterio de salida F8-PoC: plan + evidencias + acta de no-corte firmada por bloqueos. Corte productivo = NO.

## No objetivos

Carga final, cambio de rutas, piloto controlado ampliado, retiro legado (F9).
