#!/usr/bin/env python3
"""Vigilante externo de dos huecos reales del despachador de Hermes, confirmados
leyendo su propio código (no supuestos):

1. Una tarea hija creada por el auto-decomposer nunca hereda `max_runtime_seconds`
   ni `max_retries` de su padre (`_insert_decomposed_child` en
   `hermes_cli/kanban_db_graph.py` -- el INSERT omite esas dos columnas). El
   asesino de tareas por tiempo del propio despachador ni siquiera la evalúa:
   su consulta lleva `WHERE ... max_runtime_seconds IS NOT NULL`. No es un
   plazo generoso -- es ningún plazo.
2. `kanban.max_in_progress` (el tope global de cuántas tareas corren a la vez)
   falla ABIERTO por diseño de Hermes: "non-Linux / read error -> no cap" es
   un comentario literal en `kanban_db_dispatch.py`. Si la lectura de config
   falla, deja de haber tope y nadie se entera salvo por un incidente.

Ninguno de los dos se puede arreglar desde un hook (los eventos de ciclo de
vida del kanban son observadores, no pueden bloquear ni modificar) ni desde la
CLI de tareas ya creadas (`kanban edit` no toca max_runtime/max_retries). El
único arreglo de raíz es parchear el motor instalado de Hermes -- que es
software de terceros (Nous Research, MIT, github.com/NousResearch/hermes-agent),
no de Jose, así que esa decisión se escala en vez de tomarla aquí.

Este script NO corrige la causa -- una hija sigue naciendo sin reloj. Pone un
techo desde fuera, con el mismo patrón que vigilar-tarjetas.py: detección por
sondeo, no prevención instantánea. Limitación honesta, la misma de ese script:
es una foto entre dos chequeos. Una tarea que empieza y termina su daño dentro
de una sola ventana de sondeo no se atrapa a tiempo.

Dos comprobaciones:

- `--check-runtime`: tareas `running` sin `max_runtime_seconds` que llevan más
  del techo de seguridad corriendo -> se paran con `hermes kanban reclaim`,
  que SÍ termina el proceso real del worker (confirmado leyendo
  `reclaim_task`/`_terminate_reclaimed_worker`), no solo libera el candado en
  la base de datos. Nunca escribe en la base de datos directamente.
- `--check-fleet`: cuenta tareas `running` contra `kanban.max_in_progress`
  configurado para el perfil. Solo alerta -- no para nada, porque decidir cuál
  de varias tareas concurrentes legítimas sacrificar no es una decisión que
  deba tomar un script sin criterio.

Uso:
    python3 scripts/agentes/vigilar-limites.py <kanban.db> <board> --profile arkysupabase [--cron]

Código de salida: 0 si no hubo que hacer ni avisar nada; 1 si se paró alguna
tarea o se detectó el tope de flota superado.
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


def write_heartbeat(board: str, runtime_hits: int, fleet_alert: bool, error: str = None) -> None:
    payload = {
        "last_run_at": datetime.now(timezone.utc).isoformat(),
        "board": board,
        "runtime_hits": runtime_hits,
        "fleet_alert": fleet_alert,
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


def check_fleet(con: sqlite3.Connection, profile: str) -> dict:
    """Cuenta 'running' contra kanban.max_in_progress configurado para el perfil.
    Solo detecta y reporta -- nunca para nada aquí."""
    running = con.execute("SELECT count(*) FROM tasks WHERE status='running'").fetchone()[0]
    cap = None
    cap_source = "no configurado"
    config_path = Path.home() / ".hermes" / "profiles" / profile / "config.yaml"
    try:
        import yaml
        cfg = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
        raw = (cfg.get("kanban") or {}).get("max_in_progress")
        if isinstance(raw, int) and raw > 0:
            cap = raw
            cap_source = str(config_path)
    except (OSError, Exception):
        cap_source = f"error leyendo {config_path}"
    exceeded = cap is not None and running > cap
    return {"running": running, "configured_cap": cap, "cap_source": cap_source, "exceeded": exceeded}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("db")
    ap.add_argument("board")
    ap.add_argument("--profile", default="arkysupabase", help="perfil hermes para reclaim y para leer su config (default: arkysupabase)")
    ap.add_argument("--runtime-ceiling-seconds", type=int, default=DEFAULT_RUNTIME_CEILING_SECONDS)
    ap.add_argument("--dry-run", action="store_true", help="detecta pero no llama a reclaim")
    ap.add_argument("--cron", action="store_true", help="silencio si no hay nada que avisar")
    args = ap.parse_args()

    try:
        con = sqlite3.connect(f"file:{args.db}?mode=ro" if args.dry_run else args.db, uri=args.dry_run)
        con.row_factory = sqlite3.Row
        runtime_hits = check_runtime(con, args.profile, args.board, args.runtime_ceiling_seconds, args.dry_run)
        fleet = check_fleet(con, args.profile)
    except Exception as exc:  # un vigilante que se traga su propio fallo es peor que ninguno
        write_heartbeat(args.board, 0, False, error=f"{type(exc).__name__}: {exc}")
        print(f"VIGILAR-LIMITES: fallo al comprobar {args.board}: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise

    write_heartbeat(args.board, len(runtime_hits), fleet["exceeded"])

    alertas = bool(runtime_hits) or fleet["exceeded"]

    if args.cron and not alertas:
        return 0

    if not args.cron:
        print(f"== vigilar-limites: {args.board} ({args.db}) ==")
        print(f"flota: running={fleet['running']} tope={fleet['configured_cap']} "
              f"(fuente: {fleet['cap_source']}) {'SUPERADO' if fleet['exceeded'] else 'ok'}")

    if fleet["exceeded"]:
        print(f"ALERTA_FLOTA: {fleet['running']} tareas corriendo, tope configurado {fleet['configured_cap']} "
              f"(fuente: {fleet['cap_source']}). El tope falló abierto o cambió sin que esto lo sepa.")

    for hit in runtime_hits:
        action = "se habría detenido" if args.dry_run else "detenida"
        print(f"ALERTA_RUNTIME: {hit['id']} ({hit['assignee']}) {action} tras {hit['elapsed_seconds']}s "
              f"sin max_runtime_seconds -- \"{hit['title']}\"")

    return 1 if alertas else 0


if __name__ == "__main__":
    raise SystemExit(main())
