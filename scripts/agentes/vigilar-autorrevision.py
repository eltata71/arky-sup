#!/usr/bin/env python3
"""Vigilante externo contra la autorrevisión -- con anulación humana explícita
(plan de contención, 2026-10-25; rediseñado el mismo día tras el dato de José:
«pude haber fusionado yo mismo esos PRs, porque le pedí a otro agente que
tomara esas tareas y las completara»).

EL HUECO CONFIRMADO (hallazgo 1, auditoría 2026-10-25)
==============================================================================
En Hermes, `hermes kanban request-review` (= `request_review()` en
`hermes_cli/kanban_db.py`) acepta `reviewer` como OPCIONAL. Si nadie lo pasa,
la tarjeta pasa de `running`/`ready` a `review` conservando el mismo
`assignee`, y el despachador puede volver a reclamarla y a ejecutarla con el
mismo implementador. No es una suposición: se confirmó en `arky-maintenance`
(producción) sobre tres tarjetas reales, las tres con `reviewer: null` en el
evento `review_requested` y las tres reclamadas acto seguido por el mismo
`claim_lock` que las había implementado, hasta `completed`:

  - t_42e81d5d (18.1, implementer camilo)
  - t_0108bdd2 (H2,   implementer andres)
  - t_8edc38b7 (16.3, implementer diego)

Una cuarta tarjeta real (t_e22f6fa9) sí llevaba `reviewer: "rafael"` --
distinto del implementer ("diego") -- y por eso NO es autorrevisión: es el
caso de control negativo de este script.

EL PROBLEMA NO ES QUE ALGUIEN DECIDA SEGUIR ADELANTE -- ES NO SABER QUIÉN
==============================================================================
Las tres tarjetas de arriba se fusionaron en GitHub pese a veredictos de
"cambios solicitados"/"no fusionar" (dos de ellas) o sobre un SHA que dejó de
ser el fusionado (la tercera). José puede haber decidido él mismo seguir
adelante -- es su decisión, y es legítima. Lo que NO es legítimo es que el
historial no distinga "José decidió fusionar a pesar del no" de "un bot
ignoró la revisión": las dos se ven exactamente igual sin un registro
explícito. Por eso este vigilante NO intenta impedir que alguien anule el
veredicto -- un control que el dueño no puede saltarse cuando lo necesita
acaba desactivado entero. Lo que hace es: bloquea/escala por defecto, Y ofrece
una vía de anulación deliberada que queda escrita, con quién y por qué.

QUÉ VIGILA
==============================================================================
Cada evento `task_events.kind='review_requested'` cuyo payload tenga:
  (a) `reviewer` nulo o vacío, o
  (b) `reviewer` igual (sin mayúsculas/espacios) a `implementer`.
Eso es la autoaprobación -- la tarjeta sale de revisión sin que haya un
tercero distinto registrado.

MODO 1 -- VIGILANCIA (comportamiento por defecto)
==============================================================================
    python3 vigilar-autorrevision.py <kanban.db> <board> --profile arkysupabase [--dry-run] [--cron]

Para cada hallazgo sin anulación registrada (ver MODO 2) y sin escalar todavía:
  - Si la tarjeta está `running` -> se reclama (mata el worker real, igual que
    vigilar-limites.py) y se bloquea (`kind=needs_input`).
  - Si está `ready` -> se bloquea directo, sin reclamar.
  - Si ya es `review`/`done`/`archived`/`blocked` por otra causa -> se
    intenta bloquear igual (inofensivo si Hermes lo rechaza: confirmado
    leyendo `block_task()`, sólo transiciona `running`/`ready`) y SIEMPRE se
    deja un comentario auditable -- fallar hacia el lado seguro aquí es no
    quedarse callado, no fingir que se contuvo algo que no se contuvo.
Cada escalada lleva una firma estable (`f"{AUTORREVISION_MARKER}evt=<id>"`)
para no repetirse. Un hallazgo ya anulado (MODO 2) no se vuelve a tocar: se
reporta como ANULADA, no como pendiente, y no cuenta para el código de salida.

LÍMITE DE CONTENCIÓN, CONFIRMADO LEYENDO EL CÓDIGO DE HERMES (no supuesto)
==============================================================================
`block_task()` sólo transiciona `running`/`ready` -> `blocked`. Una tarjeta ya
`done` NO se puede bloquear por esta vía. Y en los tres casos reales, la
ventana `running` duró entre 19 segundos y pocos minutos. Un cron, por
frecuente que sea, probablemente la encuentre ya en `done` -- por eso existen
los dos modos (contención real cuando llega a tiempo; escalada por comentario
cuando no).

MODO 2 -- ANULACIÓN HUMANA EXPLÍCITA
==============================================================================
    python3 vigilar-autorrevision.py <kanban.db> <board> --profile arkysupabase \
        --override TASK_ID --by QUIEN --reason "por qué sigue adelante" \
        [--repo OWNER/NAME] [--dry-run]

Qué hace:
  1. Exige un hallazgo de autorrevisión real sobre TASK_ID (si no hay ninguno,
     se niega -- no hay nada que anular).
  2. Escribe en la propia tarjeta, por la vía soportada (`hermes kanban
     comment`), un comentario con la firma `ANULACION_MARKER`, QUIÉN (--by) y
     POR QUÉ (--reason). Esto es lo que distingue, en el historial, una
     decisión del dueño de un bot ignorando la revisión.
  3. Si la tarjeta sigue `blocked` por este mismo vigilante, la desbloquea
     (`hermes kanban unblock`) -- la anulación existe para que el trabajo siga,
     no para que quede registrada y congelada igual.
  4. Mejor esfuerzo, no garantizado: busca un número de PR (`#123`) mencionado
     en los eventos/comentarios de la tarjeta y, si encuentra exactamente uno
     (ambiguo o ausente = no lo intenta, y lo dice), posta el mismo texto como
     comentario normal en ese PR vía `gh pr comment` -- nunca como revisión
     nativa de GitHub: una anulación no es una aprobación de código, es un
     registro de que alguien decidió seguir a pesar de una revisión.

SOBRE LA IDENTIDAD DE QUIEN ANULA -- LÍMITE HONESTO, NO RESUELTO
==============================================================================
`--by` es texto libre: nada en Hermes ata un comentario a una identidad
verificable más allá del string que el llamante decide escribir (confirmado
leyendo `add_comment()` en `kanban_db.py`: `author` no se valida contra ningún
perfil ni sesión). Este script no inventa una capa de autenticación que
Hermes no tiene -- eso sería prometer una garantía falsa. Lo que ofrece es
exactamente el mismo nivel de confianza que ya rige todo lo demás en este
tablero (`assignee`, `implementer`, los propios reviewers "Alexis"/"Rafael"
posteados bajo la cuenta de GitHub de José): un registro explícito, con
nombre y motivo, auditable y visible -- no una firma criptográfica. Resuelve
el problema de HOY (ningún rastro de que fue una decisión, ni de quién), no
el problema de fondo de que todo corre bajo una sola identidad compartida
(eso se dimensionó aparte: pasar a revisiones nativas de GitHub con una
segunda cuenta).

LO QUE ESTE VIGILANTE **NO** DETECTA, A PROPÓSITO (nombrado, no resuelto)
==============================================================================
El caso de la PR #255 (16.3): una revisión independiente real (Rafael,
aprobada) sobre un SHA que la rama superó con commits posteriores antes de
fusionar, sin una nueva revisión sobre el SHA final. ESO NO ES DETECTABLE
desde `kanban.db`: el SHA aprobado sólo existe como texto libre dentro de
comentarios/eventos, sin campo estructurado que lo relacione con un commit
real de git, y el histórico de commits posteriores vive en GitHub, fuente que
este script no toca. Construir ese detector exigiría o un campo nuevo en el
motor de Hermes (fuera de alcance) o raspar prosa con regex contra `git log`
en cada corrida -- frágil, con falsos negativos garantizados en cuanto cambie
el formato de un comentario. Queda nombrado para que no se de por vigilado.

Código de salida (modo vigilancia): 0 si no hay autorrevisión nueva por
marcar (una ya anulada o ya escalada antes no cuenta); 1 si se detectó (y se
contuvo o se escaló) alguna por primera vez. (modo --override): 0 si se
registró; distinto de 0 si se negó.
"""
import argparse
import json
import re
import subprocess
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

