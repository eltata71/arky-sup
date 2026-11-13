#!/usr/bin/env python3
"""Fusión automática graduada para PRs de bajo riesgo -- aprobados por Rafael
o Alexis, con CI verde, sobre rutas que una decisión escrita autorizó.

No es un cron de Hermes: corre fuera de su alcance (mismo patrón que
estado-fabrica.py), vía `gh` y el tablero Kanban `arky-maintenance`. Nunca
llama a un modelo -- toda la decisión es verificable por regla.

## Por qué existe (decisión de Jose, 2026-11-12)

"de acuerdo con tu sugerencia y argumentos, hagamos esa fusión automática de
manera gradual, para continuar con los controles existentes que han sido
efectivos, pásame lo que tenga un riesgo alto" -- la fábrica no debe esperar
a que una persona note un PR aprobado con CI verde, pero tampoco debe poder
fusionar nada por su cuenta en el primer día ni tocar nada que roce permisos,
seguridad o el motor de Hermes.

## La condición primera -- "el visto bueno de Rafael y Alexis es
## prerrequisito para poder realizar una fusión automática" (Jose, 2026-11-12)

Ver `check_current_approval` y el bloque de comentario que la precede en el
código: es la PRIMERA cosa que `evaluate_pr` comprueba, antes de clasificar
rutas, antes de mirar CI, antes de nada. No es una clase de riesgo ni un
parámetro del libro de decisiones -- es estructura. Nada en este fichero la
desactiva.

## Las tres clasificaciones, en ese orden

1. **ALTO_RIESGO** -- cualquier ruta en `SIEMPRE_ALTO_RIESGO`, o el diff/título/
   cuerpo del PR menciona módulos internos del motor instalado
   (`_CONTENIDO_MOTOR_RE`). Nunca se fusiona; va a Jose siempre, sin excepción
   y sin importar quién aprobó.
2. **Una clase habilitada** (hoy solo A1: `__tests__/`, `tests/`,
   `scripts/agentes/tests/`, y `docs/*.md` fuera de `docs/operacion/`) --
   candidato a fusión automática si además hay veredicto APROBADO sobre el
   SHA actual y CI verde.
3. **Cualquier ruta que no caiga en ninguna de las anteriores** -- también
   ALTO_RIESGO. Fallar cerrado: una ruta nueva que nadie clasificó todavía no
   se asume de bajo riesgo por omisión.

## Qué clases están habilitadas, y por qué no es un parámetro

`auto-merge-decisions.log` es un libro de registro de solo apéndice: cada
línea que habilita o retira una clase tiene que escribirse en una frase
completa y fechada (`DECISION <fecha-ISO> <quien> AUTORIZA clase=<X>
motivo="..."`). Las clases habilitadas son la unión de todo lo autorizado
menos lo revocado después -- nunca un booleano en un YAML que alguien sube
sin pensarlo. Un libro con una línea que no cumple el formato exacto hace que
el script se niegue a fusionar nada, de cualquier clase (falla cerrado).

## El freno

Antes de fusionar: `main` tiene que estar verde ya (si no, no se fusiona
nada -- no se amplía un problema existente).
Después de cada fusión: la SIGUIENTE ejecución comprueba el CI de ese commit
de fusión sobre `main`. Si viene en rojo, escribe `auto-merge-DISABLED` --
un fichero cuya sola presencia bloquea TODA fusión automática, de cualquier
clase, hasta que una persona lo revise y lo borre a mano.

## Dos guardas de escritura, independientes entre sí

`--live` en la línea de comandos Y el fichero `auto-merge-ENABLED` presente.
Sin las dos, el script siempre corre en seco: informa qué habría hecho, no
toca nada. Ninguna de las dos existe todavía -- se activan aparte, después
de que Rafael o Alexis revisen este código y Jose apruebe el PR.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import subprocess
import sqlite3
import sys
import time
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

REPO = "eltata71/arky-sup"
BOARD_DB = Path.home() / ".hermes" / "kanban" / "boards" / "arky-maintenance" / "kanban.db"
LOG_DIR = Path.home() / ".hermes" / "logs"
JSONL_LOG = LOG_DIR / "auto-merges.jsonl"
DECISIONS_LOG = LOG_DIR / "auto-merge-decisions.log"
KILL_SWITCH = LOG_DIR / "auto-merge-DISABLED"
WRITE_ENABLED_MARKER = LOG_DIR / "auto-merge-ENABLED"
PENDING_BREAKER_CHECK = LOG_DIR / "auto-merge-pending-breaker-check.json"
EXECUTION_LOCK = LOG_DIR / "auto-merge.lock"
SHA_RE = re.compile(r"[0-9a-f]{40}")
REQUIRED_CHECKS = {
    "Static gates (typecheck + lint + budgets + build)",
    "Merged coverage (thresholds)",
    "CodeQL (JavaScript/TypeScript)",
    "Dependency audit",
    "Playwright smoke (desktop + iPad)",
    *(f"Vitest (shard {n}/4)" for n in range(1, 5)),
}
DEPLOY_CHECK = "Deploy to Vercel (production)"

# ---------------------------------------------------------------------------
# Clasificación por rutas -- SIEMPRE_ALTO_RIESGO gana sobre cualquier clase.
# ---------------------------------------------------------------------------

SIEMPRE_ALTO_RIESGO_PREFIXES = (
    "scripts/agentes/skills/",
    ".github/workflows/",
    "supabase/migrations/",
    "api/",
    ".vercel/",
)
SIEMPRE_ALTO_RIESGO_EXACT = (
    "vercel.json",
    "package.json",
    "package-lock.json",
    "docs/operacion/despliegue.json",
)
SIEMPRE_ALTO_RIESGO_SUBSTR = (
    "allowlist",  # command_allowlist*, shell-hooks-allowlist.json, *allowlist*
)

# Rutas de la clase A1 -- la única habilitada hoy. Ver DECISIONS_LOG.
CLASS_A1_PREFIXES = (
    "__tests__/",
    "tests/",
    "scripts/agentes/tests/",
)
# docs/*.md excepto docs/operacion/ -- moldea el comportamiento de varios
# perfiles a la vez, se deja fuera de A1 a propósito (más estrecho primero).
CLASS_A1_DOCS_EXCLUDE_PREFIX = "docs/operacion/"

# Menciones a módulos internos del motor instalado -- fuerza ALTO_RIESGO sin
# importar qué rutas toca el PR (caso #319: el diff no tocaba el motor, pero
# el TEXTO hacía afirmaciones falsas sobre él).
_CONTENIDO_MOTOR_RE = re.compile(
    r"\b(delegation_context|kanban_tools\w*|kanban_create|"
    r"_reject_delegated_child_mutation|"
    r"scrub_kanban_env|gateway[./]kanban|hermes_cli|motor de hermes|"
    r"hermes-agent-v\d)\b",
    re.IGNORECASE,
)

_VERDICT_RE = re.compile(
    r"Veredicto:\s*(APROBADO|CAMBIOS PEDIDOS)\b.*?\bsobre\s+([0-9a-f]{7,40})",
    re.IGNORECASE | re.DOTALL,
)

_DECISION_LINE_RE = re.compile(
    r"^DECISION\s+(\S+)\s+(\S+)\s+(AUTORIZA|REVOCA)\s+clase=([A-Za-z0-9]+)\s+motivo=\"(.+)\"\s*$"
)


def _is_siempre_alto_riesgo(path: str) -> bool:
    if path in SIEMPRE_ALTO_RIESGO_EXACT:
        return True
    if path.startswith(SIEMPRE_ALTO_RIESGO_PREFIXES):
        return True
    low = path.lower()
    return any(s in low for s in SIEMPRE_ALTO_RIESGO_SUBSTR)


def _is_class_a1(path: str) -> bool:
    if path.startswith(CLASS_A1_PREFIXES):
        return True
    if path.startswith("docs/") and path.endswith(".md") and not path.startswith(CLASS_A1_DOCS_EXCLUDE_PREFIX):
        return True
    return False


CLASS_MATCHERS = {"A1": _is_class_a1}


@dataclass
class Classification:
    risk_class: str  # "ALTO_RIESGO" or a class name like "A1"
    reason: str


def classify_paths(files: list[str], *, enabled_classes: set[str]) -> Classification:
    """Pure function: no I/O. Deny-list and unmatched paths both win as
    ALTO_RIESGO -- never assume low risk by omission."""
    if not files:
        return Classification("ALTO_RIESGO", "sin ficheros en el diff (no debería pasar)")
    for f in files:
        if _is_siempre_alto_riesgo(f):
            return Classification("ALTO_RIESGO", f"ruta vetada siempre: {f}")
    unmatched = [f for f in files if not any(
        name in enabled_classes and matcher(f) for name, matcher in CLASS_MATCHERS.items()
    )]
    if unmatched:
        return Classification(
            "ALTO_RIESGO",
            f"{len(unmatched)} ruta(s) no clasificada(s) en ninguna clase habilitada "
            f"({enabled_classes or 'ninguna'}): {unmatched[:5]}",
        )
    return Classification("A1", "todas las rutas caen en la clase A1 habilitada")


def content_backstop_hit(*, title: str, body: str, diff_text: str) -> Optional[str]:
    for label, text in (("título", title), ("cuerpo", body), ("diff", diff_text)):
        m = _CONTENIDO_MOTOR_RE.search(text or "")
        if m:
            return f"menciona '{m.group(0)}' en el {label} -- roza el motor de Hermes"
    return None


# ---------------------------------------------------------------------------
# Libro de decisiones -- qué clases están habilitadas, nunca un booleano.
# ---------------------------------------------------------------------------

@dataclass
class DecisionLedgerError(Exception):
    line_no: int
    line: str

    def __str__(self) -> str:
        return f"línea {self.line_no} no cumple el formato DECISION: {self.line!r}"


def enabled_classes_from_ledger(path: Path = DECISIONS_LOG) -> set[str]:
    """Clases habilitadas = unión de AUTORIZA menos lo REVOCA-do después, en
    orden del fichero. Una sola línea mal formada hace fallar TODO el libro
    (cerrado, no una clase a medias) -- se prefiere no fusionar nada a
    interpretar un libro que no se puede parsear con certeza."""
    if not path.is_file():
        return set()
    enabled: set[str] = set()
    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _DECISION_LINE_RE.match(line)
        if not m:
            raise DecisionLedgerError(line_no, line)
        fecha, quien, accion, clase, motivo = m.groups()
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})", fecha):
                raise ValueError("fecha ISO con zona requerida")
            if fecha[-6:-5] in ("+", "-") and (int(fecha[-5:-3]) > 23 or int(fecha[-2:]) > 59):
                raise ValueError("zona inválida")
            if datetime.fromisoformat(fecha).utcoffset() is None:
                raise ValueError("zona requerida")
            if quien != "jose" or not motivo.strip() or clase not in CLASS_MATCHERS:
                raise ValueError("actor, motivo o clase inválidos")
        except ValueError:
            raise DecisionLedgerError(line_no, line) from None
        if accion == "AUTORIZA":
            enabled.add(clase)
        else:
            enabled.discard(clase)
    return enabled


# ---------------------------------------------------------------------------
# `gh` / `git` -- aislado en funciones pequeñas para poder sustituirlas en
# pruebas sin tocar la lógica de decisión.
# ---------------------------------------------------------------------------

def gh_pr_view(pr_number: int, fields: str):
    out = subprocess.run(
        ["gh", "pr", "view", str(pr_number), "--repo", REPO, "--json", fields],
        capture_output=True, text=True, timeout=60, check=True,
    )
    return json.loads(out.stdout)


def gh_pr_diff_names(pr_number: int) -> list[str]:
    out = subprocess.run(
        ["gh", "pr", "diff", str(pr_number), "--repo", REPO, "--name-only"],
        capture_output=True, text=True, timeout=60, check=True,
    )
    return [l for l in out.stdout.splitlines() if l.strip()]


def gh_pr_diff_text(pr_number: int) -> str:
    out = subprocess.run(
        ["gh", "pr", "diff", str(pr_number), "--repo", REPO],
        capture_output=True, text=True, timeout=60, check=True,
    )
    return out.stdout


def gh_pr_merge(pr_number: int, expected_sha: str) -> None:
    subprocess.run(
        ["gh", "pr", "merge", str(pr_number), "--repo", REPO, "--merge",
         "--match-head-commit", expected_sha],
        capture_output=True, text=True, timeout=120, check=True,
    )


def gh_pr_comment(pr_number: int, body: str) -> None:
    subprocess.run(
        ["gh", "pr", "comment", str(pr_number), "--repo", REPO, "--body", body],
        capture_output=True, text=True, timeout=60, check=True,
    )


def gh_api(endpoint: str, *, paginate: bool = False):
    out = subprocess.run(
        ["gh", "api", endpoint, *(["--paginate", "--slurp"] if paginate else [])],
        capture_output=True, text=True, timeout=60, check=True,
    )
    return json.loads(out.stdout)


def gh_main_head() -> str:
    sha = gh_api(f"repos/{REPO}/git/ref/heads/main")["object"]["sha"]
    if not isinstance(sha, str) or SHA_RE.fullmatch(sha) is None:
        raise ValueError("head de main inválido")
    return sha


def gh_commit_ci_status(sha: str, *, main: bool = False) -> str:
    """Statuses + check-runs paginados del SHA exacto, nunca un rollup parcial.

    Los nombres/app son el contrato de los workflows versionados. Un gate
    ausente no es verde. Solo deploy puede omitirse en PR (skipped).
    Cualquier error de red/esquema se conserva como pendiente, no aprobación.
    """
    if SHA_RE.fullmatch(sha) is None:
        return "pending"
    try:
        status_pages = gh_api(f"repos/{REPO}/commits/{sha}/status?per_page=100", paginate=True)
        check_pages = gh_api(f"repos/{REPO}/commits/{sha}/check-runs?filter=latest&per_page=100", paginate=True)
        statuses = [s for page in status_pages for s in page["statuses"]]
        checks = [c for page in check_pages for c in page["check_runs"]]
        states = []
        for s in statuses:
            states.append({"success": "green", "failure": "red", "error": "red"}.get(s["state"], "pending"))
        successful = set()
        for c in checks:
            name = c["name"]
            if c["head_sha"] != sha:
                return "pending"
            conclusion = c["conclusion"]
            if c["status"] != "completed":
                states.append("pending")
            elif conclusion in {"failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"}:
                states.append("red")
            elif conclusion == "success":
                states.append("green")
                if c["app"]["slug"] == "github-actions":
                    successful.add(name)
            elif name == DEPLOY_CHECK and not main and conclusion == "skipped" and c["app"]["slug"] == "github-actions":
                states.append("green")
            else:
                states.append("pending")
        if "red" in states:
            return "red"
        required = REQUIRED_CHECKS | ({DEPLOY_CHECK} if main else set())
        if not statuses or not required.issubset(successful) or "pending" in states:
            return "pending"
        return "green"
    except (subprocess.SubprocessError, ValueError, KeyError, TypeError):
        return "pending"


# ---------------------------------------------------------------------------
# Veredicto: identidad explícita en cuerpo + metadata de ejecución finalizada.
# Prosa solo puede vetar, jamás autorizar. Ver contrato en multiagente.md.
# ---------------------------------------------------------------------------

@dataclass
class Verdict:
    outcome: str  # "APROBADO" | "CAMBIOS PEDIDOS"
    sha: str
    author: str
    task_id: str


_METADATA_OUTCOME = {"approved": "APROBADO", "changes_requested": "CAMBIOS PEDIDOS"}


def _verdict_from_metadata(raw_metadata: Optional[str], author: str, task_id: str, pr_number: int) -> Optional[Verdict]:
    """Contrato estricto: verdict, sha completo, pr entero, repo y review_type.

    Extiende la metadata anterior con identidad inequívoca; no se infiere
    repositorio, tipo ni SHA a partir de títulos, URLs o prosa heredada.
    """
    if not raw_metadata:
        return None
    try:
        data = json.loads(raw_metadata)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    outcome = _METADATA_OUTCOME.get(data.get("verdict"))
    sha = data.get("sha")
    pr = data.get("pr")
    if outcome is None or not isinstance(sha, str) or SHA_RE.fullmatch(sha) is None:
        return None
    if not isinstance(pr, int) or isinstance(pr, bool) or pr != pr_number:
        return None
    if data.get("repo") != REPO or data.get("review_type") != "independent":
        return None
    return Verdict(outcome=outcome, sha=sha.lower(), author=author, task_id=task_id)


def find_review_verdict(pr_number: int, *, head_sha: str = "", db_path: Optional[Path] = None) -> Optional[Verdict]:
    """Todas las revisiones independientes declaradas para repo/PR/SHA.

    Cualquier cambios pedidos sobre ese SHA veta, sin desempate temporal;
    cualquier tarjeta pendiente bloquea. Un SHA nuevo exige identidad y
    aprobación nuevas. Las tarjetas antiguas sin identidad no autorizan.
    """
    db_path = db_path if db_path is not None else BOARD_DB
    if not db_path.is_file():
        return None
    con = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        cur = con.cursor()
        con.execute("BEGIN")  # identidad, resultados y críticas: una instantánea
        # El título no concede autoridad. La identidad explícita se fija en
        # el cuerpo ANTES de despachar, también para revisiones pendientes.
        cur.execute("SELECT id, body FROM tasks")
        applicable = []
        for task_id, body in cur.fetchall():
            for line in (body or "").splitlines():
                if not line.startswith("AUTO_MERGE_REVIEW "):
                    continue
                identity = json.loads(line.removeprefix("AUTO_MERGE_REVIEW "))
                if (identity.get("repo") == REPO and type(identity.get("pr")) is int
                        and identity["pr"] == pr_number
                        and identity.get("review_type") == "independent"
                        and _sha_matches(identity.get("sha", ""), head_sha)):
                    applicable.append(task_id)
        approved = []
        for task_id in set(applicable):
            cur.execute("SELECT profile, metadata FROM task_runs WHERE task_id = ? AND ended_at IS NOT NULL", (task_id,))
            resolved = []
            for profile, metadata in cur.fetchall():
                v = _verdict_from_metadata(metadata, profile or "", task_id, pr_number)
                if v and v.author in REVIEWER_PROFILES and _sha_matches(v.sha, head_sha):
                    resolved.append(v)
            # Una crítica en comentarios de esta identidad también veta;
            # nunca concede aprobación por prosa ni por SHA abreviado.
            cur.execute("SELECT author, body FROM task_comments WHERE task_id = ?", (task_id,))
            for author, text in cur.fetchall():
                for match in _VERDICT_RE.finditer(text or ""):
                    if author in REVIEWER_PROFILES and match[1].upper() == "CAMBIOS PEDIDOS" and _sha_matches(match[2], head_sha):
                        resolved.append(Verdict("CAMBIOS PEDIDOS", head_sha, author, task_id))
            rejected = next((v for v in resolved if v.outcome == "CAMBIOS PEDIDOS"), None)
            if rejected:
                return rejected
            if not resolved:
                return None  # revisión exigida todavía pendiente/no verificable
            approved.extend(resolved)
        return approved[0] if approved else None
    finally:
        con.close()


def kanban_comment(task_id: str, text: str, *, board: str = "arky-maintenance", author: str = "auto-merge-watch") -> None:
    subprocess.run(
        ["hermes", "--profile", "arkysupabase", "kanban", "--board", board, "comment", task_id, "--author", author, text],
        capture_output=True, text=True, timeout=60,
    )


# ---------------------------------------------------------------------------
# Decisión por PR
# ---------------------------------------------------------------------------

@dataclass
class Decision:
    pr_number: int
    title: str
    action: str  # "FUSIONAR" | "RETENER"
    risk_class: str
    reason: str
    verdict: Optional[Verdict] = None
    head_sha: str = ""


REVIEWER_PROFILES = {"rafael", "alexis"}

# ---------------------------------------------------------------------------
# REGLA DE JOSE, 2026-11-12, TEXTUAL: "el visto bueno de Rafael y Alexis es
# prerrequisito para poder realizar una fusión automática". No es un
# chequeo más de evaluate_pr -- es la PRIMERA comprobación, y si falla, el
# resto de la función NO SE EJECUTA. Da igual la clase de riesgo, da igual
# que el CI esté verde, da igual que las rutas sean inocentes.
#
# No es una clase de riesgo que se pueda ensanchar con una línea del libro
# de decisiones (enabled_classes_from_ledger) -- esa palanca ensancha QUÉ
# RUTAS son candidatas, nunca SI hace falta aprobación. Esta función no lee
# el libro de decisiones ni ninguna variable de entorno: no hay ningún
# parámetro, en código ni en configuración, que la desactive. Quien quiera
# fusionar sin pasar por Rafael o Alexis lo hace a mano, con `gh pr merge`
# y su propio nombre -- no a través de este programa.
#
# "Vigente" = sobre el SHA completo actual, por Rafael o Alexis. TODAS las
# tarjetas de revisión declaradas cuentan: cualquier "cambios pedidos"
# sobre ese SHA veta sin importar la fecha de otras aprobaciones. Fallar
# cerrado ante cualquier duda: sin tarjeta, sin comentario reconocible,
# autor que no es Rafael ni Alexis, SHA que no coincide, o un error al
# consultar `gh`/la base de Kanban -- todo cuenta como "no hay aprobación",
# nunca como "se asume que sí".
#
# No lo "optimices" quitándolo de aquí arriba ni fundiéndolo con las demás
# comprobaciones: que viva solo, primero y con este comentario es a
# propósito, para que nadie lo lea como un chequeo redundante y lo mueva.
# ---------------------------------------------------------------------------

def _sha_matches(a: str, b: str) -> bool:
    """Solo SHA completos válidos e idénticos; no prefijos ni normalización."""
    return (isinstance(a, str) and isinstance(b, str)
            and SHA_RE.fullmatch(a) is not None and SHA_RE.fullmatch(b) is not None and a == b)


@dataclass
class ApprovalCheck:
    ok: bool
    reason: str
    verdict: Optional["Verdict"] = None


def check_current_approval(pr_number: int, head_sha: str) -> ApprovalCheck:
    """La regla de Jose, aislada en una función para que `evaluate_pr` la
    llame una vez, primero, y nada más. No decide clase de riesgo, no mira
    CI, no mira rutas -- solo responde "¿hay un APROBADO de Rafael o Alexis
    sobre `head_sha`, sin críticas ni revisiones exigidas pendientes?"."""
    if not head_sha:
        return ApprovalCheck(False, "no se pudo determinar el SHA actual del PR (gh no respondió con certeza)")
    try:
        verdict = find_review_verdict(pr_number, head_sha=head_sha)
    except Exception as exc:  # sqlite bloqueada, fichero corrupto, lo que sea -- fallar cerrado
        return ApprovalCheck(False, f"no se pudo leer el veredicto con certeza ({exc}); se trata como ausente")
    if verdict is None:
        return ApprovalCheck(False, "sin veredicto reconocible todavía")
    if verdict.author not in REVIEWER_PROFILES:
        return ApprovalCheck(False, f"veredicto de '{verdict.author}', no es Rafael ni Alexis", verdict)
    if verdict.outcome != "APROBADO":
        return ApprovalCheck(False, "hay CAMBIOS PEDIDOS vigentes sobre este SHA", verdict)
    if not _sha_matches(verdict.sha, head_sha):
        return ApprovalCheck(False, f"el SHA aprobado ({verdict.sha}) no coincide con el actual ({head_sha[:12]})", verdict)
    return ApprovalCheck(True, f"{verdict.author} aprobó {verdict.sha}, vigente sobre el SHA actual", verdict)


