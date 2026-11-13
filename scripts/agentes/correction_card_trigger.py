#!/usr/bin/env python3
"""Dispara una tarjeta de corrección en cuanto una revisión deja veredicto
CAMBIOS PEDIDOS -- el espejo de pr_review_trigger.py. Ese script cerró "abrir
un PR no crea su tarjeta de revisión"; este cierra el hueco gemelo: un
veredicto de cambios pedidos tampoco creaba nada por sí solo, así que el
trabajo quedaba esperando a que alguien (hasta ahora, un humano o Claude)
leyera el comentario y abriera la tarjeta a mano.

No llama a un modelo -- solo `gh`, el tablero Kanban `arky-maintenance` y los
metadatos estructurados que la skill canónica ya pide a cada revisor
(`verdict`/`sha`/`pr`, más `findings` cuando el revisor los declara). Mismo
patrón que estado-fabrica.py / auto_merge_watch.py / pr_review_trigger.py:
corre fuera del alcance de Hermes, vía el mismo crontab de sistema.

## Por qué esto, y no arreglar `kanban_request_changes`

El motor instalado (v0.22.2) tiene una herramienta nativa para esto
-- `kanban_request_changes`, devolver el run de revisión al implementador --
y falla con "review handoff has no valid implementer provenance" en al
menos un caso real (`t_d1ad10c7`, 6 crashes). Hermes es software de
terceros y no se modifica (la misma razón que ya dio RG-09 para la
autorrevisión). Este script no pelea con esa limitación: la rodea. No
necesita que el motor traspase el veredicto si el veredicto genera trabajo
nuevo por sí mismo, con una tarjeta corriente que el despachador ya sabe
entregar.

## El EPISODIO, no el PR, es la unidad -- corrección tras revisión de Alexis
(2026-11-13, PR #331, H1)

La primera versión identificaba el trabajo pendiente por número de PR:
"¿hay ya una corrección activa para el PR N?". Eso confunde dos preguntas
distintas -- *qué PR tiene trabajo pendiente* (sí es por PR) y *qué
veredicto concreto ya generó una tarjeta* (es por RONDA de revisión, no por
PR). Una corrección que se cierra `done` sin que exista todavía una
aprobación estructurada posterior no demuestra una ronda nueva: el mismo
veredicto histórico seguiría generando otra tarjeta en el siguiente tick,
indefinidamente. Y dos invocaciones concurrentes pueden leer ambas "no
existe" antes de que ninguna termine de crear.

La identidad real de un episodio es `(review_task_id, review_run_id)` --
una fila de `task_runs`, inmutable una vez escrita. Se usa como
`--idempotency-key` nativo de Hermes (`create --idempotency-key`, que el
propio motor documenta como "si ya existe una tarea no archivada con esta
clave, devuelve su id en vez de duplicar"): el motor, no este script,
decide atómicamente si dos invocaciones concurrentes crean la misma
tarjeta o se reparten el mismo id. Una ronda nueva (`run_id` distinto)
tiene una clave distinta y sí puede crear su propia tarjeta, aunque la
anterior ya esté `done`. El filtro "¿hay ya una corrección ACTIVA para
este PR?" se conserva como capa aparte -- no apilar una segunda corrección
mientras la primera sigue en curso -- pero ya no es la única defensa contra
la duplicación.

## Quién es el implementador -- corrección tras revisión de Alexis (H2)

La primera versión leía `assignee` de la tarea cuyo `branch_name` coincide
con la rama del PR, asumiendo que el dueño actual de la tarjeta es quien
implementó. Falso en el flujo real: `assignee` es el dueño ACTUAL, que
cambia con una reasignación o una revisión -- el propio Alexis lo
demostró con `t_d1ad10c7`, asignada a `rafael` mientras el historial
identifica a `lucia` como productora.

La fuente correcta es el evento `review_requested` de la propia ronda de
revisión: lleva un campo `implementer` escrito en el momento exacto en que
se pidió esa revisión, antes de que nada pudiera reasignar la tarjeta.
Cuando ese campo falta (pasa: `t_d1ad10c7` lo tiene nulo en su ronda más
reciente) se cae al `branch_name`, pero entonces se exige una respuesta
INEQUÍVOCA -- si dos tareas con asignees distintos comparten esa rama, se
informa la ambigüedad y no se crea nada. Nunca se elige silenciosamente
"la más nueva".

## Idempotencia por título, además -- sigue vigente

Antes de crear, también se busca si ya existe una tarjeta **no terminal**
cuyo título empiece por "Corregir PR #<N>" (prefijo con delimitador, no
subcadena). Probarlo contra el tablero real encontró su propio falso
positivo cuando una primera versión también miraba el cuerpo -- una
tarjeta de coordinación que solo *menciona* un número de PR de pasada
quedó marcada como su corrección. Se revirtió a título-solo.

## El reloj y la prioridad nunca se omiten, por el camino canónico

La primera versión llamaba a `hermes kanban create` directamente, sin
pasar por `crear-tarea-hija.sh` -- la misma puerta nativa que el propio
canónico (`SKILL.md`, paso 3) prohíbe para planificar precisamente porque
no exige reloj. Corregido (M3): toda tarjeta nace por el envoltorio, con
`--max-runtime` heredado de la tarea de implementación original (ya
demostró cuánto necesita) y, cuando eso supera el techo de 300s del paso 5
-- el caso normal para una corrección que corre el mismo gate -- con
`--override-ceiling-reason` explícito y auditable, no un valor inventado
en silencio.

## Qué desencadena -- el aviso si el disparador deja de funcionar

Igual que `prs_without_review_card` en `estado-fabrica.py`: si un veredicto
de cambios pedidos lleva más de 4 horas sin una tarjeta de corrección no
terminal, el vigilante lo dice. Detectar y avisar son trabajos distintos a
propósito.

## Lo que NO se ejecutó, y por qué

Las pruebas de este script fueron de lectura: las funciones que consultan
el tablero y GitHub, contra los 14 veredictos reales vigentes. `main()` no
se ejecutó contra el tablero real -- crearía tarjetas de verdad -- y,
señalado por la propia revisión independiente, las cuatro funciones de
lectura no bastan para certificar `main()`/`create_correction_card()`: hace
falta un ensayo con `gh`/Hermes simulados y una base de datos de fixture,
sin tocar el tablero operativo, antes de instalarlo en cron. Queda
pendiente, declarado, no asumido.
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
            "WHERE outcome = 'completed' ORDER BY id DESC"
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
        if not isinstance(pr, int) or verdict not in ("approved", "changes_requested"):
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
    """Crea por el envoltorio canónico (`crear-tarea-hija.sh`), nunca por
    `hermes kanban create` directo (corrección tras revisión de Alexis,
    M3): esa puerta nativa no exige reloj, y es precisamente la que el
    canónico (SKILL.md, paso 3) prohíbe para planificar. El envoltorio
    exige `--override-ceiling-reason` por encima de 300s -- el caso normal
    aquí, porque una corrección corre el mismo gate que la implementación
    original -- y aquí se declara, auditable, en vez de inventarse en
    silencio."""
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
