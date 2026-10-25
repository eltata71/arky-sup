# vigilar-limites

## Qué problema resuelve, y qué deliberadamente no

Confirmado leyendo el código de Hermes (no supuesto): una hija del
auto-decomposer nunca hereda `max_runtime_seconds` ni `max_retries`
(`_insert_decomposed_child`, `hermes_cli/kanban_db_graph.py:200` — el
`INSERT` omite las dos columnas). El asesino de tareas por tiempo del propio
despachador ni siquiera la evalúa: su consulta, `kanban_db_dispatch.py:726`,
lleva `WHERE ... max_runtime_seconds IS NOT NULL`. No es un plazo generoso —
es ningún plazo.

No se puede arreglar desde un hook (los eventos de ciclo de vida del kanban
son observadores, no bloquean ni modifican) ni desde la CLI de tareas ya
creadas (`kanban edit` no toca esos campos). El arreglo de raíz exige
parchear el motor instalado — software de terceros (Nous Research, MIT) —, y
José decidió no modificarlo. Reportado río arriba por separado.

**Encargo explícito: la opción más barata que resuelva el problema real, no
la más completa.** Por eso este script hace una sola cosa — parar una tarea
que se desboca — y deliberadamente NO vigila `kanban.max_in_progress` (el
tope de flota): eso habría sido empezar a replicar el sistema de límites de
Hermes desde fuera, que es justo lo que no se pidió.

## Qué hace

Cada 2 minutos: tareas `running` sin `max_runtime_seconds` que llevan más de
`--runtime-ceiling-seconds` (600 por defecto) corriendo se paran con
`hermes kanban reclaim --board <tablero> <id>` — que **termina el proceso
real del worker** (confirmado leyendo `reclaim_task`/
`_terminate_reclaimed_worker`, no solo libera el candado en la base de
datos) y deja un evento `manual_reclaim` con el motivo. Nunca escribe en la
base de datos directamente.

## Probado contra el escenario real, no contra uno imaginado

Tablero desechable, borrado al terminar cada vez. Encontré y corregí un
fallo real antes de activarlo: la primera versión no pasaba `--board` a la
llamada de `reclaim`, así que habría actuado contra el tablero por defecto en
vez del indicado. Y descubrí un efecto secundario real: el gateway de
`arkysupabase` vigila y redespacha *cualquier* tablero del perfil, incluso
uno desechable — una tarea sintética con `claim_lock` nulo disparó la propia
reconciliación de huérfanos de Hermes antes de que este script llegara a
actuar; la prueba limpia tuvo que fijar un `claim_lock` sintético no nulo
para aislar el efecto de este script del de Hermes.

## Latencia de reacción y qué se escapa

- **Techo real de exposición**: ~600s + hasta 2 min de espera al siguiente
  sondeo ≈ **10–12 minutos como máximo** por ocurrencia, frente a "sin
  límite" que es lo que hay hoy.
- **Qué se escapa**: una tarea que empieza y termina todo su daño dentro de
  una sola ventana de sondeo (hasta 2 minutos). Es una foto entre dos
  chequeos, no vigilancia continua — la misma limitación honesta de
  `vigilar-tarjetas.py`.
- **Resuelto, no solo nombrado: la correa recurrente escala al segundo golpe.**
  `reclaim` por sí solo devuelve la tarea a `ready` — la segunda vez que este
  script interviene sobre la MISMA tarea (contado por su propia firma en
  `task_events`, no por el contador de fallos de Hermes, que `reclaim_task`
  resetea a propósito en cada intervención manual), ya no la reclama otra
  vez: reclama (sigue haciendo falta para matar el proceso real) y a
  continuación bloquea con `kind=needs_input`, que no se autopromueve — pide
  un humano. Confirmado leyendo el código que `block` *sin* `reclaim` antes
  no mata el proceso real — por eso siempre va reclaim primero, incluso en
  la escalada. Probado contra dos rondas reales seguidas (tablero desechable):
  1ª vez → `ready`; 2ª vez → `blocked`, confirmado que no se autopromueve.

## Uso

```bash
python3 scripts/agentes/vigilar-limites.py <kanban.db> <tablero> --profile arkysupabase [--dry-run] [--cron]
```

Código de salida: 0 si no hubo que parar nada; 1 si se detuvo alguna tarea.

## Programado en cron

`vigilar-limites-watch` (`e44230fb1638`), cada 2 minutos, perfil
`arkysupabase`, vía `~/.hermes/profiles/arkysupabase/scripts/vigilar-limites.sh`
(fuera de este repo por la convención de Hermes: los scripts de cron viven en
la carpeta del perfil). Entrega y aviso de fallo a `bot-chat:arkysupabase`.

## Relación con `auto_decompose`

`auto_decompose` se apagó el 2026-10-25 tras el incidente, y se volvió a
encender el mismo día una vez construidos este script y el hook del motor:
la descomposición manual no daba ninguna revisión real de contenido (ejecuta
la misma `_insert_decomposed_child` igual de automática en cuanto se
dispara), así que mantenerlo apagado solo costaba autonomía a cambio de una
protección aparente. Historia completa en `arkysupabase/config.yaml`, junto
a la propia línea.

## Hueco conocido que queda abierto a propósito

Ni este script ni el hook del motor atrapan **una hija que hace algo
indebido y breve**: no toca el motor (el hook no aplica) y termina antes de
que este vigilante la alcance en su ventana de sondeo de ~2 minutos. No se
cierra porque cerrarlo exigiría vigilancia continua en vez de por sondeo, que
sería desproporcionado para lo que se sabe hoy. Queda dicho, no resuelto —
revisar si algún día aparece un caso real de este tipo.
