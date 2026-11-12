#!/usr/bin/env python3
"""Dispara una tarjeta de revisión en cuanto un PR abierto no tiene una --
el circuito que faltaba. Antes de este script, 11 de los PRs abiertos
llevaban hasta 19 días sin que nadie le pidiera veredicto a Rafael o Alexis,
no porque revisaran lento (una revisión real tarda 1-10 minutos), sino
porque abrir un PR no disparaba nada: la tarjeta había que crearla a mano.

No llama a un modelo -- solo `gh` y el tablero Kanban `arky-maintenance`.
Mismo patrón que estado-fabrica.py / auto_merge_watch.py: corre fuera del
alcance de Hermes, vía el mismo crontab de sistema.

## Idempotencia

Antes de crear una tarjeta para el PR #<N>, busca si ya existe una cuyo
título empiece por "Revisión PR #<N>" (ignorando mayúsculas) en el tablero.
Si existe, no hace nada -- nunca duplica. Es lo primero que pedía Jose, y
lo primero que se rompe en este tipo de automatismos si no se comprueba
explícitamente antes de escribir.

## Reparto Rafael / Alexis -- por CARGA, no por turno fijo

Cuenta cuántas tarjetas "Revisión PR #..." tiene cada uno hoy en un estado
no terminal (todo/triage/ready/blocked/running -- nunca done/archived) y
asigna al que tenga MENOS. Un empate se rompe por la paridad del número de
PR (par -> Rafael, impar -> Alexis), para que el reparto no dependa del
orden en que `gh pr list` devuelva los PRs.

Por qué por carga y no por turno: responde directamente a "si uno está
saturado... que no se quede la cola parada esperándole" -- un revisor con
la cola llena deja de recibir trabajo nuevo sin que nadie tenga que
decidirlo caso por caso. Límite reconocido, no resuelto aquí: esto no
detecta un perfil "caído" (crasheado) de forma distinta a "con la cola
larga" -- las dos se ven igual desde esta cuenta. Si eso resulta
insuficiente en la práctica, hace falta una señal de salud de perfil
aparte (p. ej. consecutive_failures alto), no está construida todavía.

## Qué desencadena -- el aviso si el disparador deja de funcionar

Este script no se vigila a sí mismo: eso es trabajo de
`estado-fabrica.py` (ver `pr_abierto_sin_revision`, que usa el mismo
umbral de 4 horas que el resto de sus chequeos). Si este script deja de
correr, un PR sin tarjeta pasadas 4 horas lo dice el vigilante, no el
silencio.
"""
from __future__ import annotations

import json
import subprocess
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

REPO = "eltata71/arky-sup"
BOARD_DB = Path.home() / ".hermes" / "kanban" / "boards" / "arky-maintenance" / "kanban.db"
REVIEWERS = ("rafael", "alexis")
DEFAULT_MAX_RUNTIME = 1500
BASE_PRIORITY = 70


def gh_json(args: list[str]):
    out = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=60, check=True)
    return json.loads(out.stdout)


def open_prs() -> list[dict]:
    return gh_json([
        "pr", "list", "--repo", REPO, "--state", "open",
        "--json", "number,title,createdAt",
    ])


def pr_diff_names(pr_number: int) -> list[str]:
    out = subprocess.run(
        ["gh", "pr", "diff", str(pr_number), "--repo", REPO, "--name-only"],
        capture_output=True, text=True, timeout=60, check=True,
    )
    return [l for l in out.stdout.splitlines() if l.strip()]


def existing_review_task(pr_number: int, *, db_path: Path = BOARD_DB) -> Optional[str]:
    """None si no existe ya una tarjeta de revisión para este PR --
    idempotencia. Compara el PREFIJO del título, no una subcadena: el
    título de la revisión de #297 menciona "#316" en su cuerpo del texto
    ("depende de #316"), y una subcadena ingenua lo confundiría con una
    tarjeta de #316."""
    if not db_path.is_file():
        return None
    con = sqlite3.connect(str(db_path))
    try:
        cur = con.cursor()
        cur.execute("SELECT id, title FROM tasks WHERE title LIKE ?", (f"%PR #{pr_number}%",))
        prefix = f"revisión pr #{pr_number}"
        for task_id, title in cur.fetchall():
            if (title or "").strip().lower().startswith(prefix):
                return task_id
        return None
    finally:
        con.close()


