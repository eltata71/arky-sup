# Vigilante externo de límites — detección, no contención

El crontab de sistema instalado ejecuta cada dos minutos el wrapper
`~/.hermes/profiles/arkysupabase/scripts/vigilar-limites.sh`. Este apunta al
script del checkout principal con `--runtime-ceiling-seconds 300 --dry-run
--cron`, usando el Python de `hermes-agent-v0.22.2`. Fusionar este cambio sí
cambia el código que ejecutará ese cron cuando el checkout se actualice.
Esta corrección no instala, reactiva ni modifica el cron o su wrapper;
configuración instalada no acredita por sí sola actividad reciente ni contención.

## Alcance entregado

El motor auditado admite `max_runtime_seconds=NULL` y excluye esas tareas de
su evaluación de timeout. Este script no corrige la admisión nativa ni garantiza
que una tarea nazca con reloj. **Se excluye toda intervención reactiva
automática**, tanto para implementación como para ejecuciones originadas en
`review`, desde la primera detección y con independencia del historial.

1. **Detección reactiva, primero:** `check_runtime` solo lee las tareas
   `running` aún sin límite. Mide desde
   `COALESCE(task_runs.started_at, tasks.started_at)`; `worker_started_at` es
   identidad de proceso, NO reloj. Detecta desde el techo inclusive. Nunca
   llama a `reclaim`, `block`, otra CLI ni señales a procesos; no modifica la DB.
   En `--dry-run` devuelve detecciones, nunca acciones aplicadas o escaladas.
   En modo mutante, una vencida provoca fallo explícito con ids y tiempos,
   solicitando **recuperación manual con dispatcher detenido y verificado**.
   No se parchea después de ese fallo para no esconder el vencimiento.
2. **Mitigación proactiva histórica:** si la comprobación anterior no falla,
   busca tareas `ready`, `todo` o `running` sin límite y les asigna 600 segundos
   por defecto. Escribe directamente UNA columna de UNA fila con condición
   `IS NULL` y estado comprobado de nuevo; después registra un comentario CLI.
   Esta es la excepción histórica acotada del encabezado del script, no una
   autorización general para escribir DB ni para ejecutar contra producción.
   Si el UPDATE no aplica por cambio concurrente, esa entrada no se devuelve,
   no se comenta ni cuenta en salida/heartbeat como escritura. En dry-run se
   conserva la detección sin aplicar cambios.

El techo externo de 600 segundos NO es la admisión de 300 segundos exigida por
el flujo compartido. Puede pasarse explícitamente por CLI; aquí no se cambia
configuración alguna. Las tareas parcheadas dependen del dispatcher nativo
para aplicar el límite. Esta dependencia no acredita terminación.

3. **Desajustes, solo detección:** `patch_mismatched_runtime_ceiling` conserva
   su nombre por compatibilidad, pero no escribe ni llama a CLI en ningún modo.
   Reporta `DOS_VERDADES` si el límite de tarjeta es menor que el presupuesto
   del perfil; requiere decisión humana. No hay aprobación explícita para
   sobrescribir no-NULL y la excepción histórica no lo permite. La foto se
   toma antes del parche NULL: dry-run y mutante predicen el mismo techo
   configurado y el mutante deja una sola escritura y comentario por NULL.
   `run_budget_seconds` es blando (aviso al 80% y tope de timeouts obsoletos),
   no un kill duro; no se puede concluir que el perfil «ganó» como techo duro
   en `t_8c2134ab`. Ver `t_dc22118e`.
4. **Degradación visible:** PyYAML se importa solo al leer un perfil existente.
   Sin esa dependencia, o ante config ilegible/no UTF-8/YAML inválido, se
   deshabilita solo la comprobación del perfil afectado: `ERROR_CONCILIACION`
   en stderr, `error` en heartbeat y rc=1. Se conservan `RELOJ_FALTANTE`,
   detección reactiva y el resto del lote. No se instalan dependencias en el
   Python operacional. Los números se normalizan como Hermes (float y string
   positivos admitidos, bool rechazado).

## Por qué no se entrega recuperación automática

La revisión Alexis de `8854e09e0d6c9960c4b06acde7a1a686692b6aed` identificó:

