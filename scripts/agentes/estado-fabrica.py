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
- **`auto_decompose` ausente o en `true` en un perfil con el hook del motor
  registrado** (hallazgo 2026-11-01, perfil `jose`): la clave falta en
  `True` por defecto en el motor instalado (confirmado leyendo
  `gateway/kanban_watchers_common.py`), así que su ausencia no es neutra --
  es el mismo riesgo que estar en `true` explícito. El roster a comprobar
  se descubre en vivo igual que arriba: cualquier perfil que ya tenga
  `block-hermes-engine-writes.py` en `pre_tool_call` es del alcance; esto
  detecta divergencia de la política, no decide a quién aplicarla -- un
  perfil fuera de ese roster no se evalúa.
- **Ningún perfil de la máquina con `auto_decompose` efectivo en `true`**
  (hallazgo 2026-11-09): el chequeo de arriba protege solo el roster del hook
  del motor, que es un subconjunto. El 8-nov un perfil de prueba
  (`pruebacoordinador220261025`, fuera de ese roster) ganó la carrera por el
  candado del despachador embebido con `auto_decompose: true` todavía puesto
  y descompuso una tarjeta ajena sin que nada lo detectara -- el roster
  angosto no cubre a un perfil nuevo o de prueba que nunca tuvo el hook. Este
  chequeo recorre **todos** los `~/.hermes/profiles/*/config.yaml` sin
  excepción de roster, calcula el valor efectivo (explícito, o `true` por
  defecto si la clave falta) y es CRÍTICO ante cualquiera en `true`. Es el
  mismo defecto en dos sitios: la clave vive copiada en N ficheros, y el
  único blindaje existente no cubría a todos.
- **El candado del despachador embebido (`~/.hermes/kanban/.dispatcher.lock`)
  sin dueño** (hallazgo 2026-11-09): un gateway "activo" no implica que su
  despachador esté de verdad despachando -- `arkysupabase` y `latamfactory`
  corrieron 21+ horas "activos" sin que ninguno tuviera el candado, porque
  el que lo ganó al arrancar murió sin que el perdedor reintentara (no hay
  reintento tras la derrota inicial, confirmado leyendo
  `gateway/kanban_watchers.py`). CRÍTICO si el candado está libre (nadie lo
  tiene) mientras al menos un gateway `hermes-gateway-*.service` está activo
  -- un despachador vivo en papel y muerto en la práctica es exactamente la
  clase de fallo que costó un mes sin que nadie se enterara.
- **Un hook declarado en `config.yaml` sin su aprobación en
  `shell-hooks-allowlist.json`** (hallazgo 2026-11-01, perfil
  `latamfactory`): confirmado leyendo `agent/shell_hooks.py` que un hook no
  aprobado **falla abierto** -- se omite en silencio, con un aviso solo en
  el log, nunca bloquea nada. `fail_closed: true` no protege contra esto:
  esa bandera solo rige un hook ya registrado que falla en ejecución, nunca
  uno que nunca llegó a registrarse por falta de aprobación. CRÍTICO
  siempre que aparece, sin umbral: no hay lectura inocua de un hook de
  seguridad que nunca corre.
- **Un job de `hermes cron` activo con 3 o más salidas fallidas seguidas**
  (hallazgo 2026-11-11): `kanban-dispatch` compilaba un wrapper bash como
  Python y fallaba con SyntaxError. No era lo mismo que `estado-fabrica-watch`:
  de sus 50 salidas retenidas revisadas por Rafael, 48 eran ATENCION (exit 1
  por diseño) y una un fallo puntual por falta de yaml; no 808 fallos en
  silencio. Se lee `cron/jobs.json` de cada perfil, incluido el raíz.
  Un registro ilegible también es CRÍTICO. Se excluye este mismo script para
  no autoenganchar el vigilante; otros detectores que salgan con exit != 0
  por diseño aún pueden producir falsos positivos. Un job deshabilitado o
  con marcadores de pausa no cuenta, conforme a `is_job_runnable` del motor.
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

