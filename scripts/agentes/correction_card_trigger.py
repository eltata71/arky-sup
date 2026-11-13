#!/usr/bin/env python3
"""Prepara correcciones por episodios independientes verificables; sin activación.

- Sólo metadata canónica completa de runs terminados de Rafael/Alexis.
- Episodio = tarea/run de revisión; búsqueda exacta de idempotency_key en
  TODAS las tarjetas, incluidas done/archived. Un run nuevo es otro episodio.
- El candado global excluye instancias de este disparador; la clave se pasa
  también al creador nativo. No se atribuye al candado control del dispatcher.
- Trigger y vigilante comparten elegibilidad: PR OPEN, mismo SHA y episodio
  no consumido. Divergencia/error GitHub son diagnósticos, no ausencia limpia.
- Procedencia: evento review_requested y su run productor, anteriores al
  comienzo de esta revisión. Nunca assignee mutable ni reloj inventado.
- Sólo presupuesto comprobable positivo <=300, por el envoltorio canónico,
  con razones de prioridad/dependencia. NULL, inválido o exceso se abstiene;
  el script no genera una excepción humana ni instala presupuestos nuevos.
- Resumen y referencia tarea/run siempre conservados; findings numéricos son
  estadísticas, no instrucciones. La metadata histórica sin contrato queda
  fuera de la automatización. prose_verdicts_seen no inventaría esa deuda.

Pruebas en scripts/agentes/tests/test_correction_card_regressions.py usan
SQLite temporal, puertos sustituidos y exclusión POSIX real. No acreditan un
cron instalado ni una corrección creada en el tablero operativo. Ningún
ensayo de esta entrega invoca main contra el tablero real. No modifica el
motor de Hermes ni sustituye kanban_request_changes cuando su procedencia
nativa sea válida. La activación sigue necesitando autorización separada.
"""
from __future__ import annotations

import fcntl
import json
from contextlib import contextmanager
import re
import subprocess
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

REPO = "eltata71/arky-sup"
BOARD_DB = Path.home() / ".hermes" / "kanban" / "boards" / "arky-maintenance" / "kanban.db"
WRAPPER = Path(__file__).resolve().parent / "crear-tarea-hija.sh"
RUNTIME_CEILING = 300
EXECUTION_LOCK = Path.home() / ".hermes" / "logs" / "correction-card-trigger.lock"

BASE_PRIORITY = 80


def gh_json(args: list[str]):
    out = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=60, check=True)
    return json.loads(out.stdout)


@dataclass
class ChangesRequested:
    pr: int
    sha: str
    review_task_id: str
    review_run_id: int
    findings: Optional[dict]
    summary: str
    ended_at: Optional[int]


def latest_changes_requested(*, db_path: Path = BOARD_DB) -> tuple[list[ChangesRequested], int]:
    """Una entrada por PR -- la ronda más reciente que declare `pr` en su
    metadata, filtrada a verdict == changes_requested. Las filas se leen en
    orden descendente de `id` (autoincremental, nunca ambiguo como una
    fecha de texto), así que la primera vez que se ve un `pr` es siempre su
    ronda más reciente.

    El segundo valor devuelto (`prose_verdicts_seen`) NO es un inventario
    completo de veredictos sin metadata estructurada -- corrección tras
    revisión de Alexis (L1): solo cuenta dos literales exactos
    ("CAMBIOS PEDIDOS"/"APROBADO") en el resumen, y el historial real tiene
    veredictos en prosa que no usan esas palabras exactas y no se cuentan
    aquí. Es una señal aproximada para el log, nunca una cifra de
    cobertura -- no se presenta como "N sin procesar" en ningún sitio que
    sugiera que son todos los que hay."""
    con = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "SELECT task_id, id, metadata, summary, ended_at FROM task_runs "
            "WHERE outcome = 'completed' AND profile IN ('rafael','alexis') ORDER BY id DESC"
        ).fetchall()
    finally:
        con.close()
    seen_prs: set[int] = set()
    out: list[ChangesRequested] = []
    prose_verdicts_seen = 0
    for task_id, run_id, metadata_raw, summary, ended_at in rows:
        if not metadata_raw:
            continue
        try:
            meta = json.loads(metadata_raw)
        except (TypeError, ValueError):
            continue
        if not isinstance(meta, dict):
            continue
        pr = meta.get("pr")
        verdict = meta.get("verdict")
        if (type(pr) is not int or pr <= 0 or meta.get("repo") != REPO
                or meta.get("review_type") != "independent"
                or verdict not in ("approved", "changes_requested")):
            if summary and ("CAMBIOS PEDIDOS" in summary.upper() or "APROBADO" in summary.upper()):
                prose_verdicts_seen += 1
            continue
        if pr in seen_prs:
            continue
        seen_prs.add(pr)
        if verdict != "changes_requested":
            continue
        sha = meta.get("sha")
        if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
            continue
        out.append(ChangesRequested(
            pr=pr, sha=sha, review_task_id=task_id, review_run_id=run_id,
            findings=meta.get("findings") if isinstance(meta.get("findings"), dict) else None,
            summary=summary or "", ended_at=ended_at,
        ))
    return out, prose_verdicts_seen