- `reclaim` puede devolver una implementación a `ready`, habilitando un nuevo
  despacho antes de `block`. Este último puede limpiar la identidad del worker
  nuevo sin terminarlo. El orden de ambas CLI no garantiza contención.
- Para un intento originado en `review`, `reclaim` puede restaurar `review`,
  donde `block` no es válido. La secuencia puede fallar y dejarla elegible.

No hay una exclusión efectiva compartida con el dispatcher en este alcance.
No se añaden mutex locales, bloqueos caseros, cambios al motor ni un flag
booleano que finja acreditar su detención. El vigilante **no detiene ni verifica
el dispatcher**: la recuperación queda a cargo del operador, fuera de este
script, con evidencia real de detención y ausencia de redespacho durante toda
la operación. Una relectura de la tarjeta tampoco acredita esa exclusión.

## Fallos y garantías limitadas

- Relojes ausentes, ilegibles, no finitos o fuera de rango provocan error. Se
  recorre el lote completo antes de fallar y el diagnóstico incluye también
  las otras tareas vencidas, sin intervenir sobre ninguna. Esto se aplica en
  dry-run y modo mutante; no se anuncia vigilancia exitosa.
- El comentario proactivo exige éxito CLI y tiene timeout de 30 segundos.
  UPDATE y comentario NO son atómicos: un fallo de comentario deja el límite
  cambiado sin comentario confirmado y aborta el lote. No se repara esa
  auditoría automáticamente ni se devuelve éxito.
- `main` detecta antes del parche, pero no es una transacción compartida con
  el dispatcher: nuevas tareas, cambios de estado y vencimientos posteriores
  a la lectura pueden escapar. No se ofrece contención ni exposición máxima
  de 10–12 minutos. Cron configurado no equivale a cron activo.
- `--dry-run` abre la DB en lectura, no llama a CLI ni parchea tareas, pero
  `main` SÍ escribe heartbeat local, también ante errores. Para auditoría sin
  escrituras usar las funciones con conexión de solo lectura, no `main`.
- En error, el heartbeat conserva el diagnóstico en `error`; su contador
  `runtime_hits=0` no significa ausencia de vencidas. En éxito cuenta detecciones
  dry-run o escrituras proactivas realmente aplicadas, nunca terminaciones.
- No se promete cobertura global, fábrica completa, hooks/snapshots ni aptitud
  operacional. RG-09 sigue pendiente y autorrevisión continúa fuera del alcance.

## Uso sujeto a revisión y aprobación

```sh
python3 scripts/agentes/vigilar-limites.py <kanban.db> <tablero> --profile <perfil> --dry-run
```

No ejecutar contra DB operacional ni instalar sin los gates y aprobación.
`--cron` solo controla el silencio, no programa cron ni oculta errores.
Resultado 0: sin detecciones ni escrituras aplicadas; 1: detecciones dry-run o
parches aplicados o error parcial de conciliación; excepciones: error, incluida cualquier vencida en modo
mutante. Ningún resultado significa «worker detenido».

## Pruebas locales y evidencia histórica

```sh
python3 -B -m unittest discover -s scripts/agentes/tests -v
python3 -m py_compile scripts/agentes/vigilar-limites.py scripts/agentes/tests/test_vigilar_limites.py
git diff --check
```

Para `py_compile`, dirigir `PYTHONPYCACHEPREFIX` fuera del repositorio.
Las pruebas usan SQLite en memoria/archivos temporales y CLI sustituida:
reloj por intento, fallback legado, umbral, relojes inválidos y multitarea,
detección de origen review, inalcanzabilidad del intercalado reclaim/redespacho/
block porque no se invoca ninguna CLI reactiva, dry-run, heartbeat temporal,
auditoría proactiva e interferencia con UPDATE no aplicado.

**No son pruebas de terminación de procesos.** Las pruebas operacionales y de
terminación previas validaban la versión anterior y su recorrido secuencial;
no validan esta nueva versión ni resuelven concurrencia. El SHA anterior se
conserva como historial, no como aprobación trasladable. Este rework requiere
nueva revisión 16b y quality final antes de cualquier publicación; tampoco
autorizan por sí solos instalación o protección operacional completa.
