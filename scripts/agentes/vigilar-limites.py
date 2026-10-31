#!/usr/bin/env python3
"""Vigilante externo para el único hueco real que nos interesa resolver, no
para replicar el sistema de límites de Hermes desde fuera.

ÚNICA EXCEPCIÓN PERMITIDA A "NUNCA ESCRIBIR EN LA BASE DE DATOS DIRECTAMENTE"
==============================================================================
Esta regla gobierna TODOS los vigilantes externos de esta fábrica (este
script, estado-fabrica.py, y cualquiera que se añada después). Es una
excepción, no un precedente: no autoriza ninguna otra escritura directa,
sobre ningún otro campo, por ningún otro motivo. Decidida el 2026-10-25,
aprobada por José. Solo aplica cuando se cumplen las TRES condiciones a la
vez:

  1. El campo no tiene NINGUNA vía soportada para fijarse después de crear
     la tarea (confirmado leyendo el código y probando `hermes kanban edit`
     en vivo -- no basta con "no conozco una", hay que haberla buscado).
  2. La escritura es de UNA sola columna, en UNA sola fila, con una condición
     `WHERE` que repite la comprobación que detectó el hueco (aquí:
     `max_runtime_seconds IS NULL AND status IN (...)`) -- así nunca puede
     pisar un valor que otra cosa haya puesto entre la lectura y la
     escritura.
  3. La escritura deja un rastro AUDITABLE en la propia tarjeta, por una vía
     soportada (`hermes kanban comment`), diciendo qué se hizo, cuándo y por
     qué -- nunca solo en un log externo que nadie que mire la tarjeta vería.

Cualquier escritura que no cumpla las tres a la vez debe hacerse por la CLI
de Hermes (`hermes kanban ...`), aunque sea más lenta o menos cómoda. Si
hace falta escribir algo que no cumple las tres condiciones, el camino es
pedir la función que falta río arriba, no ampliar esta excepción.
==============================================================================

Confirmado leyendo su propio código (no supuesto): una tarea hija creada por
el auto-decomposer nunca hereda `max_runtime_seconds` ni `max_retries` de su
padre (`_insert_decomposed_child` en `hermes_cli/kanban_db_graph.py` -- el
`INSERT INTO tasks` omite esas dos columnas, línea 200). El asesino de tareas
por tiempo del propio despachador ni siquiera la evalúa: su consulta, en
`kanban_db_dispatch.py:726`, lleva `WHERE ... max_runtime_seconds IS NOT
NULL`. No es un plazo generoso -- es ningún plazo.

No se puede arreglar desde un hook (los eventos de ciclo de vida del kanban
son observadores, no pueden bloquear ni modificar) ni desde la CLI de tareas
ya creadas (`kanban edit` no toca max_runtime/max_retries -- comprobado de
nuevo el 2026-10-25, sigue sin esa opción). El arreglo de raíz exige parchear
el motor instalado de Hermes -- software de terceros (Nous Research, MIT), y
José decidió explícitamente no modificarlo. Reportado río arriba por separado
(ver docs/incidentes/).

Este script NO corrige la causa -- una hija sigue naciendo sin reloj, venga
de quien venga (el auto-decompositor, un `kanban_create` manual, o un agente
creando una tarjeta hija desde dentro de una revisión -- las tres vías se han
visto producir el mismo hueco). Pone un techo desde fuera, en dos capas:

1. **Proactiva** (`patch_missing_runtime_ceiling`): cualquier tarea no
   terminal (`ready`/`todo`/`running`) sin `max_runtime_seconds` recibe el
   mismo techo de seguridad por una escritura directa, mínima y auditada --
   una sola columna, con `WHERE max_runtime_seconds IS NULL AND status IN
   (...)` para no pisar nunca un valor ya puesto por nadie, seguida de un
   comentario en la propia tarjeta (por la vía soportada, `hermes kanban
   comment`) que dice qué se hizo, cuándo y por qué. No hay otra vía: no
   existe un `hermes kanban set-runtime`. Es la única excepción deliberada a
   "nunca escribir en la base de datos directamente" en todo este conjunto de
   vigilantes, y está acotada a propósito a un campo que no tiene otro
   escritor posible. En cuanto el campo queda puesto, el propio asesino de
   tareas del despachador (que sí respeta `max_runtime_seconds IS NOT NULL`)
   se hace cargo solo -- esta capa no vigila el tiempo, solo le da al motor
   algo que vigilar.
2. **Reactiva** (`check_runtime`, la que ya existía): red de seguridad para
   lo que la capa 1 no alcance a tiempo (una tarea que ya llevaba corriendo
   antes del primer parche, o una ventana de sondeo perdida). Cualquier
   tarea `running` sin `max_runtime_seconds` que lleve más de
   `--runtime-ceiling-seconds` corriendo se para con `hermes kanban reclaim`,
   que SÍ termina el proceso real del worker (confirmado leyendo
   `reclaim_task`/`_terminate_reclaimed_worker`), no solo libera el candado
   en la base de datos. Esta capa sigue sin escribir nunca la base de datos
   directamente -- solo llama a `hermes kanban`.

Deliberadamente NO vigila `kanban.max_in_progress` (el tope de flota).
Replicar el sistema de límites de Hermes desde fuera no era el encargo --
el problema real a resolver es que una tarea que se desboca se pare sola, y
eso es justo lo que hace esto, con una sola comprobación.

Limitación honesta, la misma de vigilar-tarjetas.py: es una foto entre dos
chequeos. Una tarea que empieza y termina su daño dentro de una sola ventana
de sondeo no se atrapa a tiempo.

`reclaim` por sí solo devuelve la tarea a `ready`, no a un estado terminal --
una hija sin reloj podría volver a correr y pararse de nuevo cada ventana,
indefinidamente, consumiendo presupuesto igual que si nunca se hubiera
parado. Por eso la SEGUNDA vez que este script interviene sobre la MISMA
tarea (contado por su propia firma en `task_events`, no por el contador de
fallos de Hermes -- `reclaim_task` lo resetea a propósito en cada
intervención manual, "fresh retry budget" para un worker que de verdad se
cayó), no la reclama otra vez: la reclama (eso sigue haciendo falta para
matar el proceso real) y a continuación la bloquea con `kind=needs_input`,
que no se autopromueve -- quiere un humano. Confirmado leyendo el código que
`block` por sí solo, sin `reclaim` antes, NO mata el proceso real -- solo
limpia la fila y deja el worker real huérfano y corriendo sin que nada lo
siga; por eso siempre va reclaim primero.

Uso:
    python3 scripts/agentes/vigilar-limites.py <kanban.db> <board> --profile arkysupabase [--dry-run] [--cron]

Código de salida: 0 si no hubo que parar nada; 1 si se detuvo alguna tarea.
"""
import argparse
import json
import math
import subprocess
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_RUNTIME_CEILING_SECONDS = 600  # 10 min: techo de seguridad, no un plazo "razonable" calculado

