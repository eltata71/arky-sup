# safe-specify

## Qué problema resuelve

`hermes kanban specify <task_id>` es el único comando nativo que saca una
tarjeta de `triage`, pero llama a un LLM auxiliar (`auxiliary.triage_specifier`)
que puede **reescribir** título y cuerpo — no solo completarlos — y en el
proceso omitir restricciones explícitas que la tarjeta ya tenía (instrucción
de emitir NO-GO, "no producción", "no servicios externos", "no otros
proyectos"...). Ocurre también de forma automática: con `kanban.auto_decompose`
activo (el valor por defecto), el despachador cae en el mismo mecanismo como
*fallback* para tareas que no necesitan descomponerse en hijos, sin que nadie
lo dispare a mano. Ver la tarjeta `t_4dec3959` en el tablero `arky-maintenance`
para el defecto completo, cómo se detectó y el análisis del disparo automático.

## Qué hace

Respalda título/cuerpo/assignee/estado antes de tocar nada, ejecuta `specify`,
restaura el título y el cuerpo originales con `hermes kanban edit`, y verifica
**byte a byte** que lo restaurado es idéntico al respaldo. Si la verificación
no cuadra, sale con código distinto de cero y no reintenta solo — quien lo
invoque debe pararse ahí y escalarlo. El único cambio que deja es el que de
verdad se busca: sacar la tarjeta de `triage` (pasa a `ready`/`todo`/`blocked`
según sus dependencias).

Deja un respaldo permanente de cada uso (antes y después) en
`safe-specify-backups/` y una línea en `safe-specify.log` — ninguno de los dos
se versiona (ver `.gitignore` en este directorio); son evidencia de ejecución,
no código.

## Uso

```bash
scripts/agentes/safe-specify.sh <kanban.db> <board-slug> <task_id> [perfil]
```

Ejemplo:

```bash
scripts/agentes/safe-specify.sh \
  /home/tata/workspace/latam-factory-e2e/kanban.db \
  latam-factory-e2e t_b065b9c4 jose
```

Requiere `hermes` en el PATH y `python3`. Solo falla si la tarea no está en
`triage`, si `hermes kanban specify`/`edit` fallan, o si la verificación byte a
byte no coincide — en los tres casos no toca nada más y lo dice con claridad.

## Qué no hace

No es una solución al defecto en sí: `specify` sigue pudiendo reescribir el
cuerpo cada vez que se llama, dentro o fuera de este script. Es una red de
seguridad alrededor de un comando que no se puede evitar todavía — no un
arreglo del propio `triage_specifier`. Tampoco detecta reescrituras que
ocurran *sin* pasar por este script (por ejemplo, el disparo automático del
despachador vía `auto_decompose`); para eso hace falta un chequeo aparte que
compare huellas del cuerpo contra la bitácora de eventos nativa.
