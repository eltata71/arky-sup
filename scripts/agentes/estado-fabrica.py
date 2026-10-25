#!/usr/bin/env python3
"""Un único punto de consulta para saber si la fábrica necesita a una persona
ahora, pensado para que lo invoque un chequeo periódico fuera de Hermes (no
un cron de Hermes -- este lo corre quien vigile desde fuera, p. ej. una
sesión de Claude con una comprobación programada).

Responde en una línea de veredicto ("OK" o "ATENCION: ...") y el detalle
debajo -- para leer solo la primera línea la mayoría de las veces.

Qué comprueba, y con qué umbral, y por qué:

- **Gateway vivo** (systemctl). Si no está activo, nada más de esto importa
  -- es "la fábrica entera parada", el caso más crítico de todos.
- **Gate humano pendiente** (`block_kind` en needs_input/capability):
  CRÍTICO de inmediato, sin esperar a ningún umbral de edad -- es, por
  definición, algo que solo una persona puede resolver, y ya está ahí.
- **Tarea bloqueada por edad**: CRÍTICO si lleva más de 4 horas bloqueada
  (cualquier tipo). Calibrado para una fábrica que trabaja de noche: lo
  bastante largo para no avisar por algo que el propio flujo resuelve en su
  siguiente ciclo, lo bastante corto para que una tarea bloqueada a
  medianoche no se descubra recién por la mañana.
- **Intentos repetidos contra el motor de Hermes** (log del hook
  `block-hermes-engine-writes.py`): CRÍTICO si hay 2 o más en los últimos 60
  minutos. Uno aislado es un agente topándose con el límite una vez; varios
  seguidos es algo insistiendo en lo prohibido.

Qué NO comprueba, a propósito, para que no se asuma cubierto: **gasto
desbocado** y **pérdida de datos** no tienen hoy ninguna señal barata que
leer -- no hay medición de coste por tarea (CA28, deprioritizado) ni un
detector de pérdida de datos. Si alguna vez se construye una señal para
cualquiera de los dos, se añade aquí; hasta entonces, el veredicto de este
script no los cubre y no hay que leerlo como si lo hiciera.

Uso:
    python3 scripts/agentes/estado-fabrica.py [--json]

Código de salida: 0 si OK; 1 si hay algo crítico.
"""
import argparse
import json
import subprocess
import sqlite3
import sys
import time
from pathlib import Path

GATEWAY_SERVICE = "hermes-gateway-arkysupabase.service"
BOARDS = {
    "arky-maintenance": Path("/home/tata/.hermes/kanban/boards/arky-maintenance/kanban.db"),
    "latam-factory": Path("/home/tata/.hermes/kanban/boards/latam-factory/kanban.db"),
}
MOTOR_LOG = Path.home() / ".hermes" / "logs" / "motor-bloqueado.jsonl"

STALE_BLOCKED_HOURS = 4
HUMAN_GATE_KINDS = {"needs_input", "capability"}
MOTOR_BLOCK_WINDOW_MINUTES = 60
MOTOR_BLOCK_THRESHOLD = 2


def gateway_alive() -> tuple[bool, str]:
    try:
        out = subprocess.run(
            ["systemctl", "--user", "is-active", GATEWAY_SERVICE],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"no se pudo consultar systemctl: {exc}"
    return out == "active", out or "desconocido"


def blocked_tasks(now: float) -> list[dict]:
    out = []
    for board, db in BOARDS.items():
        if not db.exists():
            continue
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT id, title, assignee, block_kind, started_at, created_at "
            "FROM tasks WHERE status='blocked'",
        ).fetchall()
        for r in rows:
            # Edad de ESTANCAMIENTO: solo si de verdad llegó a correr
            # (started_at). Una tarjeta creada ya 'blocked' -- el backlog de
            # endurecimiento de este mismo repo se crea así a propósito --
            # nunca empezó, así que no es trabajo que se haya parado, es cola
            # a la espera de que alguien la priorice. Confundir las dos cosas
            # fue el primer resultado real de probar este script: 7 avisos de
            # 7, todos backlog deliberado, cero estancamiento real.
            stalled_age_hours = round((now - r["started_at"]) / 3600.0, 1) if r["started_at"] else None
            out.append({
                "board": board, "id": r["id"], "title": r["title"], "assignee": r["assignee"],
                "block_kind": r["block_kind"], "age_hours": stalled_age_hours,
                "ever_started": r["started_at"] is not None,
            })
    return out


def motor_blocks_recent(now: float) -> list[dict]:
    if not MOTOR_LOG.exists():
        return []
    cutoff = now - MOTOR_BLOCK_WINDOW_MINUTES * 60
    hits = []
    try:
        with MOTOR_LOG.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if entry.get("epoch", 0) >= cutoff:
                    hits.append(entry)
    except OSError:
        pass
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    now = time.time()
    razones = []

    alive, gw_state = gateway_alive()
    if not alive:
        razones.append(f"GATEWAY CAÍDO ({gw_state}) -- la fábrica entera está parada")

    blocked = blocked_tasks(now)
    human_gate = [t for t in blocked if t["block_kind"] in HUMAN_GATE_KINDS]
    stale = [t for t in blocked if t["block_kind"] not in HUMAN_GATE_KINDS
             and t["age_hours"] is not None and t["age_hours"] >= STALE_BLOCKED_HOURS]
    for t in human_gate:
        razones.append(f"GATE HUMANO PENDIENTE: {t['id']} ({t['board']}, {t['assignee']}) -- \"{t['title']}\"")
    for t in stale:
        razones.append(f"BLOQUEADA {t['age_hours']}h (>= {STALE_BLOCKED_HOURS}h): {t['id']} "
                        f"({t['board']}, {t['assignee']}) -- \"{t['title']}\"")

    motor_hits = motor_blocks_recent(now) if alive else []
    if len(motor_hits) >= MOTOR_BLOCK_THRESHOLD:
        tareas = sorted({h.get("task_id") for h in motor_hits if h.get("task_id")})
        razones.append(f"MOTOR: {len(motor_hits)} intentos bloqueados en los últimos "
                        f"{MOTOR_BLOCK_WINDOW_MINUTES} min (tareas: {', '.join(tareas) or '?'})")

    critico = bool(razones)
    result = {
        "verdict": "ATENCION" if critico else "OK",
        "reasons": razones,
        "gateway": gw_state,
        "blocked_total": len(blocked),
        "human_gate_count": len(human_gate),
        "stale_blocked_count": len(stale),
        "motor_block_hits_last_hour": len(motor_hits),
        "not_covered": ["gasto desbocado (sin medición de coste por tarea todavía)",
                        "pérdida de datos (sin detector todavía)"],
    }

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif critico:
        print(f"ATENCION: {len(razones)} motivo(s)")
        for r in razones:
            print(f"  - {r}")
    else:
        print(f"OK -- gateway {gw_state}, {len(blocked)} bloqueada(s) (ninguna crítica), "
              f"{len(motor_hits)} intento(s) de motor en la última hora")

    return 1 if critico else 0


if __name__ == "__main__":
    raise SystemExit(main())
