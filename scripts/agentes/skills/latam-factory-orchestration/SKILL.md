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

## Cuándo utilizar
Al recibir o ejecutar trabajo del tablero `latam-factory`. No cambia reglas de proyectos o tableros ajenos ni sustituye controles obligatorios de seguridad.

## Requisitos
Perfiles nativos del catálogo `agents/catalog.json`, herramientas `kanban_*` confirmadas en la versión instalada, modelo accesible y workspace autorizado. Leer la tarjeta y el contexto de repositorio antes de actuar. La ausencia de credenciales bloquea la ejecución, no autoriza inventar resultados.

## Procedimiento
1. Recibir la solicitud y **clasificarla antes de crear ninguna tarjeta**: José decide `complejidad` (1–5, decide la capacidad de modelo) y `ruta` (`corta` o `completa`, decide qué etapas del flujo se recorren). Correspondencia: 1–2 → corta; 3 → corta salvo que toque contratos, datos o arquitectura; 4–5 → completa. Seguridad, despliegue o liberación añaden sus etapas en cualquier ruta. La **etapa 16 está en las dos rutas** con sus dos componentes (16a especializada: Camilo y Ignacio; 16b independiente del SHA final: Rafael o Alexis), y no se cierra sin las dos. Sin los dos atributos decididos, no hay tarjeta todavía — este paso es la admisión, no un trámite posterior a ella.
2. Registrar la solicitud ya clasificada en Kanban nativo con idempotency-key, objetivo, requerimientos, aceptación verificable, riesgo, fase SDLC, presupuesto, y `complejidad`/`ruta` del paso 1 escritos en el cuerpo. Utilizar IDs nativos como autoridad; proyecto no es perfil. Usar operaciones locales para transformaciones deterministas; `execute_code` para lotes mecánicos; `delegate_task` solo para razonamiento breve. Todo trabajo durable, con aprobación o interperfil permanece en Kanban.
3. Planificar **construyendo el grafo tarea por tarea**, con `hermes kanban create --parent <id-raíz> --max-runtime <segundos> --assignee <perfil>` por cada hija (y `kanban link` para dependencias que no sean de la raíz). No fan-out trivial. Asignar cada tarjeta a un especialista del catálogo; no hacer todo como José. Vincular dependencias, aceptación y revisión independiente.
   **No usar `hermes kanban decompose`** para planificar, aunque sea tentador por ser un solo comando: comparte el mismo insertador que una hija auto-descompuesta (`_insert_decomposed_child` en `kanban_db_graph.py`) y **nunca copia `max_runtime_seconds` ni `max_retries`**, se invoque a mano o automáticamente — el agujero del reloj no es de la automatización, es del propio comando. Confirmado leyendo su código, no suponiéndolo (auditoría 2026-10-26). Construir el grafo con `create --parent` es más lento que un solo comando, y es la diferencia entre una hija con límite de tiempo desde que nace y una que lo recibe media hora después, parcheada desde fuera por un vigilante.
4. Resolver modelo/proveedor en Hermes. Elegir por costo solo cuando existan evaluaciones reales y precio/alcance/vigencia conocidos. El costo estimado no es facturado; desconocido no es cero. Sin datos suficientes solicitar aprobación de un pin explícito, nunca fabricar benchmarks. El router complementario no controla por sí mismo todos los procesos Hermes.
5. Respetar máximo global de 3 y uno por perfil en este flujo, 20 turnos por nuevo perfil, 300 segundos por ejecución y una tentativa de ejecución inicial. Usar límites nativos y no iniciar Dispatchers/Cron adicionales. El gateway operacional es el único Dispatcher automático. Fallo de cuota/autenticación bloquea y requiere intervención; no reintentar en bucle.
6. Antes de modificar código, exigir repositorio autorizado y worktree por escritor; un solo propietario por archivo. Si hay conflicto, serializar con dependencia. Un worktree o toolset no es un sandbox ni impide acceso a secretos del host. No atribuir aislamiento sin evidencia.
7. Ejecutar pruebas RED/GREEN, lint/type-check/build y verificaciones aplicables. Registrar comandos, exit codes, SHA, archivos y evidencias adjuntas a la tarjeta. Indicar gates no disponibles y por qué. No usar simulaciones como prueba de inferencia real.
8. Mantener heartbeat y comentarios para trabajo prolongado. Respetar estados nativos, bloqueo con motivo, reintento acotado, recuperación nativa y referencias a sesión/ejecución. No almacenar un estado alternativo en metadatos.
9. Enviar implementación a revisión de Paola y Julián cuando corresponda; el implementador no aprueba su propio trabajo crítico. Producción, merge/publicación remota, migración destructiva, rollback, excepción de seguridad o aumento de presupuesto requieren aprobación humana explícita y evidencia inmutable del alcance aprobado. Una instrucción de personalidad nunca concede permiso.
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
turno antes de que Natalia, la autora asignada, pudiera reclamar la tarjeta.
No rompió la cadena — Natalia igual hizo su propio trabajo real bajo
despacho normal, con su propio proceso y su propia evidencia — pero fue un
atajo que no debía tomar.

**Regla**: José asigna y supervisa; no hace el trabajo de la tarjeta que
acaba de crear, aunque crea que sería más rápido. Si de verdad es más rápido
que lo haga él, esa es la señal de que la tarea nunca necesitó delegarse —
y lo correcto entonces es no crear la tarjeta, no crearla y adelantarse al
especialista.

**Lo que se reconoce de ese mismo incidente, porque también importa**: José
lo declaró él mismo, sin que nadie preguntara, y calificó su propio
procedimiento como incompleto por ese motivo exacto. Esa honestidad es
justo lo que este documento quiere reforzar — un coordinador que admite su
propio atajo sin que se lo descubran es más valioso que uno que nunca se
equivoca pero tampoco lo diría. La regla de arriba corrige el atajo; esto no
lo corrige, lo sostiene.

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
  ahí hasta que alguien (José) la clasifique y la planifique — es la etapa 1
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

## Verificación
Cada entrega incluye ID de proyecto/tablero/tarea/perfil/modelo/sesión cuando exista, resultados de pruebas y evidencias reales. No cerrar por relato del agente. Una tarjeta bloqueada no es una entrega completada. Probar recuperación en ejecución aislada antes de habilitar automatización extensa.
