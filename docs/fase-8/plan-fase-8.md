# Fase 8 — Plan PoC: pre-corte, no corte productivo

**Rama:** `feature/fase8-corte`. **Base:** `785535f` (cierre F0–F7).
**Alcance PoC:** sin datos productivos, sin ambientes múltiples (decisión F1 §7),
sin migración histórica Firebase (F6.4 excluida). F8 formal (`plan-transformacion-supabase-ddd.md` §4)
exige corte productivo; en PoC se ejecuta solo **pre-corte fail-closed**.

## Gates previos (bloquean corte)

| Gate | Estado 2026-09-17 | Dueño |
|---|---|---|
| F7.6 UAT humana + inferencia piloto con texto | Pendiente de sesión piloto, decisión **1A** | Organización |
| Diagnóstico 429 atribuido (cuota vs local) | Pendiente de llamada autenticada real, decisión **2A** | Organización + dev |
| HIBP (`auth_leaked_password_protection` off) | Diferido durante PoC sin usuarios reales, decisión **3C** | Operación |
| Mapa UID Firebase → UUID o exclusión formal | Excluido formalmente del PoC, decisión **4B** | Negocio |
| CI verde / runners | Evidencia local aceptada temporalmente, decisión **5B** | Operación |
| Backup remoto autorizado + SLO/presupuesto/RPO-RTO | Diferidos por alcance PoC, decisiones **6B/7B** | Operación |
| Node 20→24 antes 2026-10-01 | Verificado con Node 24.21.0: estáticos, build, bundle y suite completa en verde, decisión **8A** | Dev/Ops |
| URLs externas | Se mantienen como enlaces, decisión **9A** | Negocio + dev |

## Tareas F8-PoC ejecutables

- F8.1 dry-run read-only: `migration list --linked`, `db advisors`, smoke prod `/api/ai` (401 esperado).
- F8.2–F8.6: solo preparación documental (ventana, rollback, comunicaciones). Sin congelar escrituras ni cambiar rutas sin aprobación org.
- Criterio de salida F8-PoC: plan + evidencias + acta de no-corte firmada por bloqueos. Corte productivo = NO.

## Verificación Node 24

La decisión **8A** actualizó `.nvmrc` a `24`, añadió `engines.node = 24.x` y `engines.npm >=10`, y sincronizó `package-lock.json`. Los workflows de CI, E2E y seguridad ya consumen `.nvmrc`, por lo que no requieren una versión duplicada. La validación `quality:static` y el build se ejecutan con Node 24.21.0; el resultado queda registrado en la evidencia de esta fase.

`CLAUDE.md` conserva referencias históricas a Node 20 en su sección protegida; no se modificó sin autorización explícita. La fuente operativa vigente para el runtime es `.nvmrc` + `package.json` + los workflows.

## No objetivos

Carga final, cambio de rutas, piloto controlado ampliado, retiro legado (F9).