HEARTBEAT = Path(__file__).resolve().parent / "vigilar-limites.heartbeat.json"


def write_heartbeat(board: str, runtime_hits: int, error: str = None) -> None:
    payload = {
        "last_run_at": datetime.now(timezone.utc).isoformat(),
        "board": board,
        "runtime_hits": runtime_hits,
        "error": error,
    }
    try:
        HEARTBEAT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


MARKER = "vigilar-limites:"  # firma estable para contar nuestras propias intervenciones previas


def _prior_interventions(con: sqlite3.Connection, task_id: str) -> int:
    """Cuántas veces este script ya actuó sobre esta tarea (reclaim o block),
    buscando nuestra propia firma en el payload de task_events. `reclaim_task`
    resetea el contador de fallos de Hermes en cada intervención manual (es
    "fresh retry budget" a propósito, para un worker que de verdad se cayó) --
    así que sin este conteo propio, una hija sin reloj se reclamaría cada
    ventana indefinidamente y Hermes nunca lo vería como un bucle."""
    rows = con.execute(
        "SELECT count(*) FROM task_events WHERE task_id=? AND kind='reclaimed' AND payload LIKE ?",
        (task_id, f"%{MARKER}%"),
    ).fetchone()
    return rows[0] if rows else 0


def patch_missing_runtime_ceiling(
    con: sqlite3.Connection, profile: str, board: str, ceiling_seconds: int, dry_run: bool,
) -> list[dict]:
    """Capa proactiva -- ejerce la ÚNICA EXCEPCIÓN PERMITIDA a "nunca escribir
    en la base de datos directamente" (ver el bloque con ese nombre al
    principio de este fichero; sus tres condiciones son obligatorias y esta
    función las implementa, no las reinterpreta). Una sola columna
    (`max_runtime_seconds`), con `WHERE ... IS NULL` repetido en la propia
    escritura (idempotente: no puede pisar un valor puesto por otra vía entre
    la lectura y la escritura), y un comentario en la propia tarjeta por la
    vía soportada (`hermes kanban comment`) que dice qué se hizo y por qué.
    No copiar este patrón para ningún otro campo sin releer esas tres
    condiciones primero."""
    rows = con.execute(
        "SELECT id, assignee, status, title FROM tasks "
        "WHERE max_runtime_seconds IS NULL AND status IN ('ready','todo','running')",
    ).fetchall()
    patched = []
    for row in rows:
        entry = {"id": row["id"], "assignee": row["assignee"], "status": row["status"], "title": row["title"]}
        patched.append(entry)
        if dry_run:
            continue
        cur = con.execute(
            "UPDATE tasks SET max_runtime_seconds = ? "
            "WHERE id = ? AND max_runtime_seconds IS NULL AND status IN ('ready','todo','running')",
            (ceiling_seconds, row["id"]),
        )
        con.commit()
        entry["applied"] = cur.rowcount > 0
        if not entry["applied"]:
            continue  # otra cosa la cambió entre la lectura y la escritura -- no hay nada que comentar
        comment = (
            f"{MARKER} esta tarea se creó sin max_runtime_seconds (hueco conocido: el motor no "
            f"copia ese campo cuando el auto-decompositor, un kanban_create manual, o un agente "
            f"creando una tarjeta hija lo omiten). Se fijó un techo de seguridad de "
            f"{ceiling_seconds}s por este vigilante externo -- no es el reloj que habría puesto "
            f"el creador original, es el mínimo para que el motor pueda vigilarla él mismo."
        )
        subprocess.run(
            ["hermes", "-p", profile, "kanban", "--board", board, "comment", row["id"], comment],
            check=True,
            timeout=30,
        ).check_returncode()
    return patched