Tampoco compara `command_allowlist`, `reasoning_effort` ni
`fallback_providers` entre perfiles -- **bloqueado en una decisión de
política, no en esfuerzo de construcción** (hallazgo 2026-11-01): esos tres
varían legítimamente por rol (un revisor puede necesitar `reasoning_effort:
high`, un especialista rutinario no) y hoy nadie ha declarado qué
combinación es la correcta por rol. Sin esa base, un chequeo automático no
puede distinguir "roles distintos, a propósito" de "lo mismo, por
descuido" -- que es exactamente la pregunta sin responder sobre
`command_allowlist` (ver `scripts/agentes/politica-por-perfil.md`). Añadir
esto aquí es barato en líneas; cuesta la decisión previa, no el código.

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
import fcntl
import json
import os
import re
import subprocess
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

import yaml

MOTOR_LOG = Path.home() / ".hermes" / "logs" / "motor-bloqueado.jsonl"
RESULT_FILE = Path.home() / ".hermes" / "logs" / "estado-fabrica.json"
DISPATCHER_LOCK = Path.home() / ".hermes" / "kanban" / ".dispatcher.lock"

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


ENGINE_GUARD_COMMAND = "/home/tata/.hermes/agent-hooks/block-hermes-engine-writes.py"


def _engine_guard_roster() -> list[Path]:
    """Perfiles del alcance de esta comprobación: cualquiera que ya tenga el
    hook del motor registrado en `pre_tool_call`, descubierto en vivo -- nunca
    una lista escrita a mano, por la misma razón que los tableros y los
    gateways de arriba. Un perfil que nunca tuvo ese hook está fuera del
    alcance, no es un hallazgo."""
    if not PROFILES_DIR.is_dir():
        return []
    roster = []
    for profile_dir in sorted(PROFILES_DIR.iterdir()):
        if not profile_dir.is_dir() or profile_dir.name == ".deleted":
            continue
        cfg_path = profile_dir / "config.yaml"
        if not cfg_path.is_file():
            continue
        try:
            text = cfg_path.read_text(encoding="utf-8")
        except OSError:
            continue
        if ENGINE_GUARD_COMMAND in text:
            roster.append(profile_dir)
    return roster


def policy_drift_findings() -> list[dict]:
    """Dos ajustes donde la ausencia ya se confirmó peligrosa, no neutra
    (hallazgo 2026-11-01, perfil `jose` quedó fuera de la corrección del
    26-10 una semana entera sin que nadie lo notara):

    1. `auto_decompose` ausente o en `true` en un perfil del roster del
       hook del motor -- el valor por defecto del motor instalado es
       `true` (confirmado leyendo el código, no supuesto).
    2. Un hook declarado en `config.yaml` sin su aprobación exacta en
       `shell-hooks-allowlist.json` -- falla abierto, no cerrado.

    No juzga `command_allowlist`/`reasoning_effort`/`fallback_providers`:
    ver la nota en el docstring del módulo."""
    findings = []
    for profile_dir in _engine_guard_roster():
        cfg_path = profile_dir / "config.yaml"
        try:
            data = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError) as exc:
            findings.append({"profile": profile_dir.name, "problem": f"config.yaml no se pudo leer: {exc}"})
            continue
        if not isinstance(data, dict):
            continue

        kanban_cfg = data.get("kanban") or {}
        if kanban_cfg.get("auto_decompose") is not False:
            estado = "ausente (por defecto true en el motor)" if "auto_decompose" not in kanban_cfg \
                else f"en {kanban_cfg.get('auto_decompose')!r}"
            findings.append({"profile": profile_dir.name, "kind": "auto_decompose",
                              "problem": f"auto_decompose {estado}, sin blindaje explícito"})

        declared = []
        for event_name, entries in (data.get("hooks") or {}).items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                command = (entry or {}).get("command") if isinstance(entry, dict) else None
                if command:
                    declared.append((event_name, command))
        if declared:
            allow_path = profile_dir / "shell-hooks-allowlist.json"
            approved = set()
            if allow_path.is_file():
                try:
                    allow_data = json.loads(allow_path.read_text(encoding="utf-8"))
                    approved = {(a.get("event"), a.get("command")) for a in allow_data.get("approvals", [])}
                except (OSError, json.JSONDecodeError):
                    approved = set()
            for event_name, command in declared:
                if (event_name, command) not in approved:
                    findings.append({"profile": profile_dir.name, "kind": "hook_sin_allowlist",
                                      "problem": f"hook {event_name}:{command} declarado pero sin aprobar en "
                                                 f"shell-hooks-allowlist.json -- falla abierto, nunca corre"})
    return findings


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