def evaluate_pr(pr_number: int, *, enabled_classes: set[str]) -> Decision:
    try:
        meta = gh_pr_view(pr_number, "title,headRefOid,baseRefName,mergeStateStatus,mergeable,isDraft,body,state")
    except Exception as exc:
        return Decision(pr_number, f"PR #{pr_number}", "RETENER", "SIN_APROBACION",
                         f"no se pudo consultar gh con certeza ({exc}); se trata como sin aprobación")
    title = meta.get("title", "")
    head_sha = meta.get("headRefOid", "")

    # PRIMERA COMPROBACIÓN, INVIOLABLE -- ver el bloque de comentarios arriba.
    # Si esto falla, no se calcula clase de riesgo, no se lee el diff, no se
    # mira CI: se detiene aquí mismo.
    approval = check_current_approval(pr_number, head_sha)
    if not approval.ok:
        return Decision(pr_number, title, "RETENER", "SIN_APROBACION", approval.reason, approval.verdict, head_sha)

    # A partir de aquí YA hay aprobación vigente de Rafael o Alexis. Lo que
    # sigue son controles adicionales -- clase de riesgo, CI, mergeabilidad
    # -- nunca un sustituto de la comprobación de arriba.
    verdict = approval.verdict
    if meta.get("isDraft"):
        return Decision(pr_number, title, "RETENER", "ALTO_RIESGO", "PR en borrador", verdict, head_sha)
    if meta.get("baseRefName") != "main" or meta.get("state") != "OPEN":
        return Decision(pr_number, title, "RETENER", "ALTO_RIESGO", "base distinta de main o PR no abierto", verdict, head_sha)

    files = gh_pr_diff_names(pr_number)
    diff_text = gh_pr_diff_text(pr_number)
    after = gh_pr_view(pr_number, "headRefOid,baseRefName,title,body")
    if any(after.get(key) != meta.get(key) for key in ("headRefOid", "baseRefName", "title", "body")):
        return Decision(pr_number, title, "RETENER", "ALTO_RIESGO", "PR cambió durante la lectura del diff", verdict, head_sha)
    backstop = content_backstop_hit(title=title, body=meta.get("body", ""), diff_text=diff_text)
    if backstop:
        return Decision(pr_number, title, "RETENER", "ALTO_RIESGO", backstop, verdict, head_sha)

    cls = classify_paths(files, enabled_classes=enabled_classes)
    if cls.risk_class == "ALTO_RIESGO":
        return Decision(pr_number, title, "RETENER", "ALTO_RIESGO", cls.reason, verdict, head_sha)

    ci = gh_commit_ci_status(head_sha)
    if ci != "green":
        return Decision(pr_number, title, "RETENER", cls.risk_class, f"CI no está verde (estado: {ci})", verdict, head_sha)
    if meta.get("mergeStateStatus") != "CLEAN" or meta.get("mergeable") != "MERGEABLE":
        return Decision(pr_number, title, "RETENER", cls.risk_class,
                         f"no mergeable sin conflicto (mergeStateStatus={meta.get('mergeStateStatus')})",
                         verdict, head_sha)

    return Decision(pr_number, title, "FUSIONAR", cls.risk_class,
                     f"clase {cls.risk_class}, {verdict.author} aprobó {verdict.sha}, CI verde", verdict, head_sha)