def episode_key(cr: ChangesRequested) -> str:
    return f"correction-{cr.review_task_id}-{cr.review_run_id}"


def episode_correction_card(cr: ChangesRequested, *, db_path: Path = BOARD_DB) -> Optional[str]:
    """Un episodio consumido no revive por completar o archivar su tarjeta."""
    con = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        row = con.execute("SELECT id FROM tasks WHERE idempotency_key = ? ORDER BY id LIMIT 1",
                          (episode_key(cr),)).fetchone()
        return row[0] if row else None
    finally:
        con.close()


def existing_correction_card(pr_number: int, *, db_path: Path = BOARD_DB) -> Optional[str]:
    """Id de una tarjeta de corrección NO terminal para este PR, o None --
    "ya hay una corrección en curso, no apilar otra". Mira solo el título,
    con prefijo delimitado: una versión anterior también miraba el cuerpo y
    encontró su propio falso positivo contra el tablero real (una tarjeta
    de coordinación que solo menciona un número de PR de pasada)."""
    if not db_path.is_file():
        return None
    con = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "SELECT id, title FROM tasks WHERE title LIKE ? "
            "AND status NOT IN ('done', 'archived')",
            (f"%PR #{pr_number}%",),
        ).fetchall()
    finally:
        con.close()
    prefix = re.compile(rf"^corregir pr #{pr_number}(?!\d)")
    for task_id, title in rows:
        if prefix.match((title or "").strip().lower()):
            return task_id
    return None


def pr_info(pr_number: int) -> Optional[dict]:
    """None si GitHub no responde. El estado se comprueba aparte (M2):
    un PR cerrado/fusionado no debe resucitar una corrección."""
    try:
        return gh_json(["pr", "view", str(pr_number), "--repo", REPO,
                         "--json", "headRefName,title,state,headRefOid"])
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def assess_correction_episode(cr: ChangesRequested, *, db_path: Path = BOARD_DB) -> dict:
    """Una sola elegibilidad para trigger y vigilante; desconocido no es vacío."""
    consumed = episode_correction_card(cr, db_path=db_path)
    if consumed:
        return {"status": "consumed", "task_id": consumed}
    active = existing_correction_card(cr.pr, db_path=db_path)
    if active:
        return {"status": "active", "task_id": active}
    info = pr_info(cr.pr)
    if not isinstance(info, dict) or info.get("state") not in {"OPEN", "CLOSED", "MERGED"}:
        return {"status": "unknown", "reason": "estado de GitHub no comprobado"}
    if info["state"] != "OPEN":
        return {"status": "terminal"}
    head = info.get("headRefOid")
    if not isinstance(head, str) or re.fullmatch(r"[0-9a-f]{40}", head) is None or not info.get("headRefName"):
        return {"status": "unknown", "reason": "head/rama de GitHub no comprobados"}
    if head != cr.sha:
        return {"status": "diverged", "reason": "el head avanzó: requiere coordinación/re-revisión, no corrección ciega"}
    return {"status": "eligible", "info": info}


@dataclass
class Implementer:
    task_id: str
    assignee: str
    max_runtime_seconds: int


