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

## Lo que `command_allowlist` dejó ver, y las tres decisiones del propietario (2026-11-01)

El mismo hallazgo abrió una pregunta sobre `command_allowlist`: no son 4
configuraciones sueltas entre los perfiles de producción, es una escalera
estrictamente creciente — 16 especialistas con lista vacía; `alexis`,
`camilo` y `rafael` con 11 patrones peligrosos pre-aprobados (borrar en
rutas raíz, `execute_code` sin aprobación, sobrescribir ficheros de
sistema, descargar-y-ejecutar, código inline, comandos de shell empaquetados,
y 5 hallazgos del escáner externo Tirith); `jose` con esos 11 más heredocs
(12); `arkysupabase`/`latamfactory` con esos 12 más `protected_instruction_file`
(13). José decidió tres cosas sobre esta escalera:

**1. Quitados los 11 a `alexis` y `rafael`.** Su SOUL declara "siempre
read-only", pero no hay ningún control técnico que lo haga cumplir — ni
modo solo-lectura, ni toolset acotado, solo esta lista. El SOUL es una
instrucción al modelo, no un control; ganaba la configuración. Verificado
antes de quitarlos, no supuesto: el SOUL de los dos ya convierte "no pude
ejecutar esto" en un veredicto bloqueado válido, así que el rol no
necesita estos permisos para funcionar, y ninguno de los 6 patrones
no-Tirith coincide con un comando de lectura real (`git diff/log/show/
blame`, `cat`, `grep`, `npm test`/`lint`) — probado contra las expresiones
regulares exactas del motor instalado. Razonamiento fechado en el
`command_allowlist: []` de cada perfil.

**`camilo` queda sin tocar, a propósito.** Comparte el mismo grupo de 11
pero es el arquitecto (etapa 16a), un rol de escritura por diseño, no el
revisor independiente (16b) que son `alexis`/`rafael`. No hay evidencia
equivalente de que no necesite estos permisos — es la pieza que queda
pendiente de mirar aparte, no una corrección de hoy.

**2. Quitado `protected_instruction_file` a `arkysupabase` y `latamfactory`.**
Ese permiso dejaba escribir `AGENTS.md`/`CLAUDE.md`/`SOUL.md`/`.cursorrules`
de un proyecto sin la aprobación humana que esos ficheros siempre exigen
("incluso con `--yolo`", según el propio motor) — la excepción exacta que
rodeaba la disciplina de que las instrucciones compartidas pasen por
worktree+PR+revisión, y sin dejar rastro: ningún log se escribe cuando este
permiso evita el aviso (confirmado leyendo `tools/approval.py`/
`file_tools_write_guards.py` — los únicos avisos registrados son por
configuración mal formada, nunca por un uso real de la lista permanente).
Verificado antes de quitarlo: ningún cron ni script de estos dos perfiles
toca `CLAUDE.md`/`AGENTS.md` hoy, y el historial reciente de esos dos
ficheros llega siempre por PR fusionada — quitarlo no rompe ningún uso
rutinario existente.

**3. Evaluado añadir el canónico a `security.protected_instruction_extra_patterns`
— y descartado, por un efecto real que no era visible sin comprobarlo.**
El propio mecanismo que protege `AGENTS.md`/`CLAUDE.md`/`SOUL.md` solo
compara el **nombre del fichero (basename)**, nunca la ruta completa —
confirmado leyendo `file_tools_write_guards.py`: `fnmatch` corre sobre
`os.path.basename(candidate)`, con la ruta ya descartada. Y `SKILL.md` no
es un nombre exclusivo del canónico de `latam-factory-orchestration`: es
la convención genérica de **todas** las skills de Hermes — 1.840 ficheros
con ese nombre exacto en este árbol. Añadir el patrón protegería los 1.840
por igual, no solo el nuestro, sin ninguna forma de acotarlo a una carpeta
con este mecanismo tal como existe hoy. Y no es hipotético: el propio
curador de Hermes reescribe ficheros `SKILL.md` de forma automática y
desatendida como parte de su mantenimiento rutinario (`actor: "curator"`,
`action: "patch"` en `.curator_ledger.jsonl`, visto tan reciente como
2026-10-31) — exigir aprobación humana para cada escritura a un `SKILL.md`
habría interferido con ese proceso nativo de Hermes, no solo con el
nuestro. **No se aplicó.** La disciplina de worktree+PR sigue siendo, hoy,
la única cosa que protege de verdad al canónico — un acuerdo entre
personas, no un control técnico — y este hallazgo queda registrado para
que nadie proponga este mismo arreglo dentro de un mes sin saber que ya se
evaluó y por qué no sirve tal como está construido el mecanismo.

## `run_budget_seconds`/`max_turns`: el mismo patrón, un tercer caso (2026-11-03)

