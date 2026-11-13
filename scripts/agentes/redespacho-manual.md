# Redespacho manual: comentario obligatorio desde el segundo

Estado: **ESPECIFICACIÓN. No hay código de enforcement, hook ni cron instalado.** La referencia de calibración y sus pruebas aisladas no son una guarda operativa. Este
documento no acredita enforcement; el cumplimiento sólo existirá cuando los
cortes de la sección 9 estén implementados, revisados sobre su SHA final e
instalados con aprobación. Una frase en un SOUL o en una skill tampoco lo
acredita (es el instrumento que ya falló en t_0e4d6e31).

Tarjeta: `t_0c2ba14a` (hija de `t_3697e2e9`). Complejidad 3, ruta completa.

## 0. Decisión de partida (no se reabre)

Decidido por José el 2026-11-11: el control es un **comentario obligatorio** que
explique qué cambió desde el intento anterior. **No hay límite numérico de
redespachos** ni ventana de tiempo. Sin tocar el motor de Hermes.

Lo que el comentario obligatorio sustituye es el número arbitrario: lo que se
exige no es «cuántos» sino «por qué otra vez». La «excepción humana» de la
sección 5 exceptúa *el requisito del comentario*, no un tope, porque no hay tope.

## 1. Qué es un redespacho manual

Un redespacho manual es una **operación externa que devuelve una tarjeta al pool
despachable**. En `kanban_db.py` (v0.22.2) deja un evento propio que el
despachador nunca escribe; por eso el discriminador es el **tipo de evento**, no
el autor (ver «Por qué no el autor» abajo).

| Evento en `task_events` | Origen | ¿Cuenta? |
|---|---|---|
| `unblocked` (`unblock_task`), llamada desde tres superficies: CLI `hermes kanban unblock [--reason]`, herramienta de agente `kanban_unblock` (sólo orquestador; **no tiene parámetro de razón**) y arrastre de una tarjeta bloqueada a `ready` en el dashboard (`plugin_api.py`) | operación externa, desde `blocked`/`scheduled` | **Sí** |
| `review_reopened` (`reopen_review_task`; CLI `reopen-review`) | operación externa, desde `review` | **Sí** (0 casos en el tablero hoy; se incluye porque es el mismo hueco) |
| `claimed`/`spawned` tras `gave_up`, `crashed`, `timed_out`, `rate_limited`, `respawn_guarded` | despachador | No: es el reintento automático |
| `promoted` por `recompute_ready` (dependencias cumplidas) | despachador | No |
| `assigned` con `source: kanban.default_assignee` | despachador | No |
| `changes_requested` (veredicto del revisor) | revisor; `reason` ya es obligatorio en el payload | No: es un veredicto, y su razón existe por construcción |
| `reclaimed`, `assigned` manual, arrastre de una tarjeta que no estaba bloqueada, `promote` manual | operación externa | **Fuera de este corte** (sección 8) |

**Por qué no el autor.** `unblocked` tiene `payload = NULL` cuando la tarjeta
vuelve a `ready` (`unblock_task`), y el comentario `UNBLOCK:` lo firma
`$HERMES_PROFILE`. En el tablero real los 43 comentarios adyacentes a un
`unblocked` los firma `arkysupabase` (39 con prefijo `UNBLOCK:`): operador
humano, agente y cron entran con el mismo nombre. Un
`unblocked` de un cron sigue siendo externo y cuenta igual. Esto es exactamente
la identidad compartida que `vigilar-autorrevision.py` ya declara como límite.

**La superficie por defecto de un agente no deja comentario.** La herramienta
`kanban_unblock` (`tools/kanban_tools.py`, `_handle_unblock`) sólo recibe
`task_id` y `board`: llama a `unblock_task` sin razón. Un orquestador que
use la herramienta en vez del CLI produce un `unblocked` mudo por
construcción. Esa es la vía que L1 debe cubrir primero.

