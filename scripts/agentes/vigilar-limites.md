# vigilar-limites

## Qué problema resuelve

Dos huecos confirmados leyendo el propio código de Hermes (no supuestos), que
ninguno de los dos se puede arreglar desde un hook ni desde la CLI de tareas
ya creadas — el único arreglo de raíz es parchear el motor instalado, y
Hermes es software de terceros (Nous Research, MIT,
github.com/NousResearch/hermes-agent), así que ese parche se escala a José en
vez de aplicarse aquí:

1. **Una hija del auto-decomposer nunca hereda `max_runtime_seconds` ni
   `max_retries`** (`_insert_decomposed_child` en
   `hermes_cli/kanban_db_graph.py`: el `INSERT` omite las dos columnas). El
   asesino de tareas por tiempo del propio despachador ni siquiera la evalúa
   — su consulta lleva `WHERE ... max_runtime_seconds IS NOT NULL`. No es un
   plazo generoso: es ningún plazo.
2. **`kanban.max_in_progress` falla ABIERTO por diseño** — comentario literal
   en `kanban_db_dispatch.py`: *"non-Linux / read error → no cap"*. Si la
   lectura de configuración falla, deja de haber tope sin que nadie se
   entere salvo por un incidente.

Este script no corrige la causa — una hija sigue naciendo sin reloj. Pone un
techo desde fuera, con el mismo patrón que `vigilar-tarjetas.py`: detección
por sondeo, no prevención instantánea.

## Qué hace cada comprobación

- **Runtime**: tareas `running` sin `max_runtime_seconds` que llevan más de
  `--runtime-ceiling-seconds` (600 por defecto) corriendo se paran con
  `hermes kanban reclaim --board <tablero> <id>` — que **termina el proceso
  real del worker** (confirmado leyendo `reclaim_task`/
  `_terminate_reclaimed_worker`, no solo libera el candado en la base de
  datos) y deja un evento `manual_reclaim` con el motivo. Nunca escribe en la
  base de datos directamente.
- **Flota**: cuenta `running` contra `kanban.max_in_progress` configurado
  para el perfil (leído de su `config.yaml`, igual que lo lee Hermes). Solo
  **alerta** si lo supera — nunca para nada: decidir cuál de varias tareas
  concurrentes legítimas sacrificar no es una decisión que deba tomar un
  script sin criterio de negocio.

## Probado contra el escenario real, no contra uno imaginado

Un tablero desechable (`vigilar-limites-test`, borrado al terminar), con
tareas creadas por el camino normal (`hermes kanban create`) y su estado
reescrito a mano para imitar el incidente real: una corriendo 700s sin
`max_runtime_seconds` (como `t_9cecb0b9`), una con techo propio (no debía
tocarse), una demasiado reciente (no debía tocarse todavía) y una cuarta solo
para superar el tope de flota de 3.

**Encontré un fallo real al probarlo, antes de activarlo**: la primera
versión no pasaba `--board` a la llamada de `reclaim`, así que intentaba
actuar contra el tablero por defecto en vez del tablero real que se le
indicó — con otro id habría sido webs "no such task", pero con una
coincidencia de id habría sido mucho peor. Corregido y reprobado antes de
tocar nada de verdad.

**Efecto secundario real descubierto al probar**: el gateway de `arkysupabase`
vigila y redespacha activamente *cualquier* tablero del perfil, incluido uno
"desechable" — una tarea sintética con `status='running'` y `claim_lock`
nulo disparó la propia reconciliación de huérfanos de Hermes antes de que mi
script llegara a actuar. Un tablero desechable aísla los datos, no aísla del
despachador en vivo. La prueba limpia que sí aisló el efecto de este script
puso un `claim_lock` sintético no nulo para no disparar esa reconciliación
antes de tiempo.

**Límite honesto, encontrado en la misma prueba**: `reclaim` devuelve la
tarea a `ready`, no a un estado terminal — es lo correcto para un worker que
se cayó de verdad, pero significa que una hija sin reloj puede volver a
despacharse y correr otros 600s antes de que el vigilante la pare de nuevo.
No es un corte único, es una correa recurrente de como mucho el techo
configurado por vuelta — que puede ser exactamente lo que se quiere (permite
reintentos legítimos) o no, según el caso; queda nombrado, no resuelto aquí.

## Qué atrapa y qué se le escapa, frente al parche

| | Vigilante (este script) | Parche al motor |
|---|---|---|
| Cobertura | Cualquier tarea `running` sin reloj, venga de donde venga | Solo la vía conocida (`_insert_decomposed_child`) |
| Latencia | Acotada por el ciclo de sondeo (2 min aquí) | Inmediata, en cuanto se escribe el valor |
| Sobrevive a `hermes update` | Sí | No — se pierde en silencio |
| Toca el motor | No | Sí |
| Qué se le escapa | Una tarea que hace su daño entera dentro de una ventana de sondeo | Nada de este tipo concreto, pero sí otras vías no descubiertas |

## Uso

```bash
python3 scripts/agentes/vigilar-limites.py <kanban.db> <tablero> --profile arkysupabase [--dry-run] [--cron]
```

Código de salida: 0 si no hubo que parar ni avisar nada; 1 si se detuvo
alguna tarea o se detectó el tope de flota superado.

## Programado en cron

`vigilar-limites-watch` (`e44230fb1638`), cada 2 minutos, perfil
`arkysupabase`, vía el envoltorio
`~/.hermes/profiles/arkysupabase/scripts/vigilar-limites.sh` (fuera de este
repo por la misma convención de `vigilancia-tarjetas.sh`: Hermes exige que
los scripts de cron vivan en la carpeta del perfil). Entrega y aviso de
fallo a `bot-chat:arkysupabase`. Cadencia de 2 minutos, no las 12 horas de
`vigilancia-tarjetas.sh`, porque aquí lo que se vigila es trabajo sin
supervisión en curso, no deriva documental.

## Lo que no hace, y por qué queda anotado

- **No corrige la herencia.** Una hija sigue naciendo sin reloj; esto solo
  acota cuánto puede correr antes de que alguien (este script) se dé cuenta.
- **El tope de flota solo alerta, nunca para nada.** Que no se construya esa
  parte es deliberado, no un olvido.
- **Es una foto entre dos chequeos**, igual que `vigilar-tarjetas.py`. Una
  tarea que empieza y termina su daño en menos de 2 minutos no se atrapa a
  tiempo.
