---
name: latam-factory-orchestration
description: Coordina ingeniería persistente con Hermes Kanban.
version: 0.1.0
author: LATAM AI Software Factory, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [factory, orchestration, kanban, governance]
---

# Orquestación LATAM AI Software Factory

> **Este fichero lo leen 18 agentes en vivo, por un enlace simbólico desde
> cada perfil; por eso no se edita aquí.** Se edita en un worktree de tarea
> (`nueva-tarea.sh`), pasa por su PR y su revisión independiente, y los 18 lo
> recogen solos cuando aterriza en `main` — editar directamente el árbol de
> trabajo del checkout principal cambia la conducta de los 18 antes de que
> nadie lo haya visto, que es la misma forma del defecto de autoaprobación
> que el resto de este documento existe para evitar.

## Cuándo utilizar
Al recibir o ejecutar trabajo del tablero `latam-factory`. No cambia reglas de proyectos o tableros ajenos ni sustituye controles obligatorios de seguridad.

## Requisitos
Perfiles nativos del catálogo `agents/catalog.json`, herramientas `kanban_*` confirmadas en la versión instalada, modelo accesible y workspace autorizado. Leer la tarjeta y el contexto de repositorio antes de actuar. La ausencia de credenciales bloquea la ejecución, no autoriza inventar resultados.

## Procedimiento
1. Recibir la solicitud y **clasificarla antes de crear ninguna tarjeta**: José decide `complejidad` (1–5, decide la capacidad de modelo) y `ruta` (`corta` o `completa`, decide qué etapas del flujo se recorren). Correspondencia base: 1–2 → corta; 3 → corta salvo que toque contratos, datos o arquitectura; 4–5 → completa.

   **La severidad del defecto pone un suelo a la complejidad, aunque el parche sea mecánico** [corrección 2026-10-26, primera prueba real sobre código de producción: `t_3eb92119`; calibración 2026-11-01, revisión independiente]: es un **suelo, no un valor fijo** — un parche pequeño puede bajar el esfuerzo dentro de ese suelo, nunca bajar el suelo mismo. Las etiquetas son las que emiten los revisores (`Critical`, `High`, `Medium`, `Low`) — **no se traducen**, porque traducir es por donde se escapan las reglas: una tabla en español que compara contra un hallazgo en inglés nunca coincide, y entonces la regla simplemente no se aplica, sin que nadie lo note. Calibración:

   - **`Critical`/`High` → suelo complejidad 4, ruta completa.**
   - **`Medium` → suelo complejidad 3.**
   - **`Low` → no mueve nada;** se clasifica solo por tamaño/esfuerzo, como antes.

   **La severidad es la del defecto, nunca la del arreglo.** Son dos preguntas distintas — qué tan grave es lo que está roto, y qué tan grande es el parche que lo arregla — y la segunda no contesta a la primera. HU-ORQ-007 lo dice en su propio criterio de aceptación — *"la clasificación considera riesgo y no solamente esfuerzo"* — y la tabla de niveles por sí sola no lo aplicaba: en la primera prueba real, un defecto `High` (el árbol de trazas de H2 dependiendo del orden de llegada en vez de una identidad estable) se clasificó como complejidad 2 porque el arreglo cabía en una función. El tamaño del parche no es el riesgo de equivocarse con él: un fallo que rompe la confianza en un dato de auditoría no se vuelve menos grave porque se arregle en diez líneas.

   **De dónde sale la severidad cuando todavía no hay revisor**: la que registró quien reportó o revisó el defecto. Si todavía no hay ninguna de las dos, se trata como `High` hasta que un revisor la clasifique — no como `Low` ni como «pendiente de decidir»: ante la duda sobre qué tan grave es algo, asumir lo barato es exactamente la apuesta que esta regla existe para prohibir.

   **Seguridad añade las etapas 18–23 en cualquier ruta**, corta o completa; despliegue o liberación añaden las suyas igual. La **etapa 16 está en las dos rutas** con sus dos componentes (16a especializada: Camilo y Ignacio; 16b independiente del SHA final: Rafael o Alexis — nombrado explícitamente en la solicitud de revisión, ver "`request-review` siempre lleva `reviewer`" más abajo), y no se cierra sin las dos.

   **Las etapas de la ruta corta, enumeradas aquí para no reconstruirlas de memoria** [corrección 2026-10-26: la primera prueba real omitió la etapa 17 dos veces por esto mismo — el canónico no las enumeraba y hubo que recordarlas de memoria durante la clasificación]: **1, 2, 11, 12, la etapa de desarrollo que corresponda (13 frontend / 14 backend / 15 integraciones / 24 mantenimiento), 16a+16b, 17 (Calidad, Paola — no se omite) y 26.** La ruta completa son las 26, sin excepción.

   Sin los dos atributos decididos, no hay tarjeta todavía — este paso es la admisión, no un trámite posterior a ella.
