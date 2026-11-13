# PR #322 — texto propuesto para sustituir la descripción

Este fichero es una propuesta local; no acredita una actualización en GitHub.

## Qué hace

`cron_job_failure_streaks()` en `scripts/agentes/estado-fabrica.py` lee los
registros `cron/jobs.json` de los perfiles nombrados y del perfil raíz.
Acepta tanto una lista como un objeto con `jobs`. Con tres o más salidas
fallidas consecutivas de un job ejecutable emite una razón crítica. Un registro
ilegible, JSON inválido o estructura inesperada genera una razón crítica
separada, sin ocultar los hallazgos de los demás perfiles.

La puerta de actividad replica `is_job_runnable` de Hermes v0.22.2:
`enabled` ausente equivale a verdadero; `state` igual a `paused` (sin espacios
exteriores) o `paused_at` no vacío impide contar el job. El script
`estado-fabrica.py` se excluye por su nombre de fichero, independientemente del
nombre del job, para evitar que sus propios avisos sostengan una alarma circular.

## Por qué (contexto del 11-nov y corrección de diagnóstico)

`kanban-dispatch` fallaba con `SyntaxError` al compilar como Python un wrapper
bash. Eso justificaba vigilar la racha, pero no la comparación original con
«808 fallos en silencio» de `estado-fabrica-watch`.

Según la evidencia de Rafael en t_56c1ab09, de las 50 salidas retenidas que revisó,
48 eran `ATENCION` (exit 1 por diseño) y una mostraba un fallo real puntual
`ModuleNotFoundError: yaml`. Esas salidas no son 808 ejecuciones rotas por el
mismo defecto. `failure_streak` contabiliza cualquier salida sin éxito, no
distingue avisos deliberados de errores de ejecución. Se retira expresamente
la afirmación anterior; el historial original no se reescribe.

## Límites

Otros detectores con exit distinto de cero por diseño todavía pueden producir
falsos positivos. El chequeo no cubre jobs del crontab del sistema ni un job
activo que deje de dispararse sin que crezca su racha. Ambos límites figuran
en `not_covered`. No se modifica el motor ni la configuración de cron.

## Verificación reproducible

- `/usr/bin/python3 -m unittest discover -s scripts/agentes/tests -p test_estado_fabrica.py -v`
- `/usr/bin/python3 -m unittest discover -s scripts/agentes/tests -v`
- `npm run quality:gate`
- `npm run test:coverage` (invocación separada, nunca concurrente con el build).

Las regresiones incluyen: roto, sano, umbral, deshabilitado, ambas puertas de
pausa, clave `enabled` ausente, formato lista, JSON corrupto, forma inesperada,
error de lectura, UTF-8 inválido, autoexclusión, raíz sin perfiles nombrados,
racha inválida, error no textual y primera línea no vacía. Un test de `main()`
con el resto de sondas aisladas comprueba razón crítica, JSON persistido y
retornos 0/1 sin tocar el fichero de resultados real.

La sonda de solo lectura sobre `cron_job_failure_streaks()` en el host devolvió
`[]` durante esta corrección. No se ejecutó `main()` contra el entorno real.
Los resultados finales de los gates están en la evidencia de t_beeec302;
esta lista de comandos no sustituye sus resultados.
