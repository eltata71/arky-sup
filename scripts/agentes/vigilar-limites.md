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
- **No es un corte único**: `reclaim` devuelve la tarea a `ready`, no a un
  estado terminal. Una hija sin reloj puede volver a correr y esto la para
  de nuevo cada ventana (~10–12 min), no de una vez por todas. Es una correa
  recurrente, no una ejecución. Puede ser lo que se quiere (permite
  reintentos legítimos de verdad) o no, según el caso — queda nombrado, no
  resuelto aquí.

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

## Relación con apagar `auto_decompose`

Son complementarios, no alternativas — ver la comparación entregada aparte.
Apagar `auto_decompose` quita el disparador automático y desatendido; este
script sigue haciendo falta porque **la misma `_insert_decomposed_child` se
ejecuta igual si alguien dispara `hermes kanban decompose <id>` a mano**, y
porque `hermes kanban create --parent ...` sin `--max-runtime` tiene
exactamente el mismo hueco, con o sin auto-decompose.
