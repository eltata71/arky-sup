# Operación con varios agentes

Arky se mantiene con varios agentes a la vez —Claude Code, Codex y Hermes—
sobre el mismo clon. Este documento es el contrato que les impide pisarse, y
`scripts/agentes/` es lo que lo comprueba.

## Fábrica Hermes de mantenimiento

La unidad operativa es el proyecto nativo de Hermes `arky-sup-factory`
(`ARKY-SUP Software Factory`), vinculado a este repositorio y al Canvas
`arky-maintenance` (tenant `arky-sup`). HermesWebUI mantiene además un espejo
de navegación con el mismo nombre: sirve para agrupar sesiones, pero no
sustituye al proyecto nativo ni al Canvas.

La fuente de verdad funcional es `docs/plan-remediacion-agentes.md` (ola 21), que cierra lo que el doble chequeo encontró en `docs/plan-agentes-ia.md` (olas 15–20). José
coordina el ingreso, comprueba plan/PR/worktrees y conserva la trazabilidad en
Canvas; no escribe código de producto. José es el primero de los doce Bots y
enruta a los otros once: Sofía (producto), Alba
(solución), Camilo (software), Viviana (frontend), Andrés (backend), Mateo
(datos), Valentina (QA), Diego (DevOps), Lucía (seguridad), Elena (UX) y Rafael
(revisión independiente). Cada uno es un perfil Hermes aislado con su propio
SOUL, modelo, skills, herramientas y `Bot Chat`.

Los nombres Sofía, Lucía y Elena también aparecen entre las personas-agente del
dominio de la Oficina de Arquitectura. No son la misma entidad: en este
documento `Hermes/<nombre>` identifica el perfil externo de mantenimiento y
`Arky/<nombre>` la persona interna del producto. Perfil, almacenamiento y ciclo
de vida están separados; ningún handoff Hermes se registra como trabajo del
dominio de Arky.

El flujo normal es:

1. José valida necesidad, dependencias y ownership existente.
2. Sofía y Alba/Camilo producen criterios, SDD o ADR cuando corresponde.
3. Un solo especialista escritor trabaja en un worktree reservado y publicado.
4. Un revisor independiente —Valentina, Lucía o Rafael según el alcance— revisa
   el mismo SHA sin editarlo; nunca es el productor.
5. Diego verifica CI/despliegue; José registra evidencia y solicita los hitos
   humanos de arquitectura, merge, deploy o rollback.

`message_agent` permite handoffs directos entre los `Bot Chat`; los grupos
multi-Bot son una superficie de Hermes Desktop y se usan sólo para debates
acotados. El dispatcher del gateway es la única autoridad de Canvas cuando
`kanban.dispatch_in_gateway=true`; no se instala un cron de dispatch paralelo.
Una PR o worktree abierto ya reserva la tarea: Canvas la refleja, nunca lanza
un segundo escritor.

Comprobación mínima antes de asignar:

```bash
hermes project show arky-sup-factory
hermes kanban --board arky-maintenance diagnostics
hermes kanban --board arky-maintenance dispatch --dry-run --json
bash scripts/agentes/estado.sh
gh pr list --state open
```

La fábrica no reemplaza a las personas/agentes que existen dentro del producto
Arky: aquéllos son dominio de la aplicación; estos Bots mantienen el repositorio.

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
| `docs/plan-agentes-ia.md` (olas 15–20) | `agentes/` | Cerrado el 2026-10-23 |
| `docs/plan-remediacion-agentes.md` (ola 21) | `remediacion/` | En ejecución desde el 2026-10-24 |

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
