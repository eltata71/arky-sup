#!/usr/bin/env python3
"""Compara el estado actual de las tarjetas de un tablero contra una huella
guardada por capturar-huella.py, y clasifica cada cambio de titulo/cuerpo
usando la bitacora nativa de eventos (task_events), no una suposicion.

Dos eventos nativos tocan titulo/cuerpo: 'specified' (el LLM auxiliar
triage_specifier, automatico, el que puede omitir restricciones sin aviso --
ver la tarjeta t_4dec3959 en arky-maintenance) y 'edited' (hermes kanban edit,
explicito). 'decomposed' NO reescribe el cuerpo de la tarea descompuesta
-- su payload solo trae child_ids/root_assignee, verificado empiricamente
antes de construir esto; si esa suposicion deja de cumplirse algun dia, este
chequeo lo notaria igual, porque compara contenido, no solo eventos.

Clasificacion de una tarjeta cuyo hash cambio desde la huella:
  - El evento mas reciente que toca cuerpo/titulo es 'specified' -> ALERTA
    (reescritura automatica, el caso de riesgo real).
  - Es 'edited' -> INFO (cambio explicito; no se alarma solo por eso).
  - No hay ningun evento de ese tipo despues de la huella -> ALERTA distinta
    ("cambio sin evento explicativo"): mas grave todavia, porque ni siquiera
    pasa por un comando reconocido -- podria ser una via fuera del CLI.

No actualiza la huella por si solo. Volver a correr capturar-huella.py es un
paso aparte y deliberado, para que una alerta no se autosilencie en el
siguiente chequeo.

Uso:
    python3 scripts/agentes/vigilar-tarjetas.py <huella.json> [--comment] [--perfil jose]

Codigo de salida: 0 si todo coincide o son ediciones explicitas; 1 si hay
alguna alerta (para que un cron/wrapper lo use como senial).
"""
import argparse
import hashlib
import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def iso_to_epoch(iso: str) -> float:
    return datetime.fromisoformat(iso).timestamp()


def classify(con, task_id: str, since_epoch: float):
    rows = con.execute(
        "select kind, created_at from task_events "
        "where task_id=? and kind in ('specified','edited') and created_at>=? "
        "order by created_at asc",
        (task_id, int(since_epoch)),
    ).fetchall()
    if not rows:
        return "SIN_EVENTO", None
    last_kind, last_at = rows[-1]
    if last_kind == "specified":
        return "ALERTA_SPECIFY", last_at
    return "INFO_EDITADO", last_at


HEARTBEAT = Path(__file__).resolve().parent / "vigilar-tarjetas.heartbeat.json"


def write_heartbeat(huella_path: str, ok_count: int, info_count: int, alertas_count: int, error: str = None) -> None:
    """Se escribe en CADA invocacion, con alertas o sin ellas, exito o fallo --
    es lo que un chequeo aparte (ej. blocked-tasks-watch) puede leer para saber
    si este centinela sigue corriendo, no solo si encontro algo."""
    payload = {
        "last_run_at": datetime.now(timezone.utc).isoformat(),
        "huella": huella_path,
        "ok": ok_count,
        "info": info_count,
        "alertas": alertas_count,
        "error": error,
    }
    try:
        HEARTBEAT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass  # no tumbar el chequeo por no poder escribir el latido


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("huella", help="fichero JSON producido por capturar-huella.py")
    ap.add_argument("--comment", action="store_true",
                     help="postea un comentario en cada tarjeta con ALERTA (via hermes CLI)")
    ap.add_argument("--perfil", default="jose", help="perfil hermes para --comment (default: jose)")
    ap.add_argument("--cron", action="store_true",
                     help="modo watchdog: no imprime nada si no hay ALERTAS (silencio = todo bien, "
                          "para --no-agent de 'hermes cron create', que entrega el stdout tal cual)")
    args = ap.parse_args()

    try:
        with open(args.huella, encoding="utf-8") as f:
            baseline = json.load(f)

        db, board = baseline["db"], baseline["board"]
        since_epoch = iso_to_epoch(baseline["captured_at"])
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row

        ok, info, alertas = [], [], []
        for task_id, snap in baseline["tasks"].items():
            row = con.execute("select title, body, status from tasks where id=?", (task_id,)).fetchone()
            if row is None:
                alertas.append((task_id, "ALERTA_DESAPARECIDA", None, snap["title"]))
                continue
            title_hash = hashlib.sha256((row["title"] or "").encode("utf-8")).hexdigest()
            body_hash = hashlib.sha256((row["body"] or "").encode("utf-8")).hexdigest()
            if title_hash == snap["title_sha256"] and body_hash == snap["body_sha256"]:
                ok.append(task_id)
                continue
            kind, at = classify(con, task_id, since_epoch)
            when = datetime.fromtimestamp(at, tz=timezone.utc).isoformat() if at else "desconocido"
            entry = (task_id, kind, when, row["title"])
            if kind == "INFO_EDITADO":
                info.append(entry)
            else:
                alertas.append(entry)
    except Exception as exc:  # noqa: BLE001 -- un centinela que se traga su propio fallo es peor que ninguno
        write_heartbeat(args.huella, 0, 0, 0, error=f"{type(exc).__name__}: {exc}")
        print(f"VIGILANCIA: fallo al comparar contra {args.huella}: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise

    write_heartbeat(args.huella, len(ok), len(info), len(alertas))

    if args.cron:
        # Watchdog para 'hermes cron create --no-agent': stdout vacio = nada
        # que decir, no se entrega mensaje. Solo habla si hay ALERTAS de verdad.
        if alertas:
            print(f"VIGILANCIA ({board}): {len(alertas)} tarjeta(s) con cambio sin edicion explicita reconocida, "
                  f"desde la huella de {baseline['captured_at']}.")
            for task_id, kind, when, title in alertas:
                print(f"  ALERTA {task_id}  {kind}  {when}  \"{title}\"")
            print(f"Huella: {args.huella}")
    else:
        print(f"== vigilancia: {board} ({db}) contra huella de {baseline['captured_at']} ==")
        print(f"sin cambios: {len(ok)} | editadas explicitamente: {len(info)} | ALERTAS: {len(alertas)}")
        for task_id, kind, when, title in info:
            print(f"  INFO   {task_id}  editado {when}  \"{title}\"")
        for task_id, kind, when, title in alertas:
            print(f"  ALERTA {task_id}  {kind}  {when}  \"{title}\"")

    if alertas and args.comment:
        for task_id, kind, when, title in alertas:
            if kind == "ALERTA_DESAPARECIDA":
                continue  # nada que comentar en una tarjeta que ya no existe
            msg = (
                f"VIGILANCIA: el cuerpo de esta tarjeta cambio desde la huella de "
                f"{baseline['captured_at']} sin una edicion explicita reconocida "
                f"({kind}, ultimo evento relevante {when}). Comparar contra "
                f"{args.huella} y, si hace falta, restaurar con safe-specify.sh o "
                f"'hermes kanban edit'."
            )
            subprocess.run(
                ["hermes", "-p", args.perfil, "kanban", "comment", task_id,
                 "--author", "vigilancia", msg],
                env={"HERMES_KANBAN_DB": db, "HERMES_KANBAN_BOARD": board, "PATH": "/usr/bin:/bin:/usr/local/bin"},
                check=False,
            )
            print(f"  -> comentario posteado en {task_id}")

    return 1 if alertas else 0


if __name__ == "__main__":
    raise SystemExit(main())