`t_8c2134ab` murió dos veces cerca de los 300 segundos. El propietario subió
`max_runtime_seconds` de la tarjeta a 7200 en kanban, autorizado
explícitamente, y el worker se paró otra vez a los 251s — el runtime
efectivo no venía de la tarjeta, venía de `run_budget_seconds: 300` en
`andres-integration/config.yaml`, un límite distinto que nadie tocó porque
nadie sabía que había dos. Auditoría perfil por perfil, la misma disciplina
de este documento: **16 de 33 perfiles** (todos los creados por el bootstrap
de "nuevo perfil" — ver `latam-factory-orchestration/SKILL.md`, "20 turnos
..., 300 segundos...") tenían exactamente `max_turns: 20` /
`run_budget_seconds: 300`; los otros 17 no tienen el campo y corren con el
valor por defecto del motor.

Subidos los 16, dimensionados por lo que su rol ejecuta de verdad, no a ojo
ni todos igual:

**Pesados — ejecutan test o build real** (`max_turns: 30`,
`run_budget_seconds: 1200`): `andres-integration`, `paola-qa` (etapa 17,
corre `test:coverage` directamente), `ricardo-devops` (integración continua,
corre `quality:gate`/build directamente), `mateo-backend`,
`valentina-frontend`, `gabriel-maintenance`, `daniela-data-architect`. El
suelo es evidencia medida, no estimación: `test:coverage` solo (vitest +
cobertura, 659 ficheros/6.134 tests) tardó 305s en este repositorio
(`t_8c2134ab-quality.log`, 2026-11-02); el job `Static gates` de CI —el
equivalente de `quality:gate`— tardó entre 1m45s y 2m45s en varias PRs de
esta misma sesión. 1200s es ~4× el peor comando individual medido, con
margen para `npm ci`, reintentos y contención — por debajo de los 7200s que
el propietario usó como escotilla de emergencia para una sola tarea
atascada corriendo la cadena vieja sin dividir.

**Ligeros — revisan, clasifican o deciden, no ejecutan test/build de
producto** (`max_turns: 25`, `run_budget_seconds: 600`):
`ignacio-solution-architect` (16a, confirmado por el propio caso de
`t_8c2134ab`: lee y dictamina, no ejecuta), `julian-security`,
`maria-product-owner`, `natalia-documentation`, `sofia-ux-designer`,
`viviana-business-analyst`, `elena-release`, `lucia-sre`, `sergio-llmops`.
Sin evidencia medida de su carga real salvo `ignacio-solution-architect`
(por el caso de `t_8c2134ab`) — clasificados por lo que su rol implica, no
por telemetría. Si alguno de estos corre código real que esta nota no vio,
sube ese perfil al nivel pesado.

20 turnos y 300 segundos siguen siendo el valor que entrega el bootstrap de
perfil nuevo — no se cambió el bootstrap, solo los 16 que ya existían y
estaban demasiado ajustados para lo que de verdad hacen.

**Lo que esta subida no arregla:** que `max_runtime_seconds` (tarjeta) y
`run_budget_seconds` (perfil) sean dos verdades sin conciliar sigue siendo
un defecto de diseño — registrado como tarjeta `t_dc22118e` en el tablero
`latam-factory`, con una propuesta de reconciliación dimensionada y sin
construir (es código de Hermes, no de este repositorio).

## Los cuatro que faltaban — y ocho más del mismo tipo (2026-11-03)

La subida de los 16 anteriores se centró en quien implementa y se saltó
cuatro perfiles sin razonarlo: `jose`, `camilo`, `rafael`, `alexis`. Los
cuatro tenían bloque `agent:` pero **sin `max_turns` ni `run_budget_seconds`
en absoluto** — no es el mismo síntoma que los 16 (ajustados pero cortos),
es la otra mitad del mismo defecto: correr sin presupuesto alguno, con el
valor por defecto del motor (`run_budget_seconds=None`,
`max_iterations=sys.maxsize` — genuinamente ilimitado).

Dimensionado por rol, sin telemetría directa de ninguno de los cuatro:

- **`jose`** (`max_turns: 40`, `run_budget_seconds: 900`). Coordina,
  descompone y consolida sobre muchas tarjetas en una sola sesión — más
  pasos que una revisión de una sola tarjeta, aunque cada paso sea barato
  (`gh pr list`, `hermes kanban show`). No ejecuta código de producto
  (`multiagente.md`: "no escribe código de producto"), así que no necesita
  el presupuesto de tiempo de quien corre tests/build.
- **`camilo`** (`max_turns: 30`, `run_budget_seconds: 900`). Arquitecto de
  la etapa 16a: escribe dictámenes tras investigación real, no solo
  lectura — el propio caso de `t_8c2134ab` lo confirma ("Probes reales...
  36 permutaciones invocations×events"). Entre el nivel ligero y el pesado.
- **`alexis`** y **`rafael`** (`max_turns: 25`, `run_budget_seconds: 900`
  los dos). Revisores independientes de la etapa 16b: leen diffs y
  ejecutan comprobaciones focalizadas sobre el SHA final, no la suite
  completa — no triviales, pero tampoco del tamaño de quien implementa.

Los cuatro comparten `run_budget_seconds: 900`: ninguno corre la puerta de
calidad completa, así que no necesitan el suelo de 1200s medido para esa
carga; 900s es margen sobre varias comprobaciones focalizadas encadenadas,
no una medición directa de ninguno de los cuatro.

**Lo que no se tocó, y es el mismo desajuste:** al revisar estos cuatro
aparecieron **ocho perfiles más del elenco original de los 12 Bots**
(`multiagente.md`) con el mismo vacío — ni `max_turns` ni
`run_budget_seconds`: `alba`, `andres`, `diego`, `elena`, `lucia`, `mateo`,
`sofia`, `valentina`. No se tocaron sin que el propietario lo pida
explícitamente para estos ocho (a diferencia de los cuatro de arriba, que
sí se nombraron) — se deja anotado para no tener que redescubrirlo.