def reviewer_load(profile: str, *, db_path: Path = BOARD_DB) -> int:
    if not db_path.is_file():
        return 0
    con = sqlite3.connect(str(db_path))
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM tasks WHERE assignee = ? AND title LIKE 'Revisión PR #%' "
            "AND status NOT IN ('done', 'archived')",
            (profile,),
        )
        return cur.fetchone()[0]
    finally:
        con.close()


def pick_reviewer(pr_number: int) -> str:
    loads = {p: reviewer_load(p) for p in REVIEWERS}
    if loads["rafael"] != loads["alexis"]:
        return min(loads, key=loads.get)
    return "rafael" if pr_number % 2 == 0 else "alexis"


def detect_overlaps(pr_number: int, files: set[str], all_prs_files: dict[int, set[str]]) -> list[int]:
    """Otros PRs abiertos que comparten al menos un fichero -- nota en el
    cuerpo, no un --parent duro: una revisión puede correr en paralelo con
    otra, es el ORDEN DE FUSIÓN el que importa, no el de revisión (lección
    de hoy con el bug del --parent perdido)."""
    overlapping = []
    for other_n, other_files in all_prs_files.items():
        if other_n == pr_number:
            continue
        if files & other_files:
            overlapping.append(other_n)
    return sorted(overlapping)


@dataclass
class CreatedCard:
    pr_number: int
    task_id: str
    assignee: str


def create_review_card(pr: dict, files: list[str], overlaps: list[int]) -> CreatedCard:
    n = pr["number"]
    assignee = pick_reviewer(n)
    overlap_note = (
        f"\n\n## Posible conflicto de ficheros\nComparte al menos un fichero con: "
        f"{', '.join(f'#{o}' for o in overlaps)}. Revisar en paralelo es correcto; "
        f"es el ORDEN DE FUSIÓN el que debe respetar esto, no el de revisión."
        if overlaps else ""
    )
    body = (
        f"Creada automáticamente por pr_review_trigger.py al detectar que #{n} "
        f"estaba abierto sin tarjeta de revisión.\n\n"
        f"## Qué hace\nPR #{n} -- {pr['title']}. Abierto {pr['createdAt']}. "
        f"{len(files)} fichero(s) en el diff.\n\n"
        f"## Encargo\nRevisión independiente: veredicto APROBADO o CAMBIOS PEDIDOS, "
        f"sobre el SHA actual exacto, con hallazgos concretos y accionables "
        f"-- no \"atender observaciones\" en abstracto.{overlap_note}"
    )
    runtime = DEFAULT_MAX_RUNTIME + min(len(files), 20) * 30
    out = subprocess.run(
        [
            "hermes", "--profile", "arkysupabase", "kanban", "--board", "arky-maintenance", "create",
            f"Revisión PR #{n}: {pr['title']}",
            "--body", body,
            "--assignee", assignee,
            "--workspace", "scratch",
            "--priority", str(BASE_PRIORITY),
            "--max-runtime", str(runtime),
            "--max-retries", "2",
            "--created-by", "pr-review-trigger",
            "--json",
        ],
        capture_output=True, text=True, timeout=60, check=True,
    )
    task = json.loads(out.stdout)
    return CreatedCard(n, task["id"], assignee)


def main(argv: Optional[list[str]] = None) -> int:
    prs = open_prs()
    all_files = {pr["number"]: set(pr_diff_names(pr["number"])) for pr in prs}
    created: list[CreatedCard] = []
    skipped: list[int] = []
    for pr in prs:
        n = pr["number"]
        existing = existing_review_task(n)
        if existing:
            skipped.append(n)
            continue
        overlaps = detect_overlaps(n, all_files[n], all_files)
        card = create_review_card(pr, list(all_files[n]), overlaps)
        created.append(card)

    for c in created:
        print(f"#{c.pr_number} -> tarjeta nueva {c.task_id}, asignada a {c.assignee}")
    if skipped:
        print(f"{len(skipped)} PR(s) ya tenían tarjeta, sin tocar: {skipped}")
    print(f"\n{len(created)} creada(s), {len(skipped)} ya existían, {len(prs)} PRs abiertos en total.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
