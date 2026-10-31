# Vigilante externo de límites — candidato no instalado

Este documento describe el código de esta rama, no acredita su instalación,
actividad de cron ni protección operacional. La auditoría del 31 de octubre de
2026 no pudo acreditar ejecución reciente del cron existente. No se instala ni
reactiva como parte de esta preparación local.

## Alcance y dos capas

El motor auditado admite `max_runtime_seconds=NULL` y excluye esas tareas de
su evaluación de timeout. Este script es una mitigación externa; no corrige la
admisión nativa ni garantiza que una tarea nazca con reloj.

1. **Proactiva:** busca tareas `ready`, `todo` o `running` sin límite y les
   asigna 600 segundos por defecto. Escribe directamente UNA columna de UNA
   fila con condición `IS NULL` y estado comprobado de nuevo; después registra
   un comentario mediante CLI. Esta es la excepción histórica acotada que se
   documenta al principio del script, no una autorización general para escribir
   bases de datos ni permiso para ejecutar esta candidata contra producción.
2. **Reactiva:** para tareas `running` aún sin límite, mide desde
   `COALESCE(task_runs.started_at, tasks.started_at)`. `worker_started_at` es
   identidad de proceso, NO reloj. Al superar el techo llama a `reclaim`; desde
   la segunda intervención registrada, llama después a `block --kind needs_input`.

El techo externo de 600 segundos NO es la admisión de 300 segundos exigida por
el flujo compartido. El valor se puede pasar explícitamente por CLI. Ninguna
configuración se cambia aquí. La proactiva normalmente retira de la selección
reactiva las tareas que acaba de parchear: entonces depende del dispatcher
nativo para aplicar el límite.

## Fallos y garantías limitadas

- Relojes ausentes, ilegibles, no finitos o fuera de rango no autorizan reclaim
  de esa tarea. Se sigue con las demás y se informa error global al terminar.
- CLI tiene timeout de 30 segundos y exige éxito. Un reclaim fallido no continúa
  a block. Un error CLI puede abortar el resto del lote.
- UPDATE y comentario NO son atómicos. Un fallo de comentario deja el runtime
  cambiado sin comentario confirmado; se informa error, pero no se repara esa
  auditoría automáticamente.
- No se promete exposición máxima de 10–12 minutos: depende de sondeo realmente
  activo, disponibilidad del host/CLI, reloj y dispatcher. El cron configurado
  no demuestra ejecución. Las tareas que terminan entre sondeos pueden escapar.
- `--dry-run` abre la DB en modo lectura y no llama a CLI ni parchea tareas,
  pero `main` SÍ escribe un heartbeat local, incluso en ese modo. Para auditoría
  estrictamente sin escrituras usar las funciones con conexión de solo lectura,
  no ejecutar `main`.
- La identidad y terminación del proceso se delegan a la CLI nativa; las pruebas
  con CLI sustituida NO demuestran que un worker real haya sido detenido.

## Uso previsto después de aprobación e instalación

```sh
python3 scripts/agentes/vigilar-limites.py <kanban.db> <tablero> --profile <perfil> --dry-run
```

No ejecutar en modo mutante contra un tablero operacional sin aprobación y
verificación de alcance. `--cron` solo controla silencio de salida; no programa
un cron. Resultado 0: sin hallazgos; 1: hallazgos/intervenciones (también en
simulación); excepciones: error, no éxito de vigilancia.

## Pruebas locales

```sh
python3 -m unittest discover -s scripts/agentes/tests -v
```

SQLite en memoria y CLI sustituida: reloj por intento, fallback legado,
reintentos, relojes inválidos sin bloquear otras tarjetas, simulación sin
mutaciones, límites de estado, auditoría proactiva, fallo de reclaim y escalada.
Antes de instalar falta prueba operacional aislada, revisión y aprobación.