**Distinción con `block_loop_detected`.** Es ortogonal y no se toca. Hermes
cuenta `block_recurrences` por `block_kind` *en `block_task`* (límite 2 → la
tarjeta va a `triage`) y lo conserva a través de `unblock_task` hasta
`complete_task`. Esa cuenta mide «bloqueada dos veces por la misma causa»; no
mira quién la sacó de `blocked` ni qué dijo. El control de este documento mide
**cada salida manual de un bloqueo**, tenga o no el mismo `block_kind`. Una
tarjeta puede tripear uno, el otro o ambos; ninguno sustituye al otro. En el
bucle real t_d1ad10c7 (recurrencias 2→3→4) el freno automático se disparó y aun
así hubo redespachos manuales: no se cubrían entre sí.

## 2. Cuándo se exige

- `ordinal` = número de eventos de redespacho manual de la tarjeta **incluido el
  actual**, contados desde el último `completed` de esa tarjeta (como Hermes,
  que sólo limpia `block_kind` en `complete_task`).
- Se exige comentario válido cuando `ordinal >= MIN_ORDINAL`, con
  **`MIN_ORDINAL = 2`**: el primer redespacho tras un bloqueo no se exige; el
  segundo y siguientes sí. Es la lectura del título de la tarjeta («posterior al
  primero»). El cuerpo dice «posterior al primer bloqueo», que admite la lectura
  `MIN_ORDINAL = 1`; ver decisión abierta D-1. Es una constante, no una regla
  distinta.
- El primer redespacho no se bloquea, pero se registra y el hook, si existe, lo
  recuerda en el mensaje no bloqueante.

## 3. Qué cuenta como «explicar qué cambió»

La asociación es por evento, no por una bolsa común de comentarios:

| Evento | CLI y orden nativo v0.22.2 | Prefijo exacto | Ventana R1 |
|---|---|---|---|
| `unblocked` | `unblock --reason`: comenta antes de desbloquear | `UNBLOCK:` | desde el mayor de fin del último run y comienzo del ciclo hasta evento + 2 s |
| `review_reopened` | `reopen-review --reason`: reabre antes de comentar | `CHANGES REQUESTED:` | desde el mayor de fin del último run, comienzo del ciclo y hora del evento hasta evento + 2 s |

Los prefijos cruzados no sirven. Un comentario de veredicto anterior a una
reapertura no explica esa reapertura, aunque use `CHANGES REQUESTED:`. La
herramienta `kanban_unblock` no lleva razón: necesita el `UNBLOCK:` previo
verificado en su propia tarjeta y ventana. La correlación por segundos no
prueba identidad del autor ni causalidad perfecta: si hay varias operaciones
concurrentes en el mismo segundo, la futura implementación debe declarar la
asociación ambigua y escalar, no inventar una correspondencia. La referencia
es calibración temporal, no acredita esa protección concurrente.

Dos niveles, que no se confunden:

- **Compuerta determinista (necesaria):** reglas R1–R5. Es una función pura
  `check_reason(reason, title, prev_block_reason, prev_redispatch_reason)`. Rechaza
  lo que claramente no explica nada. **No** demuestra que lo dicho sea cierto ni
  suficiente.
- **Juicio humano (suficiente):** el revisor independiente o el propietario
  decide si lo dicho es el cambio *relevante* para la causa del bloqueo. La
  función no lo sustituye.

| Regla | Condición | Rechaza |
|---|---|---|
| R1 presencia y ventana | comentario de la misma tarjeta con el prefijo y la ventana específicos del evento en la tabla anterior; nunca intercambiables | redespacho mudo, prefijo cruzado o comentario de veredicto anterior reutilizado |
| R2 sustancia mínima | al quitar el prefijo, ≥ 40 caracteres y ≥ 6 tokens distintos (sin palabras vacías) | «Reintentando», «ok», «listo» |
| R3 no es eco del título | al menos 50 % de los tokens distintos del comentario no aparecen en el título | repetir el título (el caso que nombra la tarjeta) |
| R4 no es repetición | Jaccard de tokens < 0,6 contra el motivo del bloqueo previo (`blocked`/`block_loop_detected.reason`) y < 0,8 contra el comentario del redespacho anterior; y no es una frase genérica (`reintentando`, `retry`, `reanudar`, `continuar`, `desbloqueo`, `ya está`, `de nuevo`…) de menos de 8 tokens | repetir el bloqueo como «explicación»; pegar lo mismo cada vuelta |
| R5 referente verificable | contiene al menos un referente: SHA hex (7–40, con dígito y letra), `#NNN` de PR, id de tarjeta `t_xxxxxxxx`, ruta o fichero con extensión conocida, cambio `A->B`/`de X a Y` con números, o `clave=valor` | «Reconciliación autorizada con plan y PR fusionada.» (sin PR concreta) |

