#!/usr/bin/env python3
"""Vigilante externo para el único hueco real que nos interesa resolver, no
para replicar el sistema de límites de Hermes desde fuera.

Confirmado leyendo su propio código (no supuesto): una tarea hija creada por
el auto-decomposer nunca hereda `max_runtime_seconds` ni `max_retries` de su
padre (`_insert_decomposed_child` en `hermes_cli/kanban_db_graph.py` -- el
`INSERT INTO tasks` omite esas dos columnas, línea 200). El asesino de tareas
por tiempo del propio despachador ni siquiera la evalúa: su consulta, en
`kanban_db_dispatch.py:726`, lleva `WHERE ... max_runtime_seconds IS NOT
NULL`. No es un plazo generoso -- es ningún plazo.

No se puede arreglar desde un hook (los eventos de ciclo de vida del kanban
son observadores, no pueden bloquear ni modificar) ni desde la CLI de tareas
ya creadas (`kanban edit` no toca max_runtime/max_retries). El arreglo de
raíz exige parchear el motor instalado de Hermes -- software de terceros
(Nous Research, MIT), y José decidió explícitamente no modificarlo. Reportado
río arriba por separado (ver docs/incidentes/).

Este script NO corrige la causa -- una hija sigue naciendo sin reloj. Pone un
techo desde fuera: cualquier tarea `running` sin `max_runtime_seconds` que
lleve más de `--runtime-ceiling-seconds` corriendo se para con `hermes kanban
reclaim`, que SÍ termina el proceso real del worker (confirmado leyendo
`reclaim_task`/`_terminate_reclaimed_worker`), no solo libera el candado en
la base de datos. Nunca escribe en la base de datos directamente.

Deliberadamente NO vigila `kanban.max_in_progress` (el tope de flota).
Replicar el sistema de límites de Hermes desde fuera no era el encargo --
el problema real a resolver es que una tarea que se desboca se pare sola, y
eso es justo lo que hace esto, con una sola comprobación.

Limitación honesta, la misma de vigilar-tarjetas.py: es una foto entre dos
chequeos. Una tarea que empieza y termina su daño dentro de una sola ventana
de sondeo no se atrapa a tiempo. Y `reclaim` devuelve la tarea a `ready`, no
a un estado terminal -- una hija sin reloj puede volver a correr y esto la
para de nuevo cada ventana, no de una vez por todas.

Uso:
    python3 scripts/agentes/vigilar-limites.py <kanban.db> <board> --profile arkysupabase [--dry-run] [--cron]

Código de salida: 0 si no hubo que parar nada; 1 si se detuvo alguna tarea.
"""
import argparse
import json
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


def check_runtime(con: sqlite3.Connection, profile: str, board: str, ceiling_seconds: int, dry_run: bool) -> list[dict]:
    """Para (reclaim real) cualquier tarea 'running' sin max_runtime_seconds que
    lleve corriendo más del techo. Devuelve lo que paró (o pararía, en dry_run)."""
    now = time.time()
    rows = con.execute(
        "SELECT id, assignee, worker_started_at, title FROM tasks "
        "WHERE status='running' AND max_runtime_seconds IS NULL AND worker_started_at IS NOT NULL",
    ).fetchall()
    hits = []
    for row in rows:
        elapsed = now - row["worker_started_at"]
        if elapsed < ceiling_seconds:
            continue
        entry = {"id": row["id"], "assignee": row["assignee"], "elapsed_seconds": int(elapsed), "title": row["title"]}
        hits.append(entry)
        if dry_run:
            continue
        reason = (
            f"vigilar-limites: sin max_runtime_seconds (hueco conocido del auto-decomposer), "
            f"corriendo {int(elapsed)}s, techo de seguridad {ceiling_seconds}s. Detenida externamente."
        )
        subprocess.run(
            ["hermes", "-p", profile, "kanban", "--board", board, "reclaim", row["id"], "--reason", reason],
            check=False,
        )
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
        runtime_hits = check_runtime(con, args.profile, args.board, args.runtime_ceiling_seconds, args.dry_run)
    except Exception as exc:  # un vigilante que se traga su propio fallo es peor que ninguno
        write_heartbeat(args.board, 0, error=f"{type(exc).__name__}: {exc}")
        print(f"VIGILAR-LIMITES: fallo al comprobar {args.board}: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise

    write_heartbeat(args.board, len(runtime_hits))

    if args.cron and not runtime_hits:
        return 0

    if not args.cron:
        print(f"== vigilar-limites: {args.board} ({args.db}) ==")
        if not runtime_hits:
            print("sin tareas corriendo sin reloj por encima del techo")

    for hit in runtime_hits:
        action = "se habría detenido" if args.dry_run else "detenida"
        print(f"ALERTA_RUNTIME: {hit['id']} ({hit['assignee']}) {action} tras {hit['elapsed_seconds']}s "
              f"sin max_runtime_seconds -- \"{hit['title']}\"")

    return 1 if runtime_hits else 0


if __name__ == "__main__":
    raise SystemExit(main())
