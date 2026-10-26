#!/usr/bin/env python3
"""Un único punto de consulta para saber si la fábrica necesita a una persona
ahora, pensado para que lo invoque un chequeo periódico fuera de Hermes (no
un cron de Hermes -- este lo corre quien vigile desde fuera, p. ej. una
sesión de Claude con una comprobación programada).

Responde en una línea de veredicto ("OK" o "ATENCION: ...") y el detalle
debajo -- para leer solo la primera línea la mayoría de las veces.

Qué comprueba, y con qué umbral, y por qué:

- **Tableros, descubiertos en cada pasada** (`hermes kanban boards list
  --json`), no una lista escrita a mano. Corregido 2026-10-25: Hermes crea
  tableros por su cuenta (confirmado en vivo -- la prueba del coordinador
  generó uno nuevo con solo nombrarlo), así que una lista fija siempre
  vigilaba menos de lo que existía.
- **Gateway vivo por cada unidad `hermes-gateway-*` registrada**, también
  descubierta en cada pasada (`systemctl --user list-unit-files`), no una
  lista de dos. Si alguna no está activa, nada más de esto importa para su
  tablero -- es "ese tablero dejó de despachar".
- **Tablero con trabajo pendiente y sin ningún gateway vigilándolo**: CRÍTICO.
  Es el hueco que reveló la prueba del coordinador -- un tablero nacido solo,
  con tareas `ready`/`todo`/`running` reales, corriendo fuera de cualquier
  despachador porque nadie le levantó uno. Se calcula cruzando los tableros
  con trabajo no terminal contra qué tablero vigila cada gateway activo
  (`hermes --profile <perfil> kanban boards list`, el mismo marcador `●` que
  ya se usa para verificar el anclaje tras un reinicio).
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
- **Enlaces de la skill canónica `latam-factory-orchestration` rotos o
  sustituidos por una copia real** (hallazgo 3, revisión del PR #293,
  2026-10-25): se creó la fuente única porque 18 copias ya habían divergido
  una vez; un enlace roto en una carpeta de skills no da ningún error
  visible -- Hermes simplemente deja de cargar la skill -- así que sin esta
  comprobación la unificación es cierta el día que se hace y nadie sabe
  cuándo deja de serlo. El curador de Hermes ya tocó esos directorios una
  vez (`.curator_ledger.jsonl`/`.curator_backups` con fecha, no hipotético).
  CRÍTICO si algún perfil que tiene el directorio de la skill no tiene un
  enlace que resuelva al canónico del repo.

Qué NO comprueba, a propósito, para que no se asuma cubierto: **gasto
desbocado** y **pérdida de datos** no tienen hoy ninguna señal barata que
leer -- no hay medición de coste por tarea (CA28, deprioritizado) ni un
detector de pérdida de datos. Y el cruce tablero-sin-gateway solo ve
*tableros que ya existen*: un agente que trabaja por completo fuera de
Kanban (terminal directo, sin crear ninguna tarjeta) sigue siendo invisible
para esto, igual que para todo lo demás que hemos construido. Si alguna vez
se construye una señal para cualquiera de los dos, se añade aquí; hasta
entonces, el veredicto de este script no los cubre y no hay que leerlo como
si lo hiciera.

Uso:
    python3 scripts/agentes/estado-fabrica.py [--json]

Código de salida: 0 si OK; 1 si hay algo crítico.

Desde 2026-10-25 también se registra en el cron de Hermes (no solo invocado
a mano): corre cada 15 minutos, sin agente (coste cero, es Python puro, sin
ninguna llamada a modelo) y escribe su veredicto en RESULT_FILE -- un fichero
estable que una vigilancia externa (p. ej. una tarea programada de otra
aplicación) puede leer sin tener que correr este script ella misma ni
depender de que algo más esté abierto. Detectar (este script, en la máquina,
siempre) y avisar (quien lea RESULT_FILE y decida a quién molestar) son dos
trabajos distintos a propósito -- el primero no debe depender del segundo.
"""
import argparse
import json
import os
import re
import subprocess
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

MOTOR_LOG = Path.home() / ".hermes" / "logs" / "motor-bloqueado.jsonl"
RESULT_FILE = Path.home() / ".hermes" / "logs" / "estado-fabrica.json"

STALE_BLOCKED_HOURS = 4
HUMAN_GATE_KINDS = {"needs_input", "capability"}
MOTOR_BLOCK_WINDOW_MINUTES = 60
MOTOR_BLOCK_THRESHOLD = 2
NON_TERMINAL_STATUSES = {"ready", "todo", "running", "triage", "scheduled"}
_GATEWAY_UNIT_RE = re.compile(r"^hermes-gateway-([a-z0-9]+)\.service$")


