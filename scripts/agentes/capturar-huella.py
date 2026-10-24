#!/usr/bin/env python3
"""Captura una huella (hash + texto) de titulo/cuerpo de cada tarjeta de un
tablero Kanban, para poder detectar despues si cambio sin pasar por una
edicion explicita (ver scripts/agentes/safe-specify.md y la tarjeta
t_4dec3959 en arky-maintenance).

Solo lee. No requiere el CLI de hermes, solo acceso de lectura al kanban.db.

Uso:
    python3 scripts/agentes/capturar-huella.py <kanban.db> <board-slug> <salida.json>
"""
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone


def main() -> int:
    if len(sys.argv) != 4:
        print(f"uso: {sys.argv[0]} <kanban.db> <board-slug> <salida.json>", file=sys.stderr)
        return 64
    db, board, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "select id, title, body, assignee, status, created_at from tasks order by id"
    ).fetchall()

    captured_at = datetime.now(timezone.utc).isoformat()
    tasks = {}
    for r in rows:
        title = r["title"] or ""
        body = r["body"] or ""
        tasks[r["id"]] = {
            "title": title,
            "body": body,
            "title_sha256": hashlib.sha256(title.encode("utf-8")).hexdigest(),
            "body_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
            "assignee": r["assignee"],
            "status": r["status"],
            "created_at": r["created_at"],
        }

    snapshot = {
        "db": db,
        "board": board,
        "captured_at": captured_at,
        "task_count": len(tasks),
        "tasks": tasks,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2, sort_keys=True)

    print(f"capturadas {len(tasks)} tarjetas de '{board}' -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
