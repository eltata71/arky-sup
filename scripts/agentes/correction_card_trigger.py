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

## De dónde sale el veredicto

De `task_runs.metadata`, el esquema canónico que la skill ya exige:
`{"verdict": "changes_requested", "sha": "<40 hex>", "pr": <int>, ...}`.
Se toma el run más reciente (por `id`, no por fecha de texto) que declare un
`pr` entero, uno por PR -- si la ronda más reciente de ese PR es
`"approved"`, no hay nada que corregir y no se crea nada. Una revisión sin
metadata estructurada (todavía las hay: formato libre, previo a la skill de
hoy) no se procesa aquí -- no se adivina un veredicto de una frase en prosa.
Es un hueco conocido, no un error silencioso: `legacy_verdicts_skipped` lo
cuenta en la salida.

## Quién es el implementador

Nunca se inventa. Se busca una tarea de Kanban (cualquier estado) cuyo
`branch_name` coincida con el `headRefName` real del PR en GitHub -- la
misma tarea cuyo trabajo se está corrigiendo. Si no existe ninguna (un PR
abierto fuera del flujo de tareas, como los que abre un agente de
mantenimiento sin tarjeta propia), no se crea nada y se informa por qué: una
tarjeta de corrección sin saber a quién corregir sería una conjetura.

## Idempotencia

Antes de crear una tarjeta para el PR #<N>, busca si ya existe una **no
terminal** (ready/todo/triage/blocked/running) cuyo título empiece por
"Corregir PR #<N>" (prefijo con delimitador, no subcadena -- el mismo bug
que pr_review_trigger.py tuvo que corregir con "#32" vs "#3"). Si existe,
no hace nada: ya hay una corrección en curso, apilar otra no ayuda. Si solo
existen tarjetas `done`/`archived` para ese número, sí crea una nueva --- es
la siguiente ronda, no un duplicado.

## El reloj y la prioridad nunca se omiten

Igual que `crear-tarea-hija.sh`: cada tarjeta nace con `--max-runtime`
heredado de la tarea de implementación original (la misma que ya hacía ese
trabajo, así que ya demostró cuánto necesita) y con `--parent` apuntando a
la tarea de revisión que emitió el veredicto -- la corrección es, de hecho,
una continuación de ese hallazgo, y el enlace lo hace trazable sin tener
que leer el comentario para saber de dónde salió.

## Qué desencadena -- el aviso si el disparador deja de funcionar