def auto_decompose_true_everywhere() -> list[dict]:
    """Todo perfil de la máquina cuyo `auto_decompose` EFECTIVO sea `true` --
    explícito o por ausencia de clave (el motor instalado por defecto en
    `true`, confirmado leyendo `gateway/kanban_watchers_common.py`). A
    diferencia de `policy_drift_findings`, no se limita al roster del hook del
    motor: un perfil de prueba o recién creado que nunca tuvo ese hook queda
    fuera de aquel chequeo y dentro de éste -- es la brecha real que dejó a
    `pruebacoordinador220261025` descomponer una tarjeta ajena el 8-nov."""
    if not PROFILES_DIR.is_dir():
        return []
    findings = []
    for profile_dir in sorted(PROFILES_DIR.iterdir()):
        if not profile_dir.is_dir() or profile_dir.name == ".deleted":
            continue
        cfg_path = profile_dir / "config.yaml"
        if not cfg_path.is_file():
            continue
        try:
            data = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError) as exc:
            findings.append({"profile": profile_dir.name, "problem": f"config.yaml no se pudo leer: {exc}"})
            continue
        if not isinstance(data, dict):
            continue
        kanban_cfg = data.get("kanban") or {}
        if kanban_cfg.get("auto_decompose") is not False:
            estado = "ausente (true por defecto en el motor)" if "auto_decompose" not in kanban_cfg \
                else f"en {kanban_cfg.get('auto_decompose')!r}"
            findings.append({"profile": profile_dir.name, "problem": f"auto_decompose {estado}"})
    return findings


CRON_FAILURE_STREAK_THRESHOLD = 3