HEARTBEAT = Path(__file__).resolve().parent / "vigilar-autorrevision.heartbeat.json"
AUTORREVISION_MARKER = "AUTORREVISION:"  # firma de una escalada: "{marker}evt=<id>"
ANULACION_MARKER = "ANULACION-HUMANA:"   # firma de una anulación: "{marker}evt=<id> por=<by>"
DEFAULT_REPO = "eltata71/arky-sup"       # este script vive en ese repo; --repo lo cambia


def write_heartbeat(board: str, found: int, contained: int, escalated: int,
                     overridden: int = 0, error: str = None) -> None:
    payload = {
        "last_run_at": datetime.now(timezone.utc).isoformat(),
        "board": board,
        "found": found,
        "contained": contained,
        "escalated": escalated,
        "overridden": overridden,
        "error": error,
    }
    try:
        HEARTBEAT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


def _norm(value) -> str:
    return (value or "").strip().lower()


def _is_self_review(payload: dict) -> bool:
    reviewer = _norm(payload.get("reviewer"))
    implementer = _norm(payload.get("implementer"))
    if not reviewer:
        return True  # (a): sin revisor registrado
    return implementer != "" and reviewer == implementer  # (b): revisor == implementador


def find_self_review_events(con: sqlite3.Connection, task_id: str = None) -> list[dict]:
    """Todo evento `review_requested` histórico que cumpla (a) o (b), opcionalmente
    filtrado a una tarjeta. Lectura pura; no hay 'desde cuándo' porque la firma en
    comentarios (ver `_marker_present`) es lo que evita repetir trabajo, no un
    cursor de tiempo -- así una corrida que se pierde una ventana no pierde el
    hallazgo para siempre."""
    sql = "SELECT id, task_id, payload, created_at FROM task_events WHERE kind='review_requested'"
    params: tuple = ()
    if task_id:
        sql += " AND task_id=?"
        params = (task_id,)
    rows = con.execute(sql + " ORDER BY id ASC", params).fetchall()
    hits = []
    for event_id, tid, raw_payload, created_at in rows:
        try:
            payload = json.loads(raw_payload) if raw_payload else {}
        except (TypeError, ValueError):
            payload = {}
        if _is_self_review(payload):
            hits.append({
                "event_id": event_id, "task_id": tid, "created_at": created_at,
                "reviewer": payload.get("reviewer"), "implementer": payload.get("implementer"),
            })
    return hits