def discover_boards() -> dict[str, Path]:
    """Tableros reales, preguntados ahora -- no una lista escrita a mano.
    Falla cerrado (dict vacío) si Hermes no responde; un chequeo que no puede
    ver ningún tablero debe decirlo, no fingir que no hay nada que vigilar
    (por eso el llamador trata un resultado vacío con error aparte como
    ATENCION, no como silencio limpio)."""
    try:
        out = subprocess.run(
            ["hermes", "kanban", "boards", "list", "--json"],
            capture_output=True, text=True, timeout=20,
        )
        boards = json.loads(out.stdout)
    except Exception:
        return {}
    result = {}
    for b in boards if isinstance(boards, list) else []:
        slug, db = b.get("slug"), b.get("db_path")
        if slug and db:
            result[slug] = Path(db)
    return result


def discover_gateway_units() -> list[str]:
    """Toda unidad `hermes-gateway-*.service` registrada, descubierta ahora --
    no una lista de dos. Una unidad nueva (p. ej. la de un proyecto dado de
    alta esta semana) entra sola en el chequeo la próxima vez que corra."""
    try:
        out = subprocess.run(
            ["systemctl", "--user", "list-unit-files", "hermes-gateway-*.service", "--no-legend"],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [line.split()[0] for line in out.stdout.splitlines() if line.strip()]


def gateways_alive(units: list[str]) -> tuple[bool, dict[str, str]]:
    """Todos los gateways registrados deben estar activos -- cada tablero
    vivo depende del suyo (desde que varios tableros despachan por separado,
    comprobar solo uno deja a los demás sin vigilancia)."""
    states: dict[str, str] = {}
    for svc in units:
        try:
            out = subprocess.run(
                ["systemctl", "--user", "is-active", svc],
                capture_output=True, text=True, timeout=10,
            ).stdout.strip()
        except (OSError, subprocess.TimeoutExpired) as exc:
            out = f"error: {exc}"
        states[svc] = out or "desconocido"
    return all(v == "active" for v in states.values()), states


def watched_boards(units: list[str], gw_states: dict[str, str]) -> set[str]:
    """Qué tablero vigila cada gateway ACTIVO, preguntándoselo a Hermes
    directamente (el mismo marcador `●` que ya se usa para confirmar el
    anclaje de un gateway tras un reinicio) -- nunca asumido por el nombre
    de la unidad."""
    watched = set()
    for svc in units:
        if gw_states.get(svc) != "active":
            continue
        m = _GATEWAY_UNIT_RE.match(svc)
        if not m:
            continue
        profile = m.group(1)
        try:
            out = subprocess.run(
                ["hermes", "--profile", profile, "kanban", "boards", "list"],
                capture_output=True, text=True, timeout=20,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        for line in out.stdout.splitlines():
            if line.strip().startswith("●"):
                parts = line.split()
                if len(parts) >= 2:
                    watched.add(parts[1])
    return watched


def unwatched_boards_with_work(boards: dict[str, Path], watched: set[str]) -> list[dict]:
    """Tableros con trabajo no terminal real que ningún gateway activo
    vigila -- el escenario que de verdad preocupa: no 'no hay gateway', sino
    'hay trabajo corriendo y nada lo gobierna'. Un tablero vacío o ya
    terminado sin gateway no es una alerta -- no hay nada que gobernar."""
    out = []
    for slug, db in boards.items():
        if slug in watched or not db.exists():
            continue
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            placeholders = ",".join("?" for _ in NON_TERMINAL_STATUSES)
            rows = con.execute(
                f"SELECT count(*) FROM tasks WHERE status IN ({placeholders})",
                tuple(NON_TERMINAL_STATUSES),
            ).fetchone()
            pending = rows[0] if rows else 0
        except sqlite3.Error:
            continue
        if pending > 0:
            out.append({"board": slug, "pending_tasks": pending})
    return out


def blocked_tasks(now: float, boards: dict[str, Path]) -> list[dict]:
    out = []
    for board, db in boards.items():
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


CANON_SKILL = Path("/home/tata/workspace/arky-sup/scripts/agentes/skills/latam-factory-orchestration/SKILL.md")
PROFILES_DIR = Path.home() / ".hermes" / "profiles"
SKILL_REL = Path("skills/latam-factory-orchestration/SKILL.md")


def broken_canonical_skill_links() -> list[dict]:
    """Perfiles que tienen el directorio de `latam-factory-orchestration` pero
    cuyo SKILL.md no es un enlace que resuelva al canónico del repo -- fichero
    real, enlace roto, o enlace a otro sitio. No evalúa perfiles que nunca
    tuvieron la skill: esto detecta divergencia, no decide quién debe tenerla.
    Si el propio canónico no existe, no puede haber nada "roto" que reportar
    aquí -- ese es un fallo más grave, y se nombra aparte."""
    if not CANON_SKILL.is_file():
        return [{"profile": None, "problem": f"el canónico {CANON_SKILL} no existe"}]
    canon_real = CANON_SKILL.resolve()
    broken = []
    if not PROFILES_DIR.is_dir():
        return broken
    for profile_dir in sorted(PROFILES_DIR.iterdir()):
        if not profile_dir.is_dir() or profile_dir.name == ".deleted":
            continue
        target = profile_dir / SKILL_REL
        if not target.parent.is_dir():
            continue  # este perfil nunca tuvo la skill
        if not target.is_symlink():
            kind = "copia real" if target.exists() else "no existe"
            broken.append({"profile": profile_dir.name, "problem": kind})
            continue
        try:
            resolved = target.resolve()
        except OSError:
            broken.append({"profile": profile_dir.name, "problem": "enlace roto"})
            continue
        if resolved != canon_real:
            broken.append({"profile": profile_dir.name, "problem": f"enlaza a {resolved}, no al canónico"})
    return broken


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

    boards = discover_boards()
    boards_error = not boards
    if boards_error:
        razones.append("NO SE PUDO DESCUBRIR NINGÚN TABLERO -- hermes kanban boards list falló o no devolvió nada; "
                        "este chequeo no puede ver nada hasta que eso se resuelva")

    gw_units = discover_gateway_units()
    alive, gw_states = gateways_alive(gw_units)
    if not alive:
        caidos = ", ".join(f"{svc}={st}" for svc, st in gw_states.items() if st != "active")
        razones.append(f"GATEWAY CAÍDO ({caidos}) -- el tablero correspondiente deja de despachar")

    watched = watched_boards(gw_units, gw_states)
    orphans = unwatched_boards_with_work(boards, watched)
    for o in orphans:
        razones.append(f"TABLERO SIN GOBERNANZA: '{o['board']}' tiene {o['pending_tasks']} tarea(s) no terminal(es) "
                        f"y ningún gateway activo lo vigila -- trabajo corriendo fuera del despachador")

    blocked = blocked_tasks(now, boards)
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

    broken_links = broken_canonical_skill_links()
    for b in broken_links:
        if b["profile"] is None:
            razones.append(f"SKILL CANONICA: {b['problem']} -- ningún perfil puede estar enlazado a algo que no existe")
        else:
            razones.append(f"SKILL DESENLAZADA: perfil '{b['profile']}' -- {b['problem']} en vez de un enlace al "
                            f"canónico de latam-factory-orchestration -- repara con "
                            f"scripts/agentes/enlazar-skill-canonica.sh")

    critico = bool(razones)
    result = {
        "verdict": "ATENCION" if critico else "OK",
        "checked_at": now,
        "reasons": razones,
        "boards_discovered": sorted(boards.keys()),
        "gateways": gw_states,
        "orphan_boards": orphans,
        "blocked_total": len(blocked),
        "human_gate_count": len(human_gate),
        "stale_blocked_count": len(stale),
        "motor_block_hits_last_hour": len(motor_hits),
        "broken_skill_links": broken_links,
        "not_covered": ["gasto desbocado (sin medición de coste por tarea todavía)",
                        "pérdida de datos (sin detector todavía)",
                        "un agente trabajando fuera de Kanban por completo (sin tarjeta) sigue siendo invisible"],
    }

    # Escrito SIEMPRE, no solo cuando hay algo que avisar: una vigilancia
    # externa que lee este fichero necesita poder distinguir "todo bien" de
    # "esto dejó de correr" por el propio checked_at, no solo por el veredicto.
    try:
        RESULT_FILE.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=RESULT_FILE.parent, suffix=".estado-fabrica.tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, RESULT_FILE)
    except OSError as exc:
        print(f"(no se pudo escribir {RESULT_FILE}: {exc})", file=sys.stderr)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif critico:
        print(f"ATENCION: {len(razones)} motivo(s)")
        for r in razones:
            print(f"  - {r}")
    else:
        print(f"OK -- gateways {gw_states}, {len(blocked)} bloqueada(s) (ninguna crítica), "
              f"{len(motor_hits)} intento(s) de motor en la última hora")

    return 1 if critico else 0


if __name__ == "__main__":
    raise SystemExit(main())