# ---------------------------------------------------------------------------
# El freno
# ---------------------------------------------------------------------------

def is_kill_switch_active() -> bool:
    return KILL_SWITCH.exists()


def atomic_write(path: Path, text: str) -> None:
    """Mismo filesystem, fsync de datos y directorio; nunca JSON parcial."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temp, path)
        fsync_directory(path.parent)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def fsync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


@contextmanager
def execution_lock():
    """Un lock global, no se borra el inode al salir. Incluye reconciliación."""
    EXECUTION_LOCK.parent.mkdir(parents=True, exist_ok=True)
    with EXECUTION_LOCK.open("a") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def save_pending(entry: dict) -> None:
    atomic_write(PENDING_BREAKER_CHECK, json.dumps(entry))


def trip_kill_switch(reason: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    atomic_write(KILL_SWITCH,
        f"PARADO {time.strftime('%Y-%m-%dT%H:%M:%S%z')}\n{reason}\n\n"
        "Borra este fichero a mano, después de revisar, para reanudar la fusión automática "
        "de TODAS las clases.\n",
    )


def check_pending_breaker() -> Optional[str]:
    """Comprueba el CI de la última fusión automática que todavía no se
    confirmó. Si vino en rojo, dispara el freno. Devuelve un mensaje para el
    informe, o None si no había nada pendiente."""
    if not PENDING_BREAKER_CHECK.is_file():
        return None
    pending = json.loads(PENDING_BREAKER_CHECK.read_text(encoding="utf-8"))
    sha = pending.get("merge_commit_sha", "")
    if not sha:
        # Intención / respuesta incierta: no reintentar el merge. Solo una
        # lectura inequívoca de MERGED con el head esperado puede reconciliar.
        info = gh_pr_view(pending["pr_number"], "state,headRefOid,mergeCommit")
        sha = (info.get("mergeCommit") or {}).get("oid", "")
        if info.get("state") != "MERGED" or not _sha_matches(info.get("headRefOid", ""), pending.get("head_sha", "")) or SHA_RE.fullmatch(sha) is None:
            return "freno: intención de merge incierta; requiere conciliación humana, no se fusiona nada"
        pending.update(state="merged", merge_commit_sha=sha)
        save_pending(pending)
    ci = gh_commit_ci_status(sha, main=True)
    if ci not in ("green", "red"):
        return f"freno: CI de la fusión de #{pending['pr_number']} ({sha[:12]}) todavía pendiente"
    if ci == "red":
        trip_kill_switch(
            f"La fusión automática de #{pending['pr_number']} ({sha[:12]}) rompió el CI de main. "
            "Fusión automática detenida para TODAS las clases."
        )
        # Si falla disco al crear DISABLED, el journal sigue bloqueando.
        PENDING_BREAKER_CHECK.unlink()
        fsync_directory(PENDING_BREAKER_CHECK.parent)
        return f"FRENO DISPARADO: #{pending['pr_number']} rompió CI de main -- auto-merge-DISABLED escrito"
    PENDING_BREAKER_CHECK.unlink()
    fsync_directory(PENDING_BREAKER_CHECK.parent)
    return f"freno: CI de la fusión de #{pending['pr_number']} confirmado verde"


def is_write_enabled() -> bool:
    return WRITE_ENABLED_MARKER.is_file() and not is_kill_switch_active() and not PENDING_BREAKER_CHECK.exists()


# ---------------------------------------------------------------------------
# Registro
# ---------------------------------------------------------------------------

def log_jsonl(entry: dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with JSONL_LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def perform_merge(decision: Decision) -> None:
    with execution_lock():
        _perform_merge_locked(decision)


def _perform_merge_locked(decision: Decision) -> None:
    """Solo bajo execution_lock; reevaluar TODO antes de enviar escritura.

    Una intención durable precede gh: timeout/kill nunca permite repetir a
    ciegas. Tras rc=0 se guarda estado merged-unknown antes de otra red.
    """
    current = evaluate_pr(decision.pr_number, enabled_classes=enabled_classes_from_ledger(DECISIONS_LOG))
    if current.action != "FUSIONAR" or not _sha_matches(current.head_sha, decision.head_sha):
        raise RuntimeError("PR ya no cumple las guardas o cambió su SHA")
    main_sha = gh_main_head()
    if gh_commit_ci_status(main_sha, main=True) != "green":
        raise RuntimeError("main no está verde: no se fusiona nada")
    if gh_main_head() != main_sha:
        raise RuntimeError("main cambió durante su comprobación")
    if not check_current_approval(current.pr_number, current.head_sha).ok:
        raise RuntimeError("aprobación retirada durante la comprobación")
    if current.risk_class not in enabled_classes_from_ledger(DECISIONS_LOG):
        raise RuntimeError("clase revocada durante la comprobación")
    if not is_write_enabled():
        raise RuntimeError("escritura deshabilitada o seguimiento pendiente")
    pending = {"state": "intent", "pr_number": current.pr_number,
               "head_sha": current.head_sha, "base_sha": main_sha, "merge_commit_sha": ""}
    save_pending(pending)
    gh_pr_merge(current.pr_number, current.head_sha)
    pending["state"] = "merged-unknown"
    save_pending(pending)  # inmediatamente tras confirmar, ANTES de red/logs
    merge_info = gh_pr_view(current.pr_number, "state,headRefOid,mergeCommit")
    merge_sha = (merge_info.get("mergeCommit") or {}).get("oid", "")
    if merge_info.get("state") != "MERGED" or not _sha_matches(merge_info.get("headRefOid", ""), current.head_sha) or SHA_RE.fullmatch(merge_sha) is None:
        raise RuntimeError("merge sin SHA confirmado: journal bloquea nuevas fusiones")
    pending.update(state="merged", merge_commit_sha=merge_sha)
    save_pending(pending)
    entry = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "pr_number": decision.pr_number,
        "title": decision.title,
        "risk_class": decision.risk_class,
        "reason": decision.reason,
        "approved_by": decision.verdict.author if decision.verdict else None,
        "approved_sha": decision.verdict.sha if decision.verdict else None,
        "merge_commit_sha": merge_sha,
    }
    log_jsonl(entry)
    gh_pr_comment(
        decision.pr_number,
        f"🤖 Fusionado automáticamente -- clase {decision.risk_class}, aprobado por "
        f"{decision.verdict.author if decision.verdict else '?'} sobre "
        f"{decision.verdict.sha if decision.verdict else '?'}, CI verde. "
        f"Registrado en `~/.hermes/logs/auto-merges.jsonl`.",
    )
    if decision.verdict:
        kanban_comment(decision.verdict.task_id,
                        f"AUTO-FUSIONADO (2026-11-12): PR #{decision.pr_number} fusionado por el watcher, "
                        f"clase {decision.risk_class}. Commit de fusión {merge_sha[:12]}.")



# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def open_pr_numbers() -> list[int]:
    out = subprocess.run(
        ["gh", "pr", "list", "--repo", REPO, "--state", "open", "--json", "number", "--jq", ".[].number"],
        capture_output=True, text=True, timeout=60, check=True,
    )
    return [int(n) for n in out.stdout.split()]


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--live", action="store_true", help="Intenta fusionar de verdad. Sin esto, siempre corre en seco.")
    ap.add_argument("--pr", type=int, action="append", help="Limitar a estos PRs (repetible). Por defecto, todos los abiertos.")
    args = ap.parse_args(argv)

    try:
        with execution_lock():
            return run_cycle(args)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, sqlite3.Error) as exc:
        print(f"RETENER: ejecución bloqueada ({exc})", file=sys.stderr)
        return 1


def run_cycle(args) -> int:

    try:
        enabled = enabled_classes_from_ledger(DECISIONS_LOG)
    except DecisionLedgerError as exc:
        print(f"LIBRO DE DECISIONES ILEGIBLE -- no se fusiona nada: {exc}", file=sys.stderr)
        return 2

    breaker_msg = check_pending_breaker()
    if breaker_msg:
        print(breaker_msg)

    live = args.live and is_write_enabled()
    if args.live and not live:
        reason = ("auto-merge-DISABLED presente" if is_kill_switch_active() else
                  "seguimiento de fusión pendiente" if PENDING_BREAKER_CHECK.exists() else
                  "auto-merge-ENABLED ausente")
        print(f"--live pedido pero NO se fusionará nada: {reason}")

    pr_numbers = args.pr or open_pr_numbers()
    exit_code = 0
    for n in pr_numbers:
        try:
            decision = evaluate_pr(n, enabled_classes=enabled)
        except subprocess.CalledProcessError as exc:
            print(f"#{n}: ERROR consultando gh -- {exc}", file=sys.stderr)
            exit_code = 1
            continue
        tag = "FUSIONARÍA" if decision.action == "FUSIONAR" and not live else decision.action
        print(f"#{n} [{decision.risk_class}] {tag} -- {decision.reason} :: {decision.title}")
        if decision.action == "FUSIONAR" and live:
            _perform_merge_locked(decision)
            print(f"  -> fusionado de verdad.")
            break  # exactamente una fusión por ciclo; journal bloquea las demás
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