def _marker_present(con: sqlite3.Connection, task_id: str, marker: str, event_id: int) -> bool:
    sig = f"{marker}evt={event_id}"
    row = con.execute(
        "SELECT 1 FROM task_comments WHERE task_id=? AND body LIKE ? LIMIT 1",
        (task_id, f"%{sig}%"),
    ).fetchone()
    return row is not None


def _task_status(con: sqlite3.Connection, task_id: str) -> str | None:
    row = con.execute("SELECT status FROM tasks WHERE id=?", (task_id,)).fetchone()
    return row[0] if row else None


def _run(profile: str, board: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["hermes", "-p", profile, "kanban", "--board", board, *args],
        check=False, capture_output=True, text=True,
    )


# --- Modo 1: vigilancia -------------------------------------------------

def act_on_hit(con: sqlite3.Connection, profile: str, board: str, hit: dict, dry_run: bool) -> dict:
    task_id, event_id = hit["task_id"], hit["event_id"]
    status = _task_status(con, task_id)
    reviewer_desc = hit["reviewer"] or "(ninguno)"
    reason = (
        f"{AUTORREVISION_MARKER}evt={event_id} -- esta tarjeta pidió revisión (evento {event_id}, "
        f"{datetime.fromtimestamp(hit['created_at'], tz=timezone.utc).isoformat()}) sin un revisor "
        f"distinto del implementador registrado: implementer=\"{hit['implementer']}\", "
        f"reviewer={reviewer_desc!r}. Vigilante externo (vigilar-autorrevision.py); el motor de Hermes "
        f"no se ha tocado. Si esto es una decisión deliberada de seguir adelante, anular explícitamente "
        f"con --override (deja constancia de quién y por qué y desbloquea); si no, requiere revisión "
        f"independiente antes de considerarse cerrada."
    )
    result = {**hit, "status_at_check": status, "action": None, "contained": False}

    if dry_run:
        if status == "running":
            result["action"] = "habría reclamado y bloqueado (running)"
        elif status == "ready":
            result["action"] = "habría bloqueado directo (ready)"
        else:
            result["action"] = f"habría escalado por comentario ({status}: no se puede bloquear)"
        return result

    if status == "running":
        reclaimed = _run(profile, board, "reclaim", task_id, "--reason", reason)
        blocked = _run(profile, board, "block", "--kind", "needs_input", task_id, reason)
        result["contained"] = blocked.returncode == 0
        result["action"] = f"reclaim(rc={reclaimed.returncode}) + block(rc={blocked.returncode})"
    elif status == "ready":
        blocked = _run(profile, board, "block", "--kind", "needs_input", task_id, reason)
        result["contained"] = blocked.returncode == 0
        result["action"] = f"block(rc={blocked.returncode})"
    else:
        # review / done / archived / blocked-por-otra-causa: sin transición soportada.
        # Se intenta bloquear igual -- Hermes lo rechaza solo si no aplica, no hace daño --
        # pero lo que de verdad deja rastro aquí es el comentario, siempre.
        attempt = _run(profile, board, "block", "--kind", "needs_input", task_id, reason)
        commented = _run(profile, board, "comment", "--author", "vigilancia", task_id, reason)
        result["contained"] = attempt.returncode == 0
        result["action"] = f"escalada: block(rc={attempt.returncode}) + comment(rc={commented.returncode})"
    return result