def cron_job_failure_streaks() -> list[dict]:
    """Rachas de salidas fallidas y errores de lectura, sin ejecutar jobs.

    La racha no demuestra la causa: ATENCION también sale con exit 1. Por
    eso se excluye estado-fabrica.py por script, no por nombre configurable
    del job. Otros detectores con exit != 0 deliberado pueden dar falsos
    positivos. Un fichero ausente es normal; uno ilegible nunca equivale a
    una lista sana vacía. No cubre crontab ni jobs que dejan de dispararse.
    """
    findings = []

    def registry_error(profile: str, problem: str) -> None:
        findings.append({"profile": profile, "kind": "cron_registry_error", "problem": problem})

    # El raíz existe aunque nunca se hayan creado perfiles nombrados.
    roots = [("root", PROFILES_DIR.parent)]
    try:
        roots.extend((p.name, p) for p in sorted(PROFILES_DIR.iterdir())
                     if p.is_dir() and p.name != ".deleted")
    except FileNotFoundError:
        pass
    except OSError:
        registry_error("profiles", "no se pudo enumerar el directorio de perfiles")
    for profile, root in roots:
        jobs_path = root / "cron" / "jobs.json"
        try:
            data = json.loads(jobs_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            continue
        except (OSError, ValueError):
            # No volcar contenido ni excepciones del JSON: podría contener secretos.
            registry_error(profile, "jobs.json ilegible o JSON inválido")
            continue
        jobs = data.get("jobs") if isinstance(data, dict) else data
        if not isinstance(jobs, list):
            registry_error(profile, "jobs.json con forma inesperada: se esperaba una lista de jobs")
            continue
        for index, job in enumerate(jobs):
            if not isinstance(job, dict):
                registry_error(profile, f"jobs.json: registro {index} no es un objeto")
                continue
            # Misma puerta que cron/jobs.py:is_job_runnable (Hermes v0.22.2).
            if (not job.get("enabled", True) or str(job.get("state") or "").strip() == "paused"
                    or job.get("paused_at")):
                continue
            script = job.get("script")
            if isinstance(script, str) and Path(script).name == "estado-fabrica.py":
                continue
            raw_streak = job.get("failure_streak")
            try:
                if raw_streak is not None and (isinstance(raw_streak, bool)
                                               or not isinstance(raw_streak, (int, str))):
                    raise ValueError
                streak = 0 if raw_streak is None else int(raw_streak)
                if streak < 0:
                    raise ValueError
            except (TypeError, ValueError):
                registry_error(profile, f"jobs.json: registro {index} tiene failure_streak inválido")
                continue
            if streak >= CRON_FAILURE_STREAK_THRESHOLD:
                error_lines = str(job.get("last_error") or "").splitlines()
                findings.append({
                    "profile": profile,
                    "job_id": job.get("id"),
                    "name": job.get("name"),
                    "failure_streak": streak,
                    "last_error": next((line.strip() for line in error_lines if line.strip()), None),
                })
    return findings


def dispatcher_lock_status(gw_states: dict[str, str]) -> dict:
    """¿Alguien tiene de verdad el candado del despachador embebido?

    Un gateway `active` no es prueba -- `arkysupabase` y `latamfactory`
    corrieron 21+ horas "activos" con el candado libre (nadie reintenta tras
    perder la carrera inicial al arrancar). La única prueba real es intentar
    adquirirlo: si se consigue, estaba libre (se libera al instante, nunca se
    retiene); si falla con recurso no disponible, alguien más lo tiene --
    exactamente lo mismo que mide `lslocks`/`fuser`/el barrido de `/proc/*/fd`,
    sin depender de ninguno de los tres estar instalado."""
    any_gateway_active = any(v == "active" for v in gw_states.values())
    if not DISPATCHER_LOCK.exists():
        return {"held": None, "reason": "no existe el fichero del candado todavía", "critical": False}
    try:
        with DISPATCHER_LOCK.open("a+") as fh:
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                return {"held": True, "reason": "candado en uso (correcto)", "critical": False}
            else:
                fcntl.flock(fh, fcntl.LOCK_UN)
                critical = any_gateway_active
                return {
                    "held": False,
                    "reason": "candado LIBRE -- ningún despachador embebido lo tiene" +
                               (" mientras al menos un gateway está activo" if any_gateway_active else ""),
                    "critical": critical,
                }
    except OSError as exc:
        return {"held": None, "reason": f"no se pudo comprobar: {exc}", "critical": False}


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

    policy_findings = policy_drift_findings()
    for f in policy_findings:
        if f.get("kind") == "auto_decompose":
            razones.append(f"POLITICA SIN BLINDAR: perfil '{f['profile']}' -- {f['problem']}")
        elif f.get("kind") == "hook_sin_allowlist":
            razones.append(f"HOOK SIN REGISTRAR: perfil '{f['profile']}' -- {f['problem']}")
        else:
            razones.append(f"POLITICA: perfil '{f['profile']}' -- {f['problem']}")

    auto_decompose_global = auto_decompose_true_everywhere()
    for f in auto_decompose_global:
        razones.append(f"AUTO_DECOMPOSE ACTIVO: perfil '{f['profile']}' -- {f['problem']} -- "
                        f"cualquier gateway que arranque con este perfil puede descomponer tarjetas por su cuenta")

    # Nunca "if alive else ..." -- `alive` exige TODOS los gateways activos, y
    # un solo gateway de prueba caído (inactivo a propósito) apagaría este
    # chequeo aunque arkysupabase/latamfactory sí estén despachando de verdad.
    # `dispatcher_lock_status` decide su propio "hay algo que vigilar" mirando
    # si ALGUNO está activo, no si lo están todos.
    lock_status = dispatcher_lock_status(gw_states)
    if lock_status["critical"]:
        razones.append(f"CANDADO DEL DESPACHADOR SIN DUEÑO: {lock_status['reason']} -- "
                        f"un gateway 'activo' no implica que esté despachando de verdad")

    cron_streaks = cron_job_failure_streaks()
    for c in cron_streaks:
        if c.get("kind") == "cron_registry_error":
            razones.append(f"CRON REGISTRO ILEGIBLE: perfil '{c['profile']}' -- {c['problem']}")
            continue
        razones.append(f"CRON ROTO: perfil '{c['profile']}', job '{c['name']}' ({c['job_id']}) -- "
                        f"{c['failure_streak']} salidas fallidas seguidas -- \"{c['last_error']}\"")

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
        "policy_drift": policy_findings,
        "auto_decompose_global": auto_decompose_global,
        "dispatcher_lock": lock_status,
        "cron_failure_streaks": cron_streaks,
        "not_covered": ["gasto desbocado (sin medición de coste por tarea todavía)",
                        "pérdida de datos (sin detector todavía)",
                        "jobs del crontab del sistema",
                        "job activo que deja de dispararse sin que el streak lo delate",
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