Igual que `prs_without_review_card` en `estado-fabrica.py`: si un veredicto
de cambios pedidos lleva más de 4 horas sin una tarjeta de corrección no
terminal, el vigilante lo dice. Detectar y avisar son trabajos distintos a
propósito.
"""
from __future__ import annotations

import json
import re
import subprocess
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

REPO = "eltata71/arky-sup"
BOARD_DB = Path.home() / ".hermes" / "kanban" / "boards" / "arky-maintenance" / "kanban.db"
DEFAULT_MAX_RUNTIME = 1800
BASE_PRIORITY = 80


def gh_json(args: list[str]):
    out = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=60, check=True)
    return json.loads(out.stdout)


@dataclass
class ChangesRequested:
    pr: int
    sha: str
    review_task_id: str
    findings: Optional[dict]
    summary: str
    ended_at: Optional[int]


def latest_changes_requested(*, db_path: Path = BOARD_DB) -> tuple[list[ChangesRequested], int]:
    """Una entrada por PR -- la ronda más reciente que declare `pr` en su
    metadata, filtrada a verdict == changes_requested. Las filas se leen en
    orden descendente de `id` (autoincremental, nunca ambiguo como una
    fecha de texto), así que la primera vez que se ve un `pr` es siempre su
    ronda más reciente. Devuelve también cuántos runs de revisión tenían un
    veredicto en prosa, sin metadata estructurada -- un hueco conocido, no
    un error."""
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
    legacy_skipped = 0
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
            if verdict in ("CAMBIOS PEDIDOS", "APROBADO"):
                legacy_skipped += 1
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
            pr=pr, sha=sha, review_task_id=task_id,
            findings=meta.get("findings") if isinstance(meta.get("findings"), dict) else None,
            summary=summary or "", ended_at=ended_at,
        ))
    return out, legacy_skipped


def existing_correction_card(pr_number: int, *, db_path: Path = BOARD_DB) -> Optional[str]:
    """Id de una tarjeta de corrección NO terminal para este PR, o None.
    Una ya `done`/`archived` no cuenta -- la siguiente ronda sí debe poder
    crear una tarjeta nueva.

    Mira **solo el título**, con el mismo prefijo con delimitador que
    `pr_review_trigger.py` ya usa para las suyas -- deliberado, no un
    descuido: la primera versión de esta función también miraba el cuerpo,
    para cubrir una tarjeta histórica (`t_513cbd5a`, la de #312) cuyo
    título no mencionaba el número. Probándolo contra el tablero real
    encontró su propio falso positivo en la primera pasada: una tarjeta de
    coordinación de José que solo *menciona* "PR #312" de pasada quedó
    marcada como su corrección. El cuerpo de una tarjeta es prosa libre y
    cualquiera puede citar un número ahí sin que la tarjeta sea sobre eso;
    el título de una tarjeta que este script crea nunca lo es. La tarjeta
    histórica se renombró una vez (no es un patrón a mantener) para incluir
    "PR #312" en su título; de aquí en adelante toda corrección nace así."""
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


def pr_head_ref(pr_number: int) -> Optional[str]:
    try:
        data = gh_json(["pr", "view", str(pr_number), "--repo", REPO, "--json", "headRefName,title"])
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    return data


def implementer_for_branch(branch_name: str, *, db_path: Path = BOARD_DB) -> Optional[tuple[str, str, int]]:
    """(task_id, assignee, max_runtime_seconds) de la tarea cuyo
    `branch_name` coincide -- nunca se inventa un implementador."""
    if not db_path.is_file():
        return None
    con = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        row = con.execute(
            "SELECT id, assignee, max_runtime_seconds FROM tasks WHERE branch_name = ? "
            "AND assignee IS NOT NULL ORDER BY created_at DESC LIMIT 1",
            (branch_name,),
        ).fetchone()
    finally:
        con.close()
    if row is None:
        return None
    return row[0], row[1], row[2] or DEFAULT_MAX_RUNTIME


def format_findings(findings: Optional[dict]) -> str:
    if not findings:
        return ""
    lines = []
    for severity in ("critical", "high", "medium", "low"):
        items = findings.get(severity)
        if not items:
            continue
        lines.append(f"\n### {severity.capitalize()}")
        for item in items if isinstance(items, list) else [items]:
            lines.append(f"- {item}")
    return "\n".join(lines)


@dataclass
class CreatedCard:
    pr: int
    task_id: str
    assignee: str


def create_correction_card(cr: ChangesRequested, title: str, impl_task: str, assignee: str, max_runtime: int) -> CreatedCard:
    findings_block = format_findings(cr.findings)
    body = (
        f"Creada automáticamente por correction_card_trigger.py al detectar "
        f"un veredicto CAMBIOS PEDIDOS sin tarjeta de corrección.\n\n"
        f"## Qué corregir\nPR #{cr.pr} -- {title}, SHA {cr.sha}. "
        f"Revisión: tarea {cr.review_task_id}.\n"
        f"{findings_block if findings_block else f'Resumen del revisor: {cr.summary}'}\n\n"
        f"## Encargo\nAplicar los hallazgos de arriba sobre el SHA citado, "
        f"sin reimplementar lo que ya pasó revisión. Al terminar, pedir "
        f"revisión independiente con `kanban_request_review(reviewer=<perfil>, ...)` "
        f"-- nunca omitir `reviewer`, nunca el propio perfil."
    )
    out = subprocess.run(
        [
            "hermes", "--profile", "arkysupabase", "kanban", "--board", "arky-maintenance", "create",
            f"Corregir PR #{cr.pr}: {title}",
            "--body", body,
            "--assignee", assignee,
            "--parent", cr.review_task_id,
            "--workspace", "scratch",
            "--priority", str(BASE_PRIORITY),
            "--max-runtime", str(max_runtime),
            "--max-retries", "2",
            "--created-by", "correction-card-trigger",
            "--json",
        ],
        capture_output=True, text=True, timeout=60, check=True,
    )
    task = json.loads(out.stdout)
    return CreatedCard(cr.pr, task["id"], assignee)


def main(argv: Optional[list[str]] = None) -> int:
    errors = []
    try:
        pending, legacy_skipped = latest_changes_requested()
    except sqlite3.Error as exc:
        print(f"No se pudo leer el tablero: {type(exc).__name__}", file=sys.stderr)
        return 1

    created: list[CreatedCard] = []
    skipped_existing: list[int] = []
    skipped_no_implementer: list[int] = []

    for cr in pending:
        try:
            if existing_correction_card(cr.pr):
                skipped_existing.append(cr.pr)
                continue
            pr_info = pr_head_ref(cr.pr)
            if pr_info is None:
                errors.append(cr.pr)
                print(f"#{cr.pr}: no se pudo leer de GitHub", file=sys.stderr)
                continue
            branch = pr_info.get("headRefName")
            title = pr_info.get("title", "")
            impl = implementer_for_branch(branch) if branch else None
            if impl is None:
                skipped_no_implementer.append(cr.pr)
                continue
            impl_task, assignee, max_runtime = impl
            card = create_correction_card(cr, title, impl_task, assignee, max_runtime)
            created.append(card)
        except (OSError, subprocess.SubprocessError, sqlite3.Error, ValueError, KeyError) as exc:
            errors.append(cr.pr)
            print(f"#{cr.pr}: tarjeta no confirmada ({type(exc).__name__})", file=sys.stderr)

    for c in created:
        print(f"#{c.pr} -> tarjeta de corrección {c.task_id}, asignada a {c.assignee}")
    if skipped_existing:
        print(f"{len(skipped_existing)} PR(s) ya tenían corrección activa, sin tocar: {skipped_existing}")
    if skipped_no_implementer:
        print(f"{len(skipped_no_implementer)} PR(s) sin tarea de implementación identificable, sin tarjeta: {skipped_no_implementer}")
    if legacy_skipped:
        print(f"{legacy_skipped} veredicto(s) en prosa sin metadata estructurada, no procesados")
    print(f"\n{len(created)} creada(s), {len(pending)} veredicto(s) de cambios pedidos vigentes en total.")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