Un cambio «material» es, operativamente, **algo con nombre que existía distinto
antes**: una PR fusionada, un SHA nuevo, un valor de configuración con su
antes y su después, una autorización con su alcance, un estado del entorno
corregido. Repetir, parafrasear el bloqueo o declarar la intención de reintentar
no es un cambio.

Parámetros calibrados (todos en un único módulo, cambiar uno exige re-ejecutar
la calibración de la sección 7): `MIN_LEN=40`, `MIN_DISTINCT_TOKENS=6`,
`TITLE_NOVEL_RATIO=0.5`, `JACCARD_BLOCK=0.6`, `JACCARD_PREV=0.8`,
`GENERIC_MAX_TOKENS=8`, `WINDOW_SKEW_S=2`.

### Ejemplos reales (tablero `arky-maintenance`, 2026-11-11)

Aceptados (leídos a mano, tarjeta `t_8c2134ab`, redespachos 2 a 5):
«PR #307 fusionada (separa test:coverage de build:placeholders…) + swap de 8GB
activo…»; «andres-integration: run_budget_seconds 300->1200, max_turns 20->30…»;
«Checkout principal restaurado a main (estaba en pr-310 por error mío…); estado.sh
da 'Sin avisos.'». Cada uno nombra qué cambió y la causa del bloqueo anterior.
También los tres de `t_d1ad10c7` (n=2..4).

Rechazados:
- Sin comentario: `t_42e81d5d` (n=2, n=3), `t_653ce95d` (n=2), `t_f1df9d9a` (n=2).
- Texto presente pero vacío de contenido: `UNBLOCK: Reconciliación autorizada con
  plan y PR fusionada.` — **el mismo texto exacto en 11 tarjetas distintas**
  (`task_comments`, 11 filas, 11 tareas). R2 y R5 lo rechazan. Lo que muestra:
  un comentario obligatorio sin la sección 3 se convierte en una fórmula pegada.

## 4. Dónde se exige: tres capas, ninguna toca el motor

Una única función (`check_reason`) y un único cálculo de `ordinal` en un módulo
Python compartido; las tres capas lo importan. Dos reglas escritas en dos sitios
es cómo aparecen dos tablas que discrepan.

| Capa | Mecanismo | Qué da | Qué no cubre |
|---|---|---|---|
| **L1 preventiva** | `pre_tool_call` shell hook `require-reason-on-redispatch.py.referencia`, hermano de `require-max-runtime-on-create.py.referencia` (mismo mecanismo, mismo estilo de instalación y de registro de bloqueos). Dos entradas: (a) `terminal` con `hermes kanban [--board X] unblock\|reopen-review`: valida el `--reason` del propio comando; (b) herramienta `kanban_unblock` (no lleva razón): valida el comentario `UNBLOCK:` ya escrito para `unblocked`; `reopen-review` valida su `--reason` literal y L2 exige el `CHANGES REQUESTED:` posterior, según R1 | Bloquea, antes de ejecutar, cuando `ordinal >= 2` y la razón falta o no pasa R2–R5; el mensaje dice qué comando usar (`--reason` con referente, o `kanban_comment` con prefijo `UNBLOCK:` y reintentar la herramienta) | dashboard (arrastre), ejecución por un humano en su shell, perfiles sin el hook, razón construida fuera de la línea (ver abajo) |
| **L2 detectiva** | `vigilar-redespacho.py`, sólo lectura de `kanban.db`, patrón de `vigilar-autorrevision.py` | Recorre `unblocked`/`review_reopened` con `ordinal >= 2` sin comentario válido (R1–R5) y deja un comentario de escalada con firma estable `REDESPACHO-SIN-EXPLICACION: evt=<id>`; idempotente; salida 1 si hay hallazgos nuevos | Es posterior: la tarjeta ya se redespachó. **No contiene** (no bloquea, no reclama): el mismo razonamiento de `vigilar-limites.md` — una intervención reactiva compite con el despachador |
| **L3 revisión** | En la etapa 16, el revisor lee el historial de redespachos de la tarjeta; un redespacho con escalada `REDESPACHO-SIN-EXPLICACION` sin excepción registrada es un hallazgo | Cubre el juicio «¿es el cambio relevante?», que R1–R5 no puede | No automatizable |