def resolve_implementer(cr: ChangesRequested, branch: str,
                         *, db_path: Path = BOARD_DB) -> tuple[Optional[Implementer], Optional[str]]:
    """Vincula el episodio a handoff+run previos, nunca al assignee mutable.

    Un evento posterior al comienzo de este run de revisión no sirve. Una
    rama reutilizada con productores incompatibles se abstiene, no se elige
    al más nuevo. No se inventa presupuesto ni una tarea productora ausente.
    """
    con = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        con.execute("BEGIN")
        review = con.execute("SELECT started_at FROM task_runs WHERE id=? AND task_id=?",
                             (cr.review_run_id, cr.review_task_id)).fetchone()
        if not review or not isinstance(review[0], (int, float)) or review[0] <= 0:
            return None, "no hay comienzo verificable del run de revisión"
        rows = con.execute(
            "SELECT e.task_id, e.payload, r.profile, r.max_runtime_seconds "
            "FROM task_events e JOIN task_runs r ON r.id=e.run_id AND r.task_id=e.task_id "
            "JOIN tasks t ON t.id=e.task_id "
            "WHERE e.kind='review_requested' AND r.outcome='review_requested' "
            "AND e.created_at<=? AND r.ended_at IS NOT NULL AND r.ended_at<=? "
            "AND (e.task_id=? OR t.branch_name=?) ORDER BY e.id DESC",
            (review[0], review[0], cr.review_task_id, branch),
        ).fetchall()
        # El handoff de la propia tarjeta prevalece sobre ramas históricas.
        direct = [r for r in rows if r[0] == cr.review_task_id]
        if direct:
            rows = direct[:1]
        candidates = set()
        for task_id, payload_raw, profile, budget in rows:
            try:
                payload = json.loads(payload_raw) if payload_raw else {}
            except (TypeError, ValueError):
                return None, "handoff ilegible, procedencia no comprobada"
            named = payload.get("implementer") if isinstance(payload, dict) else None
            if (not isinstance(profile, str) or not profile or profile in {"rafael", "alexis", "jose"}
                    or (named is not None and named != profile)):
                return None, "handoff no coincide con un run productor comprobable"
            if type(budget) is not int or budget <= 0:
                return None, "run productor sin presupuesto válido; no se inventa un reloj"
            candidates.add((task_id, profile, budget))
        if len(candidates) != 1:
            return None, "procedencia ausente o ambigua entre tareas/rondas de la rama"
        task_id, profile, budget = candidates.pop()
        return Implementer(task_id, profile, budget), None
    finally:
        con.close()


def format_findings(findings: Optional[dict]) -> Optional[str]:
    """None si no hay nada que listar en detalle. Maneja DOS formas reales
    de `findings` (corrección tras revisión de Alexis, M1): una lista de
    textos por severidad, o un recuento de enteros por severidad (la forma
    real que trajo la revisión de PR #330: {"critical":0,"high":0,
    "medium":2,"low":0}) -- la primera versión solo sabía leer la primera,
    y un recuento no vacío (`medium: 2`) hacía que se generara un bloque
    vacío "- 2" en vez de nada. Un entero se reporta como recuento con un
    aviso de que el detalle vive en el comentario de revisión, nunca
    inventado."""
    if not findings:
        return None
    lines = []
    for severity in ("critical", "high", "medium", "low"):
        items = findings.get(severity)
        if not items:
            continue
        label = severity.capitalize()
        if isinstance(items, list):
            lines.append(f"\n### {label}")
            for item in items:
                lines.append(f"- {item}")
        elif isinstance(items, int):
            lines.append(f"\n### {label}: {items} hallazgo(s) -- "
                          f"detalle en el comentario de revisión, no reproducido aquí")
        else:
            lines.append(f"\n### {label}")
            lines.append(f"- {items}")
    return "\n".join(lines) if lines else None


@dataclass
class CreatedCard:
    pr: int
    task_id: str
    assignee: str


def create_correction_card(cr: ChangesRequested, title: str, impl: Implementer) -> CreatedCard:
    """Crea sólo dentro del techo; nunca fabrica aprobación del exceso.

    El presupuesto del run productor es dato de procedencia, no permiso
    para superar el techo del flujo. Si no cabe, se abstiene y coordina.
    """
    if type(impl.max_runtime_seconds) is not int or not 0 < impl.max_runtime_seconds <= RUNTIME_CEILING:
        raise ValueError("presupuesto ausente/inválido o superior al techo: requiere coordinación humana; no se autoautoriza")
    findings_block = format_findings(cr.findings)
    body = (
        f"Creada automáticamente por correction_card_trigger.py al detectar "
        f"un veredicto CAMBIOS PEDIDOS sin tarjeta de corrección.\n\n"
        f"## Qué corregir\nPR #{cr.pr} -- {title}, SHA {cr.sha}. "
        f"Revisión: tarea {cr.review_task_id} (run {cr.review_run_id}).\n"
        f"{findings_block if findings_block else ''}\n"
        f"Resumen del revisor: {cr.summary}\n\n"
        f"## Encargo\nAplicar los hallazgos de arriba sobre el SHA citado, "
        f"sin reimplementar lo que ya pasó revisión. Al terminar, pedir "
        f"revisión independiente con `kanban_request_review(reviewer=<perfil>, ...)` "
        f"-- nunca omitir `reviewer`, nunca el propio perfil."
    )
    idempotency_key = episode_key(cr)
    cmd = [
        "bash", str(WRAPPER),
        "--board", "arky-maintenance",
        "--parent", cr.review_task_id,
        "--parent-reason", f"atiende el veredicto del episodio {idempotency_key}, no trabajo independiente",
        "--assignee", impl.assignee,
        "--max-runtime", str(impl.max_runtime_seconds),
        "--priority", str(BASE_PRIORITY),
        "--priority-reason", "corrección prioritaria de hallazgos pendientes antes de integrar la PR",
        "--max-retries", "0",
        "--workspace", "scratch",
        "--created-by", "correction-card-trigger",
        "--idempotency-key", idempotency_key,
        "--body", body,
    ]

    cmd += ["--json", "--", f"Corregir PR #{cr.pr}: {title}"]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=True)
    task = json.loads(out.stdout)
    return CreatedCard(cr.pr, task["id"], impl.assignee)


