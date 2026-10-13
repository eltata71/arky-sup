# Operación con varios agentes

Arky se mantiene con varios agentes a la vez —Claude Code, Codex y Hermes—
sobre el mismo clon. Este documento es el contrato que les impide pisarse, y
`scripts/agentes/` es lo que lo comprueba.

## Lo que pasó y por qué existe esto

El 2026-10-07 la auditoría del espacio de trabajo encontró diecinueve
worktrees, tres agentes y dos versiones de «en qué ola vamos». `main` estaba
bien: la ola 10 estaba completa (10.0–10.5, #160–#166). Pero un agente había
**reabierto la 10.2**, ya fusionada en #162, con un alcance que no estaba en el
plan —una cola persistente en base de datos, con migración—, y lo hacía **sin
commit en el checkout principal**, sobre la rama vieja de la 10.2, con ocho
ramas locales más que nunca subió. Desde fuera, el repositorio parecía estar en
la 10.2; desde GitHub, en la 13. El propietario descartó ese trabajo entero.

Ninguna de las tres cosas que lo causaron era visible para los demás agentes:
el checkout principal fuera de `main`, una tarea cerrada reabierta y trabajo que
sólo existía en un disco. Las reglas de abajo hacen visible cada una.

## Las cinco reglas

1. **El checkout principal sólo sigue a `main` y no se edita.** Es el sitio que
   todos los agentes y las personas miran para saber el estado; trabajar en él
   cambia la respuesta para todos. Cada tarea vive en su propio worktree.
2. **Una tarea se reserva antes de empezarla, y la reserva es una PR en
   borrador.** `nueva-tarea.sh` la crea. GitHub es lo único que ven todos los
   agentes —un worktree en `/tmp` o en `~/.codex` no lo ve nadie más—, así que
   ahí vive la reserva. Mientras esté abierta, nadie más toma esa tarea.
3. **Una tarea `Hecha` no se reabre.** Si hace falta más trabajo, se propone al
   propietario como tarea nueva en el plan en curso; `nueva-tarea.sh` se niega a
   reservar una tarea que no esté en la tabla de ningún plan, o que esté
   `Hecha` o `Descartada`.
4. **El trabajo se publica el mismo día.** Una rama que sólo existe en un disco
   es trabajo que nadie puede revisar, continuar ni recuperar.
5. **Antes de empezar, `estado.sh` sin avisos.** Sale con código 1 si el
   checkout principal no está limpio en `main`, si hay cambios sin commit sobre
   una tarea ya fusionada o sobre una base anterior a `main`.

## Las herramientas

| Script | Qué hace | ¿Cambia algo? |
|---|---|---|
| `bash scripts/agentes/estado.sh` | Inventario: `main`, el checkout principal, cada worktree (`activa`, `nueva`, `antigua`, `fusionada`, con cambios y bloqueo), ramas sin publicar, PR abiertas y ramas remotas ya fusionadas | No |
| `bash scripts/agentes/localizar-tarea.sh <id>` | Dice en qué plan de `PLANES` está la tarea y si está abierta (`plan\|prefijo\|fila`; sale con 1 si está cerrada, 3 si no está en ningún plan, 4 si está en dos: fija `ARKY_PLAN`) | No |
| `bash scripts/agentes/nueva-tarea.sh <agente> <id> <tema>` | Comprueba las reglas 2 y 3, crea `<prefijo>/<id>-<tema>` (el prefijo de su plan) desde `origin/main` en `$ARKY_WORKTREES/<agente>-<id>` (por defecto `~/workspace/arky-sup-worktrees/`), la publica y abre la PR en borrador | Sí |
| `bash scripts/agentes/limpieza.sh [--aplicar]` | Borra worktrees limpios y fusionados, ramas locales fusionadas y ramas remotas cuya PR está fusionada. **En seco por defecto.** Nunca toca un worktree con cambios, uno bloqueado por una sesión viva, `main` ni Dependabot | Sólo con `--aplicar` |
| `bash scripts/agentes/instalar-guarda.sh` | Activa `scripts/agentes/hooks/`: el checkout principal rechaza commits y avisa si deja `main`. Escape: `ARKY_PERMITIR_PRINCIPAL=1` | Configuración local |

«Fusionada» se mide preguntando a GitHub por la PR de la rama, porque las PR se
fusionan con *squash* y la rama nunca llega a ser ancestro de `main`.

## Por agente

- **Claude Code** abre sus sesiones en `.claude/worktrees/bridge-*` y las
  bloquea mientras viven; `limpieza.sh` no las toca. Dentro de la sesión, la
  tarea sigue la regla de una rama por tarea (`<prefijo>/<id>-<tema>`).

## Los planes

Cada plan con tabla de seguimiento está en `PLANES`, en
`scripts/agentes/comun.sh`, con el prefijo de rama de sus tareas:

| Plan | Prefijo | Estado |
|---|---|---|
| `docs/plan-clase-mundial.md` (olas 9–14) | `clase-mundial/` | Cerrado el 2026-10-13 |
| `docs/plan-agentes-ia.md` (olas 15–20) | `agentes/` | En curso desde el 2026-10-13 |

Un plan nuevo se añade a esa lista en el mismo commit que lo aprueba; si no,
`nueva-tarea.sh` no encuentra sus tareas. La tabla se lee tal como está en
`origin/main`: una fila cambiada en una rama sin fusionar no cuenta.
- **Codex** crea sus worktrees en `~/.codex/worktrees/`. Igual que los demás:
  reserva con `nueva-tarea.sh`, o al menos con una PR en borrador.
- **Hermes** no trabaja en el checkout principal ni en ramas que no publique.
  Sus tareas programadas deben llamar a `estado.sh` y parar si sale con 1.

## Cierre del día

```bash
bash scripts/agentes/estado.sh            # ¿algo fuera de su sitio?
bash scripts/agentes/limpieza.sh          # ¿qué sobra? (en seco)
bash scripts/agentes/limpieza.sh --aplicar
```