Reglas del hook, heredadas de las revisiones de su hermano y no negociables:
tokeniza con `shlex` por segmento (`;`, `&&`, `||`, `|`, salto de línea), de modo
que un título o texto con `--reason` dentro de un argumento nunca cuenta como
flag; examina también el contenido que `write_file`/`patch` escribe (evita el
script escrito y ejecutado después); una razón no literal (`$(...)`, `` ` ``,
`$VAR`, `@fichero`) se trata como no verificable y se bloquea con el mensaje
«escribe la razón literal», porque el hook no puede evaluar lo que el shell
expandirá. Fallo del payload (JSON ilegible): pasa, como sus hermanos, porque no
puede saber que era un redispatch. **DB ilegible con un `unblock`/`reopen-review`
reconocido: bloquea** (falla cerrado) con el motivo en el mensaje. Cada bloqueo
se anota en `~/.hermes/logs/kanban-redespacho-sin-explicacion.jsonl` (el mismo
patrón: uno aislado es un agente topándose con la regla; varios seguidos es
algo insistiendo en evitarla).

La futura L1 debe reutilizar **`hermes_cli.kanban_db.kanban_db_path(board=...)`**
del mismo runtime operacional y con el mismo contexto de perfil/kanban home y
entorno que la operación interceptada. El argumento explícito sale de
`--board` del CLI o de `board` de `kanban_unblock`; no se reconstruye la ruta
con `~/.hermes/kanban/current`. El resolver nativo aplica
`HERMES_KANBAN_DB`, `HERMES_KANBAN_BOARD`, el tablero activo y los fences de
`HERMES_KANBAN_TASK`/delegación: bajo fencing un `--board` explícito no
permite escapar de la DB fijada. Se conserva ese resultado, sin limpiar el
entorno operativo ni cambiar el motor.

Resolver la ruta no autoriza mutarla: se abre únicamente mediante SQLite
`mode=ro`; no usar `connect()` nativo que pueda inicializar/escribir tablas.
Si el resolver no existe, es incompatible o no se puede demostrar la misma
resolución, una operación de redespacho reconocida se bloquea con diagnóstico.
La interfaz se cotejó con v0.22.2; no se declara estable entre versiones.
La aceptación de la futura L1 incluye `current=A` y pin/destino efectivo=B,
argumentos de CLI/herramienta, perfil/default y `--board` bajo fencing.
Los tests nativos de resolución son opcionales explícitos fuera del host del
runtime, y prueban sólo selección de ruta: no un hook instalado ni enforcement.

## 5. Excepción humana

Existe para el caso legítimo en que quien redespacha no puede cumplir R1–R5 (por
ejemplo, una recuperación urgente sin SHA ni PR) y para que esa decisión quede
dicha y atribuida, no silenciosa.

- Una excepción es un comentario de la propia tarjeta con firma
  `REDESPACHO-EXCEPCION: por=<quién> -- <motivo>` (mínimo 20 caracteres de
  motivo), modelada sobre `ANULACION-HUMANA:` de `vigilar-autorrevision.py`.
- La escribe el **propietario** (José o quien él designe en esa tarjeta), no el
  agente que redespacha. El agente que choca con el hook se detiene y escala;
  no puede fabricarla porque el hook también bloquea que un agente comente esa
  firma (`hermes kanban comment … "REDESPACHO-EXCEPCION:…"` desde un perfil
  agente).
- **De un solo uso:** vale para el siguiente redespacho de esa tarjeta, y queda
  consumida cuando aparece ese evento. El siguiente exige otra excepción o un
  comentario válido.
- El vigilante informa siempre las excepciones consumidas y marca la tarjeta
  cuando acumula 2 o más: son el equivalente estructural de «seis vueltas porque
  alguien insistió». No hay tope; hay visibilidad.
- **Límite honesto, no resuelto:** `por=` es texto libre. Hermes no ata un
  comentario a una identidad verificable (mismo límite documentado en
  `vigilar-autorrevision.py`, `add_comment` no valida `author`). Resuelve «no
  quedó ningún rastro de que fue una decisión», no «quién fue de verdad».

## 6. Efecto sobre el flujo existente

- Un `unblock` con `--reason` es lo que ya se hace (39 de 54 hoy, según
  `task_comments`). El cambio es que, desde el segundo, ese texto debe pasar
  R2–R5. Para quien ya explica qué cambió, el coste es cero: 10 de los 16
  redespachos con `ordinal >= 2` del tablero ya lo cumplen (sección 7).
- Los desbloqueos masivos con una sola frase (`UNBLOCK: Backlog de endurecimiento
  sin bloqueo real…`, 2026-11-08) son primer redespacho de cada tarjeta:
  no se gatean. Si una tarjeta ya desbloqueada vuelve a bloquearse, el segundo
  desbloqueo sí se exige: es lo que se busca.
- No cambia `block_loop_detected`, el despachador ni el estado de ninguna
  tarjeta. El vigilante sólo comenta.

## 7. Evidencia de calibración (sólo lectura, 2026-11-11)

Las reglas se corrieron contra `arky-maintenance/kanban.db` abierta con
`mode=ro` (sin escribir, sin CLI, sin redespachar nada). Script de calibración
versionado como `calibrar-redespacho.py.referencia` (semilla del corte 1: referencia, no se instala ni es código de producción; se ejecuta con `python3 scripts/agentes/calibrar-redespacho.py.referencia <kanban.db>`).

- (Captura inicial; el tablero sigue creciendo: una corrida posterior dio 2 primeros redespachos fallidos más, 25 en lugar de 23, y los 16 gateados idénticos.) 54 eventos `unblocked`, 38 tarjetas, 10 con ≥ 2 redespachos (máximo 5);
  0 `review_reopened`.
- Redespachos con `ordinal >= 2`: **16** → 10 pasan, 6 fallan: 4 sin comentario
  (verdaderos positivos) y 2 con la fórmula pegada de 11 tarjetas (verdaderos
  positivos).
- Primer redespacho (no gateado): 38 → 15 pasan, 23 fallan; se informa y no se
  exige. De 23, 9 son esa misma fórmula y 14 no tienen comentario o referente.
- De los 10 aceptados, leí el comienzo (~170 caracteres) de 7 (`t_8c2134ab` ×4,
  `t_d1ad10c7` ×3): cada uno nombra un cambio concreto. De los otros 3
  (`t_008d8734`, `t_3eb92119`, `t_5d609ea4`) sólo vi el resultado mecánico y un
  fragmento de 90 caracteres.
- Ninguno de los 16 tiene un falso positivo evidente; el tamaño de la muestra es
  de un tablero y no demuestra la tasa de falsos positivos general. La
  calibración del corte 1 debe repetirse sobre sus fixtures.

## 8. Límites honestos y lo que queda fuera

1. **R1–R5 es forma, no verdad.** Quien pegue un `#999` inventado pasa la
   compuerta. Mitigación opcional (corte 5, no obligatoria): verificar SHA con
   `git cat-file -e` y PR con `gh pr view` cuando el comentario los cite; sin
   red o sin repo, se degrada a «sin verificar» visible, nunca a «verificado».
2. **L1 sólo cubre agentes con el hook.** El dashboard, un shell humano y perfiles sin
   hook quedan a L2. `estado-fabrica.py` debe comprobar que el hook está
   registrado y aprobado en `shell-hooks-allowlist.json` en cada perfil del
   alcance (corte 4); un hook declarado sin aprobación **falla abierto**, ya
   documentado en ese script.
3. **L2 es una foto entre ejecuciones.** Entre dos corridas la tarjeta puede
   haberse redespachado y completado. Más frecuencia acorta la ventana, no la
   elimina. Cron configurado no equivale a cron activo (`vigilar-limites.md`).
4. **No contiene.** Ni L1 (fuera de su cobertura) ni L2 impiden el redespacho
   del humano. Es un registro exigido y atribuido, no una puerta.
5. **Fuera de este corte** (hallazgo, no resuelto): `reclaim` de un run vivo,
   reasignación manual tras `gave_up`, arrastre de columna en el dashboard
   desde un estado distinto de `blocked`/`scheduled`, y `promote`. Devuelven
   una tarjeta al pool igual. No son «posterior al primer
   bloqueo» y su ampliación necesita su propia decisión de José. Se anota para
   no darlos por vigilados.
6. **La identidad no es verificable** (sección 5).
7. **Los parámetros están calibrados sobre un tablero.** Subir o bajar un umbral
   es un cambio de contrato: se revisa como cualquier otro.

## 9. Plan de implementación (cortes TDD; no se implementa aquí)

Un solo especialista escritor, worktree propio, revisor independiente (Rafael o
Alexis) sobre el SHA final. Las pruebas de cada corte usan un tablero SQLite
desechable creado en un directorio temporal; **ninguna toca la DB real ni
redespacha una tarjeta real**.

| Corte | RED (la prueba que falla primero) | GREEN | Refactor / gate |
|---|---|---|---|
| 1. Módulo puro `redespacho_manual.py` | tabla de casos: los 16 gateados de la sección 7 reproducidos como filas sintéticas + R1–R5 uno a uno + `ordinal` con `completed` intermedio + `review_reopened` | `classify_events`, `ordinal`, `check_reason` | sin E/S ni reloj implícito; `python3 -B -m unittest discover -s scripts/agentes/tests -v`, `py_compile`, `git diff --check` |
| 2. Hook L1 | evasiones del hermano (título con `--reason`, `write_file` de un script, `$(...)`, `--board`, segmentos), herramienta `kanban_unblock` sin comentario previo → bloquea, con comentario válido → pasa, DB ilegible → bloquea, y un agente que comenta `REDESPACHO-EXCEPCION:` → bloquea | `require-reason-on-redispatch.py.referencia` | un único import del módulo del corte 1 |
| 3. Vigilante L2 + excepción | dry-run no escribe; idempotencia de la firma; excepción de un solo uso; salida 0/1 | `vigilar-redespacho.py` | sin `reclaim`/`block`; sólo `comment` |
| 4. Instalación y chequeo | `estado-fabrica.py` marca perfil sin hook o sin allowlist | `instalar-guarda-redespacho.sh` (idempotente, como `instalar-guarda-max-runtime.sh`) + línea en `multiagente.md` | instalar requiere aprobación humana |
| 5. (opcional) verificación de referente | SHA/PR inexistentes se marcan «sin verificar»/«inexistente» | `git cat-file`/`gh` inyectados | degradación visible, sin red = no verificado |

Gates por corte: la suite de `scripts/agentes/tests`, `py_compile` con
`PYTHONPYCACHEPREFIX` fuera del repositorio y `git diff --check`. No se toca el
código de la aplicación: `quality:gate` y `test:coverage` no cambian de
resultado por estos cortes, pero se corren en el cierre del último como en
cualquier PR del repositorio.

**Ensayo aislado antes de instalar** (sin redespachar tarjetas reales): tablero
desechable con `HERMES_HOME` temporal; 3 escenarios — redespacho 1 con razón
vacía (pasa), 2 con eco del título (bloquea/escala), 2 con «PR #N fusionada +
cambio A->B» (pasa) — más el escenario de excepción.

**Rollback.** L1: retirar la entrada de `pre_tool_call` del `config.yaml` del
perfil y su aprobación de `shell-hooks-allowlist.json`; vuelve al
comportamiento actual sin efectos laterales (sólo lee la DB). L2: pausar o
borrar el cron; los comentarios que dejó son sólo comentarios y se quedan como
historia. Ningún corte cambia el esquema ni el estado de una tarjeta, de modo
que no hay migración que deshacer. `MIN_ORDINAL` sube a un valor alto como
interruptor de emergencia sin retirar nada.

## 10. Decisiones abiertas para José

- **D-1** — ¿`MIN_ORDINAL` = 2 (título: desde el segundo redespacho) o = 1 (cuerpo:
  desde el primer redespacho tras el primer bloqueo)? Con 1, 23 de los 38
  primeros redespachos históricos habrían fallado (9 por la misma fórmula
  pegada). Elegí 2 por el título y porque es más barato de adoptar; cambiarlo es
  una constante.
- **D-2** — ¿Se amplía después a `reclaim`/reasignación/`promote`? (sección 8.5).
  No es necesario para esta tarjeta.
- **D-3** — ¿Quién designa al «propietario» que puede firmar la excepción? La
  spec supone José, sin autenticarlo (sección 5).
