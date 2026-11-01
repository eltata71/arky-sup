# Una decisión "para todos los perfiles" hay que verificarla perfil por perfil

## La lección, 2026-11-01

`auto_decompose` se reencendió el 2026-10-25 (`16e9cd2`) y se volvió a
apagar el día siguiente, 2026-10-26, cuando José decidió ser el embudo de
toda solicitud — la corrección quedó bien razonada y bien fechada en
`arkysupabase/config.yaml` y `latamfactory/config.yaml`. Pero **el perfil
`jose`** — el único que de verdad hace de embudo, con gateway activo —
**se quedó fuera**: su `config.yaml` no se tocó ese día, y siguió con
`auto_decompose: true` una semana entera sin que nadie lo notara, porque
nadie comprobó perfil por perfil si la corrección había llegado a todos
los que debía.

No es un descuido aislado: es el mismo patrón que ya nos costó una sesión
entera dos veces este mes — la lista fija de tableros en los vigilantes de
cron (Hermes crea tableros sin que nadie los registre, así que una lista
escrita a mano siempre queda atrás) y las 18 copias divergentes de la
skill de orquestación antes de que se enlazaran por symlink a un canónico
único. Una regla que se cree aplicada "a todos los perfiles" en realidad se
aplicó a mano, en los perfiles que alguien recordó tocar ese día.

## Lo que se encontró al comprobar, no al suponer (2026-11-01)

Auditado con un script de una sola pasada sobre los `config.yaml` y
`shell-hooks-allowlist.json` de los 34 perfiles:

- **`auto_decompose` por defecto es `true`** cuando la clave falta
  (confirmado leyendo `gateway/kanban_watchers_common.py` y
  `hermes_cli/config_defaults.py` del motor instalado — no supuesto). Solo
  `arkysupabase`, `jose` (corregido hoy) y `latamfactory` lo declaran
  explícitamente en `false`. **Los ~20 perfiles especialistas del roster
  real no declaran la clave en absoluto**, así que corren con el valor por
  defecto — `true` — y los tres tienen un ticker activo de verdad (`hermes
  -p <perfil> cron status` → "Gateway is running", confirmado para varios).
  No se ha corregido: decidir el alcance (¿los 20 también, o solo los tres
  que de verdad despachan admisión?) y ejecutarlo es trabajo pendiente,
  deliberadamente no hecho hoy por ser un cambio de política sobre muchos
  perfiles a la vez.
- **`latamfactory` tenía el hook del motor declarado en `config.yaml` pero
  sin fichero `shell-hooks-allowlist.json` en absoluto.** Confirmado leyendo
  `agent/shell_hooks.py`: un hook `pre_tool_call` no aprobado **falla
  abierto**, no cerrado — se omite en silencio con un aviso en el log
  (`register_from_config`, "not allowlisted — skipped"), sin TTY para
  aprobarlo en un gateway desatendido. `fail_closed: true` no lo protege:
  esa bandera solo actúa sobre un hook ya registrado que falla en
  ejecución, nunca sobre uno que nunca llegó a registrarse. Corregido hoy:
  se creó el fichero con las mismas tres aprobaciones que `arkysupabase`.
- **10 perfiles con nombre corto (`andres`, `diego`, `elena`, `lucia`,
  `mateo`, `sofia`, `valentina`, `viviana`, `alba`, `arkyaws`) no tienen
  ningún hook configurado** — ni el del motor, ni el de registro de uso.
  **No son perfiles muertos**: tienen tareas reales marcadas `done` en
  `arky-maintenance` (confirmado consultando el tablero, no suponiendo
  "legacy" de memoria). Si alguien invoca uno de estos por costumbre o por
  error, corre sin la protección que el resto del roster sí tiene. No se
  ha corregido ni decidido si deben seguir existiendo, fusionarse con su
  homónimo largo, o recibir los mismos hooks — trabajo pendiente, fuera de
  alcance de hoy.

## Qué se hizo hoy (una corrección puntual, no la política completa)

Se corrigió `jose/config.yaml` (`auto_decompose: false`, con el mismo
razonamiento fechado que los otros dos) y se creó
`latamfactory/shell-hooks-allowlist.json`. Las dos son ediciones de un solo
perfil cada una — el mismo criterio que ya se aplicó esta semana para no
tocar infraestructura compartida sin que una persona lo mirara primero. Los
20 especialistas con `auto_decompose` implícito y los 10 perfiles sin hooks
quedan como hallazgos, no como arreglos, a la espera de que el propietario
decida el alcance.

## Primer paso sugerido (dimensionado, no construido)

Un chequeo en `estado-fabrica.py` — el único punto de consulta que ya
existe para "¿necesita esto a una persona ahora?" — que lea, para cada
perfil activo del roster (descubierto en vivo desde el registro de agentes,
nunca una lista escrita a mano, por la misma razón que los tableros):

1. `auto_decompose` explícito (no ausente) y en el valor que la política
   vigente pida — hoy `false` para los perfiles con gateway que despachan
   admisión.
2. Cada hook declarado en `hooks.pre_tool_call`/`post_api_request`/
   `post_auxiliary_call` de `config.yaml` tiene su entrada exacta en
   `shell-hooks-allowlist.json` — la comprobación que hubiera encontrado el
   hueco de `latamfactory` sin tener que leer `shell_hooks.py` a mano.

Reporta como "ATENCIÓN" los perfiles que se desvíen, con el perfil y la
clave exacta que falta — el mismo formato que ya usa para gates humanos
pendientes. No decide la política (qué valor es correcto); solo dice dónde
diverge de lo que el propietario ya declaró en los perfiles que sí corrigió.