2. Registrar la solicitud ya clasificada en Kanban nativo con idempotency-key, objetivo, requerimientos, aceptación verificable, riesgo, fase SDLC, presupuesto, y `complejidad`/`ruta` del paso 1 escritos en el cuerpo. Utilizar IDs nativos como autoridad; proyecto no es perfil. Usar operaciones locales para transformaciones deterministas; `execute_code` para lotes mecánicos; `delegate_task` solo para razonamiento breve. Todo trabajo durable, con aprobación o interperfil permanece en Kanban.
3. Planificar **construyendo el grafo tarea por tarea**, con `kanban link` para dependencias que no sean de la raíz. No fan-out trivial. Asignar cada tarjeta a un especialista del catálogo; no hacer todo como José. Vincular dependencias, aceptación y revisión independiente.

   **El reloj no se arregla con prosa — se construye para que no se pueda omitir** [corrección 2026-10-26, agravada 2026-11-01: esta regla ya existía escrita, con énfasis y con su motivo al lado, y falló igual en su primera prueba real — `t_0e4d6e31` se creó bien con `create --parent` pero sin `--max-runtime`, y quedó corriendo sin límite de tiempo. Repetir la frase más fuerte trata un fallo estructural como un fallo de atención]. Por eso toda hija se crea con **`scripts/agentes/crear-tarea-hija.sh`**, nunca con `hermes kanban create` a mano: el envoltorio exige `--parent` y `--max-runtime` y **se niega a llamar a Hermes si falta cualquiera de los dos** — no hay valor por defecto a propósito, el número lo decide la tarea:

   ```
   bash scripts/agentes/crear-tarea-hija.sh --board <tablero> --parent <id-raíz> \
     --max-runtime 300 --max-retries 1 --assignee <perfil> -- "<título>"
   ```

   El envoltorio valida que `--max-runtime` sea un entero positivo (rechaza `0`, negativos y no-numéricos) y aplica de verdad el techo de `300` segundos por intento de ejecución de este flujo (paso 5) — no es un plazo agregado de toda la tarjeta, y no es solo una cifra en este texto: pedir más de 300 sin `--override-ceiling-reason "<motivo>"` se rechaza, no solo se desaconseja. Un presupuesto distinto requiere esa aprobación humana explícita, registrada en la propia llamada, antes de crear o despachar.

   **La puerta nativa debería cerrarse en la frontera del motor, no solo con el envoltorio** [revisión independiente 2026-11-01/02 — corrección urgente: este párrafo afirmaba instalado un control que no lo está, violando la regla de este mismo documento en "Errores frecuentes": "No afirmar allowlist fuerte si no existe enforcement"]: el envoltorio hace la omisión más difícil, nunca imposible — `hermes kanban create --parent` sigue siendo un comando real que cualquier perfil puede llamar directamente, y prohibirlo solo con prosa es el mismo instrumento que ya falló una vez. `scripts/agentes/require-max-runtime-on-create.py.referencia` es un `pre_tool_call` hermano de `block-hermes-engine-writes.py`, pensado para rechazar un `terminal` que invoque `hermes kanban ... create` con `--parent` y sin `--max-runtime` — **está escrito, no instalado en ningún perfil**, y la revisión independiente encontró además evasiones triviales en su diseño actual (ver el historial del PR #300/#304 para el detalle). Hasta que esté instalado, probado contra el payload real que Hermes entrega, y sin las evasiones conocidas, **esta frase no es cumplimiento**: es intención escrita, y el envoltorio sigue siendo la única cosa que de verdad exige el reloj hoy.

   **Si una tarjeta ya existe sin límite, el camino auditado es archivarla y recrearla con el envoltorio** [resuelto en vivo 2026-11-01, `t_0e4d6e31` → `t_8c2134ab`, autorizado por el propietario — **esta frase sustituye la redacción anterior de este párrafo, que decía "no inventar un comando ni recrearla silenciosamente"; no son instrucciones contradictorias, son la misma regla antes y después de que apareciera el primer caso real que la probó**]: `hermes kanban archive <id>` no toca al padre ni duplica nada — termina cualquier worker, libera el workspace y no se puede forzar sobre una tarjeta reservada por otra PR. Comentar en la hija archivada que se recrea por falta de reloj nativo, no por un fallo de su contenido; comentar en el padre qué se hizo y por qué; recrear con el mismo alcance técnico. **Mientras no se recree con el envoltorio, esa tarjeta no se despacha** [revisión independiente 2026-11-02 — este veto se perdió al reescribir el párrafo para enseñar archivar+recrear, y no debía: que ahora exista una vía auditada para corregirlo no cambia que, hasta que se use, la tarjeta sigue sin el reloj que es requisito de admisión]: el límite de tiempo se exige al crear, no se completa después de que el trabajo ya esté corriendo. Nunca recrear en silencio — el rastro en ambos comentarios es lo que lo distingue de "completar artificialmente el padre" o "duplicar la hija". El vigilante externo (`vigilar-limites.py`) y el hook de arriba son la red de seguridad para lo que el envoltorio no alcance a prevenir — una `decompose`, una escritura directa fuera de este flujo — pero parchear después no es cumplir el requisito de admisión.
   **No usar `hermes kanban decompose`** para planificar, aunque sea tentador por ser un solo comando: comparte el mismo insertador que una hija auto-descompuesta (`_insert_decomposed_child` en `kanban_db_graph.py`) y **nunca copia `max_runtime_seconds` ni `max_retries`**, se invoque a mano o automáticamente — el agujero del reloj no es de la automatización, es del propio comando. Confirmado leyendo su código, no suponiéndolo (auditoría 2026-10-26). Construir el grafo con `crear-tarea-hija.sh` es más lento que un solo comando, y es la diferencia entre una hija con límite de tiempo desde que nace y una que lo recibe media hora después, parcheada desde fuera por un vigilante.
4. Resolver modelo/proveedor en Hermes. Elegir por costo solo cuando existan evaluaciones reales y precio/alcance/vigencia conocidos. El costo estimado no es facturado; desconocido no es cero. Sin datos suficientes solicitar aprobación de un pin explícito, nunca fabricar benchmarks. El router complementario no controla por sí mismo todos los procesos Hermes.
5. Respetar máximo global de 3 y uno por perfil en este flujo, 20 turnos por nuevo perfil, 300 segundos por ejecución y una tentativa de ejecución inicial. Usar límites nativos y no iniciar Dispatchers/Cron adicionales. El gateway operacional es el único Dispatcher automático. Fallo de cuota/autenticación bloquea y requiere intervención; no reintentar en bucle.
6. Antes de modificar código, exigir repositorio autorizado y worktree por escritor; un solo propietario por archivo. Si hay conflicto, serializar con dependencia. Un worktree o toolset no es un sandbox ni impide acceso a secretos del host. No atribuir aislamiento sin evidencia.
7. Ejecutar pruebas RED/GREEN, lint/type-check/build y verificaciones aplicables. Registrar comandos, exit codes, SHA, archivos y evidencias adjuntas a la tarjeta. Indicar gates no disponibles y por qué. No usar simulaciones como prueba de inferencia real.
8. Mantener heartbeat y comentarios para trabajo prolongado. Respetar estados nativos, bloqueo con motivo, reintento acotado, recuperación nativa y referencias a sesión/ejecución. No almacenar un estado alternativo en metadatos.
9. Enviar implementación a revisión de Paola y Julián cuando corresponda; el implementador no aprueba su propio trabajo crítico. **Toda solicitud de revisión nombra explícitamente a quien revisa, nunca el propio nombre** — ver más abajo "`request-review` siempre lleva `reviewer`" para el porqué, a quién nombrar según la etapa, y qué hacer si el despachador devuelve la tarjeta igual. Producción, merge/publicación remota, migración destructiva, rollback, excepción de seguridad o aumento de presupuesto requieren aprobación humana explícita y evidencia inmutable del alcance aprobado. Una instrucción de personalidad nunca concede permiso.
10. Elena prepara release y José consolida solo después de pruebas y revisión. Sergio propone optimizaciones con antes/después verificables; no las aplica sin autorización. Guardar estándares reutilizables en Skills, decisiones de proyecto en ADR y memoria personal solo para hechos durables del agente.

## José coordina y no ejecuta el trabajo que ha asignado a otro
Criterio 3 de la historia de usuario de José: delega en lugar de ejecutar
indiscriminadamente. Esto no es una preferencia de estilo: si José crea una
tarjeta asignada a un especialista y luego hace él mismo el trabajo antes de
que el despacho se la reclame, pasan dos cosas malas a la vez. El
especialista no aporta nada — cuando por fin reclama la tarjeta, se limita a
confirmar un trabajo ya terminado. Y el ciclo **parece sano sin serlo**: las
tarjetas avanzan, hay un `completed`, hay hasta una revisión independiente
detrás — pero la garantía real que ese ciclo existe para dar (que alguien
distinto de quien pidió el trabajo lo hizo) nunca se ejerció donde importaba.
Es la misma forma del defecto de la autorrevisión, en versión suave: la forma
se cumple, la garantía no.

Pasó de verdad en la primera ejecución de prueba con este procedimiento
(2026-10-26, auditoría): José escribió el contenido del fichero en su propio
turno antes de que Natalia, la autora asignada, pudiera reclamar la tarjeta
— y, además, dejó que Natalia reclamara después una tarea que ya estaba
hecha. No rompió la cadena — Natalia igual produjo su propio proceso y su
propia evidencia — pero su turno quedó reducido a una firma sobre un trabajo
que no hizo.

**Regla**: José asigna y supervisa; no hace el trabajo de la tarjeta que
acaba de crear, aunque crea que sería más rápido. Si de verdad es más rápido
que lo haga él, esa es la señal de que la tarea nunca necesitó delegarse. Lo
correcto entonces es no crear la tarjeta; lo incorrecto es crearla y
adelantarse al especialista.

**Especificar no es ejecutar**: José escribe la especificación de la
tarjeta — objetivo, requerimientos, criterios de aceptación — y el asignado
escribe el entregable. Redactar criterios de aceptación es coordinar;
redactar el entregable es ejecutar. Esta distinción no autoriza una tarjeta
escueta: lo que ya pedían los pasos 1 y 2 (objetivo, requerimientos,
aceptación verificable, riesgo, fase SDLC, presupuesto, clasificación) sigue
siendo obligatorio — la regla de arriba no es excusa para escribir menos,
es prohibición de producir el artefacto.

**Lo que José sí hace por su cuenta, sin que esto lo contradiga**:
clasificar la solicitud, registrar la tarjeta con su especificación
completa, construir el grafo con sus dependencias y sus límites de tiempo,
supervisar el avance, bloquear cuando haga falta, reasignar, pedir revisión
independiente, y consolidar al cierre. Ninguna de estas acciones produce el
entregable que le pidió a otro — todas son coordinación, no ejecución.

**Si el atajo ya ocurrió** — José ya escribió el entregable antes de que el
asignado lo reclamara — la tarjeta no se despacha como si estuviera
pendiente: se bloquea, registrando en el cuerpo o en un comentario quién
hizo realmente el trabajo. Dejar que el asignado la reclame y la confirme
convierte su turno en una firma sobre algo que no hizo, que es exactamente
el defecto que esta regla existe para evitar, solo que ya consumado.

**Generalización**: la regla no es específica de José. Quien crea y asigna
una tarjeta no la ejecuta — José es el caso principal porque es quien
asigna casi todo, pero el mismo límite aplica a cualquier perfil que delegue
trabajo a otro.

**Lo que se reconoce de ese mismo incidente, porque también importa**: José
lo declaró él mismo, sin que nadie preguntara, y calificó su propio
procedimiento como incompleto por ese motivo exacto. Esa honestidad es
justo lo que este documento quiere reforzar — un coordinador que admite su
propio atajo sin que se lo descubran es más valioso que uno que nunca se
equivoca pero tampoco lo diría. La regla de arriba corrige el atajo; esto no
lo corrige, lo sostiene.

## `request-review` siempre lleva `reviewer`, y nunca el propio nombre (2026-11-12)

**Este no es un hallazgo nuevo — es la tercera vez que se documenta, y las
dos anteriores no se cerraron.** RG-09 (`docs/requerimiento-original-historias-usuario.txt`)
ya dice, desde el 2026-10-31: *"en Hermes v0.22.2, `request_review` mueve la
tarjeta a `review` conservando el `assignee` cuando nadie pasa un revisor
explícito... la garantía tiene que vivir fuera [del motor]"*. El 2026-10-25 se
confirmó sobre tres tarjetas reales distintas de las de hoy (`t_42e81d5d`,
`t_0108bdd2`, `t_8edc38b7`) y se construyó un vigilante externo
(`scripts/agentes/vigilar-autorrevision.py`) con anulación humana — **quedó
excluido** por hallazgos High de contención/desbloqueo y Medium de
identificación de eventos, y por un límite de identidad sin resolver (`--by`
es texto libre, sin atar a una sesión verificable). RG-09 sigue sin
acreditarse. Esto que se añade aquí es una instrucción para el agente, **no**
el enforcement externo que RG-09 pide — es más barato, pero es prosa: el
propio documento lo dice en "Errores frecuentes" y sigue aplicando aquí.

Confirmado otra vez, leyendo `claim_review_task` y el bucle de despacho del
motor instalado (no supuesto): sin un revisor explícito, la tarea `review` se
reclama con el `assignee` que tenga la fila en ese momento, sea quien sea —
normalmente el propio implementador. Y pasó una tercera vez, en tres tarjetas
más, el 2026-11-11/12 (`t_c76f34e8`, `t_8e7c7e0a`, `t_0c2ba14a`): tres
implementadores pidieron revisión sin nombrar revisor y los tres se
recibieron a sí mismos de vuelta. Dos cayeron con `exit 1` en su primer
reintento; `t_0c2ba14a` tuvo además dos `protocol_violation` (`rc=0`, sin
llamar a `kanban_complete`/`kanban_block`/`kanban_request_review`) antes de
morir con `exit 1` en su **tercer** intento de revisión — los tres perfiles se
encontraron de vuelta con su propia tarjeta sin que nada les dijera qué hacer
con eso, aunque no hay evidencia de que esa falta de instrucción sea la causa
exacta de cada caída; es la explicación más simple, no la única posible. Uno
de los tres lo vio venir y lo dijo con sus propias palabras antes de caer:
**"Coordinación: solicité revisión, pero el dispatcher volvió a asignarla a
ricardo-devops. Dejé aviso a José: hace falta otro revisor; no he
autoaprobado la entrega."**

**Límite de cobertura, declarado y no escondido**: este fichero lo cargan los
18 perfiles de mantenimiento LATAM, por enlace simbólico. **El plantel ARKY
del dominio del producto —alba, alexis, andres, diego, lucia, mateo, sofia,
valentina, viviana— no lo carga.** `t_c76f34e8` (una de las tres tarjetas que
motivan este cambio) la implementó "valentina", que es justamente uno de esos
perfiles: esta regla, aunque se siga a la letra, **no le llega**. Esta sección
no cierra los tres casos — cierra la regla para quien la lee. Cubrir al
plantel ARKY (o reasignar su trabajo de mantenimiento solo a perfiles que sí
cargan esta skill) es una decisión y un seguimiento aparte, de José.

**Regla, en tres partes:**

1. **Toda solicitud de revisión nombra explícitamente a quien revisa, nunca
   se omite, y nunca es el propio implementador** — eso es autoaprobación con
   otro nombre. Como worker, usa la herramienta, no el CLI: `kanban_request_review(reviewer=<perfil>, summary=<qué se implementó y cómo se verificó>)`.
   La herramienta valida que el perfil exista antes de aceptar la llamada; el
   CLI equivalente (`hermes kanban request-review <id> --reviewer <perfil>`,
   para uso humano/depuración) no lo valida, y una errata deja la tarjeta
   varada con un revisor que no existe.

   **A quién nombrar no se decide aquí con "según corresponda"**: este mismo
   documento ya fija parejas de revisor por etapa (16b: Rafael o Alexis; paso
   9: Paola y Julián cuando corresponda) — usa la que aplique a la etapa o
   tablero en curso, nunca una tercera regla inventada en esta sección. Para
   `arky-maintenance` sin una pareja ya fijada por otra etapa: Rafael o
   Alexis, el que tenga menos **carga** — `running` + `review` en
   `hermes kanban --board arky-maintenance stats`, no un conteo informal — y
   en empate, Rafael. Esta consulta de **solo lectura** al CLI está permitida
   como excepción al protocolo general de worker (que pide usar la
   herramienta, no `hermes kanban`, para operaciones de tablero): no muta
   nada, y `kanban_list` es solo del orquestador — no existe ninguna
   herramienta de estadísticas, solo el CLI. Si el agente prefiere no
   invocar el CLI, José hace esta elección en su lugar.

   **Una re-revisión no recalcula por carga.** Si la tarjeta ya tuvo un
   `changes_requested`, el motor manda la re-revisión al mismo revisor de ese
   evento cuando se omite `reviewer` (`_prior_reviewer` en el motor instalado)
   — y así debe seguir pedido explícitamente también: nombrar siempre al
   revisor del `changes_requested` anterior, nunca recalcular por carga a
   mitad de un hilo de revisión. Cambiar de juez entre una revisión y su
   re-revisión no es una decisión de carga, es una decisión que nadie tomó.

2. **Si el despachador entrega de vuelta una tarjeta propia que ya está en
   revisión, eso es un error de asignación — no una instrucción para seguir
   trabajando, y no la sigue cualquier otra skill que el carril de revisión
   fuerce.** Señal para detectarlo, como condición **conjunta**, no como
   disyunción: el `claimed` más reciente trae `source_status: review` **Y**
   el `review_requested` más reciente tiene `implementer` igual al propio
   perfil. `reviewer` nulo solo corrobora el caso, nunca basta por sí solo —
   un revisor legítimo recién reasignado (`assign` + `unblock`, abajo) ve el
   mismo `review_requested` con `reviewer` nulo porque la reasignación no
   emite uno nuevo, y confundir eso con el error de asignación bloquearía de
   nuevo justo a quien ya se reasignó bien. Al detectar el caso real:

   1. `kanban_comment` explicando lo que pasó (como hizo el agente citado
      arriba).
   2. `kanban_block(kind="needs_input", reason="redespachada a mí mismo sin revisor asignado, pendiente de reasignación")`
      — esto manda sobre cualquier instrucción de una skill de revisión que
      el despachador fuerce en el carril de revisión (p. ej. "aprueba o pide
      cambios"): no hay nada que revisar todavía, porque no hay revisor.
   3. Nunca autoaprobar ni declarar el trabajo revisado por seguir adelante.

   **Recuperación, en ese orden exacto — reasignar antes de desbloquear, y
   el camino lo decide el CONTEXTO DE EJECUCIÓN, nunca la persona**: no
   existe una herramienta de asignación en el motor instalado (v0.22.2); el
   paso de reasignar es siempre por CLI, `hermes kanban assign <id>
   <revisor>` (`assign_task` lo permite sobre una tarjeta `blocked`) — y esa
   llamada tampoco valida que el perfil exista (igual que el CLI de
   `request-review` ya advertido arriba: una errata deja la tarjeta
   reasignada a alguien que el despachador no puede lanzar). Comprobar el
   perfil con `hermes profile list` antes si hay duda.

   Para el `unblock`: **fuera de un worker despachado** (sin la variable de
   entorno que marca una ejecución como tal) — José en su propia sesión de
   chat o gateway, o un humano — usa `kanban_unblock(task_id=<id>)` si es
   José, o `hermes kanban unblock <id>` si es un humano. **Dentro de un
   worker despachado, incluido José cuando corre sobre su propia tarjeta,
   ninguna de las dos funciona** — las dos puertas rechazan igual dentro de
   ese contexto. Un worker en esa situación no intenta `unblock` por
   ninguna vía: comenta y bloquea para que José lo resuelva desde fuera.
   `unblock` devuelve la tarjeta a `review` conservando el `assignee` que
   tenía — desbloquear sin reasignar primero repite exactamente el mismo
   bucle que causó el bloqueo.

   Ver también "Errores frecuentes" (RG-09 y `vigilar-autorrevision.py`, el
   intento previo que sigue en `main` sin instalar ni acreditar) y el paso 8
   de arriba (bloqueo
   con motivo declarado, nunca un `crashed` sin comentario).

## El auto-descomponedor está apagado (`auto_decompose: false`, 2026-10-26)
El tick del gateway recorría las tarjetas en `triage` de todos los tableros y
llamaba a `decompose_task` con el LLM auxiliar, hasta `auto_decompose_per_tick`
por tick, leyendo `kanban.auto_decompose` fresco en cada tick. Funcionaba como
admisión automática: una tarjeta creada en `triage` se descomponía sola, sin
que nadie hablara con José.

El problema no era que fallara — era que hacía exactamente eso: no clasificaba
complejidad, no elegía ruta, y sus hijas no heredaban `max_runtime_seconds` ni
`max_retries`. Eso es **rodear al coordinador** que José pidió ser: si él es el
embudo de toda solicitud (recibir, clasificar, planificar, crear con reloj,
asignar, supervisar), un mecanismo que saca tarjetas de `triage` sin pasar por
él hace exactamente lo que se le pidió que no hiciera. Por eso está apagado
hoy, en `kanban.auto_decompose` de los perfiles que despachan
(`arkysupabase`, `latamfactory`) — no por un incidente nuevo, por un cambio de
diseño. La historia completa de encendidos y apagados anteriores, con sus
motivos propios, está junto a la línea en el `config.yaml` de cada perfil.

Qué significa en la práctica:
- `triage` ya no se vacía solo. Una tarjeta que llega sin clasificar se queda
  ahí hasta que alguien (José) la clasifique y la planifique — es el paso 1
  de este procedimiento, ahora ejecutable de verdad.
- `hermes kanban decompose` sigue instalado y sigue funcionando a mano, pero
  **no debe usarse** (ver paso 3): comparte el mismo agujero del reloj que la
  versión automática, haya o no `auto_decompose` encendido.
- Revertir (encender otra vez): `auto_decompose: true` en el `config.yaml` del
  perfil — efecto en el siguiente tick del despachador, sin reiniciar el
  gateway. Si se revierte, el paso 3 sobre no usar `decompose` sigue vigente
  igual: el agujero del reloj es del comando, no del interruptor.

## Errores frecuentes
- Un gateway conectado no significa que el agente trabaja.
- Bot Mode visual de Desktop no implica esas vistas en Web Dashboard. Los Bots son los mismos perfiles persistentes; usar SDK Web para la interfaz.
- La descomposición nativa puede ver perfiles ajenos al catálogo: revisar asignaciones antes de autorizar ejecución. No afirmar allowlist fuerte si no existe enforcement.
- Poner una regla en SOUL.md no es enforcement de presupuesto, RBAC ni sandbox. Señalar la diferencia en cada informe.
- Una instrucción de skill para el agente (como la de `request-review` con `reviewer` de arriba) no es el enforcement externo que RG-09 exige para la autorrevisión — es prosa, más barata y más frágil. `scripts/agentes/vigilar-autorrevision.py` fue el intento de construir ese enforcement y quedó excluido por contención/desbloqueo sin resolver (sigue en `main`, sin instalar ni acreditar); RG-09 sigue sin acreditarse. No presentar la instrucción de skill como si cerrara el requerimiento.

## Verificación
Cada entrega incluye ID de proyecto/tablero/tarea/perfil/modelo/sesión cuando exista, resultados de pruebas y evidencias reales. No cerrar por relato del agente. Una tarjeta bloqueada no es una entrega completada. Probar recuperación en ejecución aislada antes de habilitar automatización extensa.