def _run_tick(argv: Optional[list[str]] = None) -> int:
    errors = []
    try:
        pending, prose_verdicts_seen = latest_changes_requested(db_path=BOARD_DB)
    except sqlite3.Error as exc:
        print(f"No se pudo leer el tablero: {type(exc).__name__}", file=sys.stderr)
        return 1

    created: list[CreatedCard] = []
    skipped_existing: list[int] = []
    skipped_not_open: list[int] = []
    skipped_no_implementer: list[int] = []
    skipped_ambiguous: list[tuple] = []

    for cr in pending:
        try:
            assessment = assess_correction_episode(cr, db_path=BOARD_DB)
            status = assessment["status"]
            if status in {"consumed", "active"}:
                skipped_existing.append(cr.pr)
                continue
            if status == "terminal":
                skipped_not_open.append(cr.pr)
                continue
            if status != "eligible":
                errors.append(cr.pr)
                print(f"#{cr.pr}: {assessment.get('reason', status)}", file=sys.stderr)
                continue
            info = assessment["info"]
            branch = info.get("headRefName")
            title = info.get("title", "")
            if not branch:
                skipped_no_implementer.append(cr.pr)
                continue
            impl, ambiguity = resolve_implementer(cr, branch, db_path=BOARD_DB)
            if ambiguity:
                skipped_ambiguous.append((cr.pr, ambiguity))
                continue
            if impl is None:
                skipped_no_implementer.append(cr.pr)
                continue
            card = create_correction_card(cr, title, impl)
            created.append(card)
        except (OSError, subprocess.SubprocessError, sqlite3.Error, ValueError, KeyError) as exc:
            errors.append(cr.pr)
            print(f"#{cr.pr}: tarjeta no confirmada ({type(exc).__name__})", file=sys.stderr)

    for c in created:
        print(f"#{c.pr} -> tarjeta de corrección {c.task_id}, asignada a {c.assignee}")
    if skipped_existing:
        print(f"{len(skipped_existing)} PR(s) con corrección activa o episodio ya consumido, sin tocar: {skipped_existing}")
    if skipped_not_open:
        print(f"{len(skipped_not_open)} PR(s) ya no están OPEN (cerrados/fusionados), sin tarjeta: {skipped_not_open}")
    if skipped_no_implementer:
        print(f"{len(skipped_no_implementer)} PR(s) sin tarea de implementación identificable, sin tarjeta: {skipped_no_implementer}")
    if skipped_ambiguous:
        for pr, reason in skipped_ambiguous:
            print(f"#{pr}: implementador ambiguo, sin tarjeta -- {reason}", file=sys.stderr)
    if prose_verdicts_seen:
        print(f"{prose_verdicts_seen} veredicto(s) en prosa detectados (no es inventario completo, ver docstring)")
    print(f"\n{len(created)} creada(s), {len(pending)} veredicto(s) de cambios pedidos vigentes en total.")
    return 1 if errors or skipped_ambiguous or skipped_no_implementer else 0


@contextmanager
def execution_lock():
    EXECUTION_LOCK.parent.mkdir(parents=True, exist_ok=True)
    with EXECUTION_LOCK.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def main(argv: Optional[list[str]] = None) -> int:
    # Exclusión compartida entre instancias de ESTE disparador; no es un
    # candado del dispatcher ni autoriza instalar/activar un cron.
    try:
        with execution_lock():
            return _run_tick(argv)
    except BlockingIOError:
        print("otra instancia del disparador ya está comprobando; no se duplica")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