def run_watch(args) -> int:
    try:
        con = sqlite3.connect(f"file:{args.db}?mode=ro" if args.dry_run else args.db, uri=args.dry_run)
        con.execute("PRAGMA busy_timeout=5000")
        total_events = con.execute("SELECT COUNT(*) FROM task_events WHERE kind='review_requested'").fetchone()[0]
        all_hits = find_self_review_events(con)
        overridden_hits = [h for h in all_hits if _marker_present(con, h["task_id"], ANULACION_MARKER, h["event_id"])]
        already_escalated = [
            h for h in all_hits
            if h not in overridden_hits and _marker_present(con, h["task_id"], AUTORREVISION_MARKER, h["event_id"])
        ]
        pending = [h for h in all_hits if h not in overridden_hits and h not in already_escalated]
        results = [act_on_hit(con, args.profile, args.board, h, args.dry_run) for h in pending]
    except Exception as exc:  # un vigilante que se traga su propio fallo es peor que ninguno
        write_heartbeat(args.board, 0, 0, 0, error=f"{type(exc).__name__}: {exc}")
        print(f"VIGILAR-AUTORREVISION: fallo al comprobar {args.board}: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise

    contained = sum(1 for r in results if r.get("contained"))
    escalated = len(results) - contained
    write_heartbeat(args.board, len(results), contained, escalated, overridden=len(overridden_hits))

    if args.cron and not results:
        return 0

    if not args.cron:
        print(f"== vigilar-autorrevision: {args.board} ({args.db}) ==")
        print(f"eventos review_requested totales: {total_events} | autorrevisión histórica: {len(all_hits)} | "
              f"anuladas: {len(overridden_hits)} | ya escaladas antes: {len(already_escalated)} | "
              f"nuevas en esta pasada: {len(pending)}")
        for h in overridden_hits:
            print(f"  ANULADA: {h['task_id']} (evt {h['event_id']}) implementer={h['implementer']!r} "
                  f"reviewer={h['reviewer']!r} -- anulación humana registrada, sin acción")
        if not results:
            print("sin autorrevisión nueva por marcar")

    for r in results:
        tag = "CONTENIDA" if r["contained"] else "ESCALADA"
        print(f"AUTORREVISION_{tag}: {r['task_id']} (evt {r['event_id']}, status={r['status_at_check']}) "
              f"implementer={r['implementer']!r} reviewer={r['reviewer']!r} -- {r['action']}")

    return 1 if results else 0


# --- Modo 2: anulación humana -------------------------------------------

_PR_REF_RE = re.compile(r"#(\d{1,6})\b")


def _find_pr_number(con: sqlite3.Connection, task_id: str) -> tuple[int | None, str]:
    """Mejor esfuerzo, nunca garantizado: busca referencias '#123' en los
    eventos y comentarios de la tarjeta. Cero o más de un número distinto
    encontrado = no se adivina, se dice por qué."""
    texts: list[str] = []
    for (payload,) in con.execute("SELECT payload FROM task_events WHERE task_id=?", (task_id,)):
        texts.append(payload or "")
    for (body,) in con.execute("SELECT body FROM task_comments WHERE task_id=?", (task_id,)):
        texts.append(body or "")
    found = {int(n) for t in texts for n in _PR_REF_RE.findall(t)}
    if not found:
        return None, "ningún número de PR mencionado en la tarjeta"
    if len(found) > 1:
        return None, f"ambiguo: {sorted(found)} aparecen todos -- postear el PR correcto a mano"
    return found.pop(), "ok"


def run_override(args) -> int:
    reason = (args.reason or "").strip()
    by = (args.by or "").strip()
    if not reason:
        print("--override exige --reason: decir por qué se sigue adelante, no basta con la firma.", file=sys.stderr)
        return 2
    if not by:
        print("--override exige --by: decir quién decide, en texto libre (ver límite de identidad en el docstring).",
              file=sys.stderr)
        return 2

    con = sqlite3.connect(args.db)
    con.execute("PRAGMA busy_timeout=5000")
    hits = find_self_review_events(con, task_id=args.override)
    if not hits:
        print(f"{args.override}: no hay ningún evento review_requested de autorrevisión sobre esta tarjeta. "
              f"No hay nada que anular.", file=sys.stderr)
        return 3
    hit = hits[-1]  # el más reciente, si hubo más de uno
    event_id = hit["event_id"]

    if _marker_present(con, args.override, ANULACION_MARKER, event_id):
        print(f"{args.override} (evt {event_id}): ya tenía una anulación registrada. No se duplica.")
        return 0

    note = (
        f"{ANULACION_MARKER}evt={event_id} por={by} -- Decisión explícita de seguir adelante pese a la "
        f"autorrevisión detectada (implementer=\"{hit['implementer']}\", reviewer={hit['reviewer']!r}, "
        f"evento {event_id}, {datetime.fromtimestamp(hit['created_at'], tz=timezone.utc).isoformat()}). "
        f"Motivo: {reason}"
    )

    status = _task_status(con, args.override)
    pr_number, pr_status = _find_pr_number(con, args.override)

    print(f"{args.override} (evt {event_id}, status actual={status}): registrando anulación de {by!r}.")
    print(f"motivo: {reason}")
    print(f"PR vinculado: {pr_number if pr_number else '(' + pr_status + ')'}")

    if args.dry_run:
        print("--dry-run: no se escribe nada. Se habría comentado en la tarjeta"
              + (", desbloqueado," if status == "blocked" else "")
              + (f" y comentado en PR #{pr_number} ({args.repo})" if pr_number else "") + ".")
        return 0

    commented = _run(args.profile, args.board, "comment", "--author", by, args.override, note)
    if commented.returncode != 0:
        print(f"fallo al comentar en la tarjeta: {commented.stderr.strip()}", file=sys.stderr)
        return 4

    if status == "blocked":
        unblocked = _run(args.profile, args.board, "unblock", args.override)
        print(f"desbloqueada (rc={unblocked.returncode}): {unblocked.stdout.strip() or unblocked.stderr.strip()}")

    if pr_number:
        gh = subprocess.run(
            ["gh", "pr", "comment", str(pr_number), "--repo", args.repo, "--body", note],
            check=False, capture_output=True, text=True,
        )
        if gh.returncode == 0:
            print(f"también registrado en PR #{pr_number} ({args.repo})")
        else:
            print(f"no se pudo comentar en PR #{pr_number}: {gh.stderr.strip()} -- "
                  f"la anulación SÍ quedó registrada en la tarjeta; postear a mano en el PR.", file=sys.stderr)
    else:
        print(f"no se intentó postear en GitHub: {pr_status}. La anulación sí quedó registrada en la tarjeta.")

    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("db")
    ap.add_argument("board")
    ap.add_argument("--profile", default="arkysupabase", help="perfil hermes para las acciones (default: arkysupabase)")
    ap.add_argument("--dry-run", action="store_true", help="describe la acción sin ejecutarla")
    ap.add_argument("--cron", action="store_true", help="(modo vigilancia) silencio si no hay nada nuevo")
    ap.add_argument("--override", metavar="TASK_ID", help="modo anulación: registra una decisión humana sobre esta tarjeta")
    ap.add_argument("--reason", help="(con --override) por qué se sigue adelante -- obligatorio")
    ap.add_argument("--by", help="(con --override) quién decide -- obligatorio, texto libre")
    ap.add_argument("--repo", default=DEFAULT_REPO, help=f"(con --override) owner/repo de GitHub (default: {DEFAULT_REPO})")
    args = ap.parse_args()

    if args.override:
        return run_override(args)
    return run_watch(args)


if __name__ == "__main__":
    raise SystemExit(main())