def check_runtime(con: sqlite3.Connection, profile: str, board: str, ceiling_seconds: int, dry_run: bool) -> list[dict]:
    """Para (reclaim real) cualquier tarea 'running' sin max_runtime_seconds que
    lleve corriendo más del techo. A partir de la segunda vez sobre la MISMA
    tarea, no la reclama otra vez -- la bloquea para revisión humana, porque
    reclamar sin fin es cambiar "corre para siempre" por "corre, para, corre
    otra vez, para" indefinidamente, que consume presupuesto igual. Devuelve
    lo que paró/bloqueó (o habría, en dry_run)."""
    now = time.time()
    rows = con.execute(
        "SELECT t.id, t.assignee, t.title, "
        "COALESCE(r.started_at, t.started_at) AS active_started_at FROM tasks t "
        "LEFT JOIN task_runs r ON r.id = t.current_run_id "
        "WHERE t.status='running' AND t.max_runtime_seconds IS NULL",
    ).fetchall()
    hits = []
    clock_errors = []
    for row in rows:
        # worker_started_at es identidad de proceso, NO un reloj. Medir el
        # intento actual igual que el dispatcher nativo, no el primer intento.
        try:
            started_at = float(row["active_started_at"])
        except (TypeError, ValueError):
            clock_errors.append(f"{row['id']}: reloj de ejecución ausente o ilegible")
            continue
        if not math.isfinite(started_at) or started_at <= 0 or started_at > now:
            clock_errors.append(f"{row['id']}: reloj de ejecución fuera de rango")
            continue
        elapsed = now - started_at
        if elapsed < ceiling_seconds:
            continue
        prior = _prior_interventions(con, row["id"])
        escalate = prior >= 1  # ya se reclamó una vez por esto: a la segunda, se bloquea, no se reclama otra vez
        entry = {
            "id": row["id"], "assignee": row["assignee"], "elapsed_seconds": int(elapsed),
            "title": row["title"], "prior_interventions": prior, "escalated": escalate,
        }
        hits.append(entry)
        if dry_run:
            continue
        # SIEMPRE reclaim primero: es lo único que de verdad termina el proceso
        # real del worker (confirmado leyendo block_task -- a diferencia de
        # reclaim_task, NO llama a nada que mate el proceso, solo limpia la
        # fila; llamar a block directo sobre una tarea 'running' habría dejado
        # el worker real huérfano y corriendo, sin que nada lo siguiera).
        reclaim_reason = (
            f"{MARKER} sin max_runtime_seconds (hueco conocido del auto-decomposer), "
            f"corriendo {int(elapsed)}s, techo de seguridad {ceiling_seconds}s. Detenida externamente."
            + (" Ya se detuvo antes por esto; se bloquea a continuación en vez de dejarla reintentar." if escalate else "")
        )
        subprocess.run(
            ["hermes", "-p", profile, "kanban", "--board", board, "reclaim", row["id"], "--reason", reclaim_reason],
            check=True,
            timeout=30,
        ).check_returncode()
        if escalate:
            block_reason = (
                f"{MARKER} ya se detuvo {prior} vez/veces por falta de max_runtime_seconds "
                f"y volvió a correr sin reloj cada vez. Reclamar otra vez solo reinicia el "
                f"ciclo -- se bloquea para revisión humana en vez de dejarla reintentar sola."
            )
            subprocess.run(
                ["hermes", "-p", profile, "kanban", "--board", board, "block", "--kind", "needs_input",
                 row["id"], block_reason],
                check=True,
                timeout=30,
            ).check_returncode()
    if clock_errors:
        # Informar fallo global sin dejar sin protección las demás tarjetas.
        # main registra este error en heartbeat; nunca se presenta como éxito.
        raise ValueError("; ".join(clock_errors))
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("db")
    ap.add_argument("board")
    ap.add_argument("--profile", default="arkysupabase", help="perfil hermes para reclaim (default: arkysupabase)")
    ap.add_argument("--runtime-ceiling-seconds", type=int, default=DEFAULT_RUNTIME_CEILING_SECONDS)
    ap.add_argument("--dry-run", action="store_true", help="detecta pero no llama a reclaim")
    ap.add_argument("--cron", action="store_true", help="silencio si no hay nada que avisar")
    args = ap.parse_args()

    try:
        con = sqlite3.connect(f"file:{args.db}?mode=ro" if args.dry_run else args.db, uri=args.dry_run)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA busy_timeout=5000")
        patched = patch_missing_runtime_ceiling(
            con, args.profile, args.board, args.runtime_ceiling_seconds, args.dry_run,
        )
        runtime_hits = check_runtime(con, args.profile, args.board, args.runtime_ceiling_seconds, args.dry_run)
    except Exception as exc:  # un vigilante que se traga su propio fallo es peor que ninguno
        write_heartbeat(args.board, 0, error=f"{type(exc).__name__}: {exc}")
        print(f"VIGILAR-LIMITES: fallo al comprobar {args.board}: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise

    write_heartbeat(args.board, len(runtime_hits) + len(patched))

    if args.cron and not runtime_hits and not patched:
        return 0

    if not args.cron:
        print(f"== vigilar-limites: {args.board} ({args.db}) ==")
        if not runtime_hits and not patched:
            print("sin tareas corriendo sin reloj por encima del techo, y ninguna sin reloj que parchear")

    for p in patched:
        action = "se le habría puesto" if args.dry_run else "se le puso"
        print(f"RELOJ_FALTANTE: {p['id']} ({p['assignee']}, {p['status']}) {action} techo de "
              f"{args.runtime_ceiling_seconds}s -- \"{p['title']}\"")

    for hit in runtime_hits:
        action = "se habría detenido" if args.dry_run else "detenida"
        print(f"ALERTA_RUNTIME: {hit['id']} ({hit['assignee']}) {action} tras {hit['elapsed_seconds']}s "
              f"sin max_runtime_seconds -- \"{hit['title']}\"")

    return 1 if (runtime_hits or patched) else 0


if __name__ == "__main__":
    raise SystemExit(main())
