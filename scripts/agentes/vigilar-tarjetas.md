# vigilar-tarjetas

## Qué problema resuelve

Detección, no prevención: `safe-specify.sh` evita que una llamada *que
nosotros hacemos* a `specify` pierda restricciones sin darnos cuenta, pero no
evita el disparo automático del despachador cuando `kanban.auto_decompose`
está activo (ver `t_4dec3959` en `arky-maintenance`). Este script compara el
estado actual de las tarjetas contra una huella guardada por
`capturar-huella.py` y avisa cuando el cuerpo cambió **sin pasar por una
edición explícita reconocida**.

## Cómo distingue una reescritura silenciosa de una edición normal

`task_events` ya registra dos tipos de evento distintos para cualquier cambio
de título/cuerpo: `specified` (el LLM auxiliar, automático) y `edited`
(`hermes kanban edit`, explícito) — confirmado leyendo la bitácora real antes
de construir esto, no asumido. El script mira, para cada tarjeta cuyo hash
cambió, cuál de los dos fue el evento más reciente desde la huella:

- Último evento `specified` → **ALERTA** (el caso de riesgo real).
- Último evento `edited` → **INFO**, no se alarma solo por eso.
- Ningún evento de ningún tipo → **ALERTA** distinta y más grave (cambio fuera
  del CLI reconocido).

`decompose` no entra en esta clasificación porque no reescribe el cuerpo de
la tarea que descompone — verificado por su propio payload (`child_ids`,
`root_assignee`, nada de `changed_fields`) antes de dar esto por bueno.

## Probado, no solo diseñado

Contra un tablero desechable, tres escenarios reales: una tarjeta
`specify`-ada sin restaurar (dio `ALERTA_SPECIFY`), una editada
explícitamente con contenido nuevo (dio `INFO_EDITADO`, no alertó) y una que
pasó por `safe-specify.sh` completo (no apareció en ningún lado — hash
idéntico a la huella). Los tres salieron como se esperaba.

## Uso

```bash
python3 scripts/agentes/capturar-huella.py <kanban.db> <board> <huella.json>
python3 scripts/agentes/vigilar-tarjetas.py <huella.json> [--comment] [--perfil jose]
```

Sale con 0 si no hay alertas, 1 si hay alguna — para que un cron o un
wrapper lo use como señal. `--comment` postea un aviso en cada tarjeta con
ALERTA (nunca modifica título/cuerpo, solo comenta).

## Lo que no hace, y por qué queda anotado

- **No actualiza la huella sola.** Una alerta resuelta sigue sonando hasta
  que alguien corre `capturar-huella.py` de nuevo a propósito — para que no
  se autosilencie la siguiente vez.
- **Es una foto entre dos chequeos, no vigilancia continua.** Una reescritura
  puede estar "viva" el tiempo que pase entre una corrida y la siguiente. Se
  acorta con más frecuencia, no se elimina.
- **`edited` no lleva autor en su payload** (a diferencia de `commented`), así
  que INFO dice que fue explícito, no quién lo hizo.
- **Programado en cron** (`vigilancia-tarjetas-watch`, perfil `arkysupabase`,
  `0 0,12 * * *`, job `69a68d75eb8a`), vía un envoltorio delgado en
  `~/.hermes/profiles/arkysupabase/scripts/vigilancia-tarjetas.sh` (fuera de
  este repo porque Hermes exige que los scripts de cron vivan en la carpeta
  del perfil; la lógica real sigue aquí, versionada). Entrega a
  `bot-chat:arkysupabase` -- el único canal realmente visible hoy: este
  gateway tiene "No messaging platforms enabled" (sin Telegram/Discord/Signal),
  así que `local` (lo que ya usaba `blocked-tasks-watch`) solo queda grabado en
  `hermes cron runs`, nadie lo ve. `--failure-deliver` al mismo canal empuja un
  aviso si el script revienta.
  **Límite honesto que queda sin cubrir**: si el propio gateway deja de
  tickear (no revienta, simplemente deja de correr nada), ningún cron -- ni
  este ni `blocked-tasks-watch` -- puede avisar de eso por sí mismo. El
  respaldo es `hermes cron status` / `hermes gateway status`, que alguien
  tiene que mirar.
- **Hay que mantener a mano qué (`db`, `board`, huella) vigilar**, igual que
  `PLANES` en `comun.sh`.
