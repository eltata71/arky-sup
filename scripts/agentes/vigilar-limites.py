#!/usr/bin/env python3
"""Vigilante externo para el único hueco real que nos interesa resolver, no
para replicar el sistema de límites de Hermes desde fuera.

ÚNICA EXCEPCIÓN PERMITIDA A "NUNCA ESCRIBIR EN LA BASE DE DATOS DIRECTAMENTE"
==============================================================================
Esta regla gobierna TODOS los vigilantes externos de esta fábrica (este
script, estado-fabrica.py, y cualquiera que se añada después). Es una
excepción, no un precedente: no autoriza ninguna otra escritura directa,
sobre ningún otro campo, por ningún otro motivo. Decidida el 2026-10-25,
aprobada por José. Solo aplica cuando se cumplen las TRES condiciones a la
vez:

  1. El campo no tiene NINGUNA vía soportada para fijarse después de crear
     la tarea (confirmado leyendo el código y probando `hermes kanban edit`
     en vivo -- no basta con "no conozco una", hay que haberla buscado).
  2. La escritura es de UNA sola columna, en UNA sola fila, con una condición
     `WHERE` que repite la comprobación que detectó el hueco (aquí:
     `max_runtime_seconds IS NULL AND status IN (...)`) -- así nunca puede
     pisar un valor que otra cosa haya puesto entre la lectura y la
     escritura.
  3. La escritura deja un rastro AUDITABLE en la propia tarjeta, por una vía
     soportada (`hermes kanban comment`), diciendo qué se hizo, cuándo y por
     qué -- nunca solo en un log externo que nadie que mire la tarjeta vería.

Cualquier escritura que no cumpla las tres a la vez debe hacerse por la CLI
de Hermes (`hermes kanban ...`), aunque sea más lenta o menos cómoda. Si
hace falta escribir algo que no cumple las tres condiciones, el camino es
pedir la función que falta río arriba, no ampliar esta excepción.
==============================================================================

SEGUNDO USO DE LA MISMA EXCEPCIÓN, NO UNA NUEVA (2026-11-04)
==============================================================================
`max_runtime_seconds` (la tarjeta) y `run_budget_seconds` (`agent:` en el
`config.yaml` del perfil asignado) son dos verdades sin conciliar: ninguna
sabe de la otra, y el motor no concilia ninguna de las dos (ver tarjeta
`t_dc22118e`, tablero `latam-factory`). Mordió tres veces en 24 horas:
`t_8c2134ab` (la tarjeta pedía 7200s, el perfil `andres-integration`
seguía en 300s -- ganó el perfil, más corto), `t_923c97a1` (la tarjeta
seguía en 300s, el perfil `paola-qa` ya en 1200s -- ganó la tarjeta, más
corta), y un barrido manual de las 20 tarjetas vivas en todos los
tableros encontró 2 desajustes más que todavía no habían mordido.

**La regla elegida: el perfil manda como PISO, nunca como techo más
bajo.** No es que uno de los dos "gane" siempre -- es que una tarjeta
nunca debe poder correr con MENOS tiempo del que su propio perfil ya
tiene fijado como necesario para ese tipo de trabajo. Por eso
`patch_mismatched_runtime_ceiling` solo SUBE: si `max_runtime_seconds` de
la tarjeta es menor que `run_budget_seconds` del perfil asignado, lo sube
a igualarlo. Si es mayor (una tarjeta con más tiempo del que su perfil
pide, como la excepción puntual que se le dio a Andrés), no lo toca --
pedir más no es el defecto, pedir menos de lo que el propio perfil ya
sabe que necesita, sí.

Cumple las mismas tres condiciones de la excepción original: (1) no hay
vía soportada para conciliar los dos valores -- es exactamente el defecto
que denuncia `t_dc22118e`, sin construir porque toca el motor de Hermes;
(2) una sola columna, una sola fila, `WHERE` que repite `max_runtime_seconds`
con su valor viejo exacto; (3) comentario auditable en la propia tarjeta.
No es una excepción nueva -- es la misma, aplicada a un segundo hueco real
del mismo campo.
==============================================================================

Confirmado leyendo su propio código (no supuesto): una tarea hija creada por
el auto-decomposer nunca hereda `max_runtime_seconds` ni `max_retries` de su
padre (`_insert_decomposed_child` en `hermes_cli/kanban_db_graph.py` -- el
`INSERT INTO tasks` omite esas dos columnas, línea 200). El asesino de tareas
por tiempo del propio despachador ni siquiera la evalúa: su consulta, en
`kanban_db_dispatch.py:726`, lleva `WHERE ... max_runtime_seconds IS NOT
NULL`. No es un plazo generoso -- es ningún plazo.

No se puede arreglar desde un hook (los eventos de ciclo de vida del kanban
son observadores, no pueden bloquear ni modificar) ni desde la CLI de tareas
ya creadas (`kanban edit` no toca max_runtime/max_retries -- comprobado de
nuevo el 2026-10-25, sigue sin esa opción). El arreglo de raíz exige parchear
el motor instalado de Hermes -- software de terceros (Nous Research, MIT), y
José decidió explícitamente no modificarlo. Reportado río arriba por separado
(ver docs/incidentes/).

Este script NO corrige la causa: las tareas pueden seguir naciendo sin reloj.
El alcance entregado es mitigación proactiva y DETECCIÓN, NO CONTENCIÓN:

1. **Proactiva** (`patch_missing_runtime_ceiling`): tareas `ready`/`todo`/
   `running` sin `max_runtime_seconds` reciben un techo mediante la excepción
   histórica anterior (UPDATE condicional de una columna + comentario CLI).
   UPDATE y comentario NO son atómicos; un fallo CLI aborta el lote. Un UPDATE
   que no aplica no se devuelve ni cuenta como escritura. En dry-run solo se
   devuelven detecciones. La aplicación y terminación posteriores dependen del
   dispatcher nativo; no son una garantía de este script.
2. **Detección reactiva** (`check_runtime`): solo lee las tareas `running` sin
   límite y su reloj de intento. Nunca ejecuta reclaim, block ni señales a
   procesos, tampoco para review ni ante intervenciones históricas. Si hay
   vencidas en modo mutante, FALLA explícitamente y solicita recuperación manual
   con dispatcher detenido y verificado. No verifica esa detención ni acepta
   un booleano como prueba. No se entrega intervención reactiva automática.

Motivo de la exclusión: reclaim puede habilitar redespacho antes de block,
que limpiaría la identidad del worker nuevo sin terminarlo; desde review,
reclaim puede restaurar review, donde block no es válido. Sin exclusión
compartida efectiva, una secuencia de CLI no garantiza contención. No se
implementan locks locales ni cambios al motor para aparentar esa garantía.

main detecta ANTES de parchear para no ocultar una vencida asignándole reloj.
Se recorre todo el lote antes de informar vencidas/relojes inválidos. Es una
foto entre sondeos; no vigila el tope de flota ni garantiza detener procesos.
Las pruebas previas de terminación corresponden a la versión anterior, no
validan este contrato nuevo. Ver vigilar-limites.md para riesgos y gates.

Uso (candidata no instalada):
    python3 scripts/agentes/vigilar-limites.py <kanban.db> <board> --profile arkysupabase [--dry-run] [--cron]

Salida: 0 sin hallazgos/escrituras; 1 con detecciones dry-run o parches
aplicados; excepciones ante vencidas en modo mutante o errores. main escribe
heartbeat local incluso con --dry-run. No es protección operacional completa.
"""
import argparse
import json
import math
import subprocess
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

DEFAULT_RUNTIME_CEILING_SECONDS = 600  # 10 min: techo de seguridad, no un plazo "razonable" calculado

HEARTBEAT = Path(__file__).resolve().parent / "vigilar-limites.heartbeat.json"

PROFILES_DIR = Path.home() / ".hermes" / "profiles"  # mismo sitio que estado-fabrica.py


def _profile_run_budget_seconds(profile: str) -> int | None:
    """`run_budget_seconds` del `config.yaml` del perfil, o `None` si el
    perfil no existe, no tiene `config.yaml`, no declara el campo, o el
    fichero no se puede leer/parsear -- en todos esos casos no hay piso
    conocido con el que conciliar, así que la tarjeta se deja como está."""
    cfg_path = PROFILES_DIR / profile / "config.yaml"
    try:
        data = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return None
    if not isinstance(data, dict):
        return None
    agent = data.get("agent")
    if not isinstance(agent, dict):
        return None
    value = agent.get("run_budget_seconds")
    return value if isinstance(value, int) and value > 0 else None


def write_heartbeat(board: str, runtime_hits: int, error: str = None) -> None:
    payload = {
        "last_run_at": datetime.now(timezone.utc).isoformat(),
        "board": board,
        "runtime_hits": runtime_hits,
        "error": error,
    }
    try:
        HEARTBEAT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


MARKER = "vigilar-limites:"  # firma histórica conservada para comentarios proactivos


def patch_missing_runtime_ceiling(
    con: sqlite3.Connection, profile: str, board: str, ceiling_seconds: int, dry_run: bool,
) -> list[dict]:
    """Capa proactiva -- ejerce la ÚNICA EXCEPCIÓN PERMITIDA a "nunca escribir
    en la base de datos directamente" (ver el bloque con ese nombre al
    principio de este fichero; sus tres condiciones son obligatorias y esta
    función las implementa, no las reinterpreta). Una sola columna
    (`max_runtime_seconds`), con `WHERE ... IS NULL` repetido en la propia
    escritura (idempotente: no puede pisar un valor puesto por otra vía entre
    la lectura y la escritura), y un comentario en la propia tarjeta por la
    vía soportada (`hermes kanban comment`) que dice qué se hizo y por qué.
    No copiar este patrón para ningún otro campo sin releer esas tres
    condiciones primero."""
    rows = con.execute(
        "SELECT id, assignee, status, title FROM tasks "
        "WHERE max_runtime_seconds IS NULL AND status IN ('ready','todo','running')",
    ).fetchall()
    patched = []
    for row in rows:
        entry = {"id": row["id"], "assignee": row["assignee"], "status": row["status"], "title": row["title"]}
        if dry_run:
            patched.append(entry)  # detección, no escritura aplicada
            continue
        cur = con.execute(
            "UPDATE tasks SET max_runtime_seconds = ? "
            "WHERE id = ? AND max_runtime_seconds IS NULL AND status IN ('ready','todo','running')",
            (ceiling_seconds, row["id"]),
        )
        con.commit()
        entry["applied"] = cur.rowcount > 0
        if not entry["applied"]:
            continue  # otra cosa la cambió entre la lectura y la escritura -- no hay nada que comentar
        comment = (
            f"{MARKER} esta tarea se creó sin max_runtime_seconds (hueco conocido: el motor no "
            f"copia ese campo cuando el auto-decompositor, un kanban_create manual, o un agente "
            f"creando una tarjeta hija lo omiten). Se fijó un techo de seguridad de "
            f"{ceiling_seconds}s por este vigilante externo -- no es el reloj que habría puesto "
            f"el creador original, es el mínimo para que el motor pueda vigilarla él mismo."
        )
        subprocess.run(
            ["hermes", "-p", profile, "kanban", "--board", board, "comment", row["id"], comment],
            check=True,
            timeout=30,
        ).check_returncode()
        patched.append(entry)
    return patched


def patch_mismatched_runtime_ceiling(
    con: sqlite3.Connection, profile: str, board: str, dry_run: bool,
) -> list[dict]:
    """Segundo uso de la misma excepción (ver "SEGUNDO USO DE LA MISMA
    EXCEPCIÓN" al principio del fichero). Solo SUBE: una tarjeta con
    `max_runtime_seconds` por debajo de `run_budget_seconds` del perfil
    asignado se iguala al perfil -- el perfil es el piso, nunca el techo.
    Una tarjeta por ENCIMA del perfil (una excepción puntual ya concedida,
    como la de Andrés a 7200s) no se toca: pedir más no es el defecto."""
    rows = con.execute(
        "SELECT id, assignee, status, max_runtime_seconds, title FROM tasks "
        "WHERE max_runtime_seconds IS NOT NULL AND assignee IS NOT NULL "
        "AND status IN ('ready','todo','running')",
    ).fetchall()
    patched = []
    for row in rows:
        piso = _profile_run_budget_seconds(row["assignee"])
        if piso is None or row["max_runtime_seconds"] >= piso:
            continue  # sin piso conocido, o la tarjeta ya pide lo mismo o más
        valor_viejo = row["max_runtime_seconds"]
        entry = {
            "id": row["id"], "assignee": row["assignee"], "status": row["status"],
            "title": row["title"], "old": valor_viejo, "new": piso,
        }
        if dry_run:
            patched.append(entry)
            continue
        cur = con.execute(
            "UPDATE tasks SET max_runtime_seconds = ? "
            "WHERE id = ? AND max_runtime_seconds = ? AND status IN ('ready','todo','running')",
            (piso, row["id"], valor_viejo),
        )
        con.commit()
        entry["applied"] = cur.rowcount > 0
        if not entry["applied"]:
            continue  # otra cosa cambió el valor entre la lectura y la escritura
        comment = (
            f"{MARKER} max_runtime_seconds de esta tarjeta ({valor_viejo}s) estaba por debajo "
            f"de run_budget_seconds del perfil {row['assignee']} ({piso}s) -- dos verdades sin "
            f"conciliar (defecto t_dc22118e). El perfil manda como piso: igualado a {piso}s por "
            f"este vigilante externo."
        )
        subprocess.run(
            ["hermes", "-p", profile, "kanban", "--board", board, "comment", row["id"], comment],
            check=True,
            timeout=30,
        ).check_returncode()
        patched.append(entry)
    return patched


def check_runtime(con: sqlite3.Connection, profile: str, board: str, ceiling_seconds: int, dry_run: bool) -> list[dict]:
    """Solo detección: devuelve vencidas en dry-run; en modo mutante falla
    solicitando recuperación manual con dispatcher detenido y verificado.
    Nunca reclama/bloquea ni verifica procesos. profile/board se conservan
    por compatibilidad de llamada; no habilitan intervención alguna."""
    now = time.time()
    rows = con.execute(
        "SELECT t.id, t.assignee, t.title, "
        "COALESCE(r.started_at, t.started_at) AS active_started_at FROM tasks t "
        "LEFT JOIN task_runs r ON r.id = t.current_run_id "
        "WHERE t.status='running' AND t.max_runtime_seconds IS NULL",
    ).fetchall()
    hits = []
    clock_errors = []
    for row in rows:
        # worker_started_at es identidad de proceso, NO un reloj. Medir el
        # intento actual igual que el dispatcher nativo, no el primer intento.
        try:
            started_at = float(row["active_started_at"])
        except (TypeError, ValueError):
            clock_errors.append(f"{row['id']}: reloj de ejecución ausente o ilegible")
            continue
        if not math.isfinite(started_at) or started_at <= 0 or started_at > now:
            clock_errors.append(f"{row['id']}: reloj de ejecución fuera de rango")
            continue
        elapsed = now - started_at
        if elapsed < ceiling_seconds:
            continue
        hits.append({
            "id": row["id"], "assignee": row["assignee"], "elapsed_seconds": int(elapsed),
            "title": row["title"], "escalated": False, "applied": False,
        })
    # Recoger TODO el lote antes de fallar: un reloj inválido no oculta otras
    # vencidas. No hay llamadas CLI, cambios de estado ni señales a procesos.
    errors = list(clock_errors)
    if hits and (not dry_run or clock_errors):
        errors.append(
            "tareas vencidas sin max_runtime_seconds: "
            + ", ".join(f"{hit['id']} ({hit['elapsed_seconds']}s)" for hit in hits)
            + "; intervención reactiva automática excluida: recuperación manual "
            "con dispatcher detenido y verificado; este vigilante no verifica su detención "
            "ni contiene procesos"
        )
    if errors:
        raise (ValueError if clock_errors else RuntimeError)("; ".join(errors))
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("db")
    ap.add_argument("board")
    ap.add_argument("--profile", default="arkysupabase", help="perfil hermes para comentarios proactivos (default: arkysupabase)")
    ap.add_argument("--runtime-ceiling-seconds", type=int, default=DEFAULT_RUNTIME_CEILING_SECONDS)
    ap.add_argument("--dry-run", action="store_true", help="solo detección, sin parches ni CLI; escribe heartbeat local")
    ap.add_argument("--cron", action="store_true", help="silencio si no hay nada que avisar")
    args = ap.parse_args()

    con = None
    try:
        con = sqlite3.connect(f"file:{args.db}?mode=ro" if args.dry_run else args.db, uri=args.dry_run)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA busy_timeout=5000")
        # Detectar antes del parche: no ocultar una vencida dándole reloj.
        runtime_hits = check_runtime(con, args.profile, args.board, args.runtime_ceiling_seconds, args.dry_run)
        patched = patch_missing_runtime_ceiling(
            con, args.profile, args.board, args.runtime_ceiling_seconds, args.dry_run,
        )
        reconciled = patch_mismatched_runtime_ceiling(con, args.profile, args.board, args.dry_run)
    except Exception as exc:  # un vigilante que se traga su propio fallo es peor que ninguno
        write_heartbeat(args.board, 0, error=f"{type(exc).__name__}: {exc}")
        print(f"VIGILAR-LIMITES: fallo al comprobar {args.board}: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
    finally:
        if con is not None:
            con.close()

    write_heartbeat(args.board, len(runtime_hits) + len(patched) + len(reconciled))

    if args.cron and not runtime_hits and not patched and not reconciled:
        return 0

    if not args.cron:
        print(f"== vigilar-limites: {args.board} ({args.db}) ==")
        if not runtime_hits and not patched and not reconciled:
            print("sin tareas corriendo sin reloj por encima del techo, ninguna sin reloj que "
                  "parchear, y ninguna por debajo del piso de su perfil")

    for p in patched:
        action = "se le habría puesto" if args.dry_run else "se le puso"
        print(f"RELOJ_FALTANTE: {p['id']} ({p['assignee']}, {p['status']}) {action} techo de "
              f"{args.runtime_ceiling_seconds}s -- \"{p['title']}\"")

    for r in reconciled:
        action = "se le habría subido" if args.dry_run else "se le subió"
        print(f"DOS_VERDADES: {r['id']} ({r['assignee']}, {r['status']}) {action} de "
              f"{r['old']}s a {r['new']}s (piso del perfil) -- \"{r['title']}\"")

    for hit in runtime_hits:
        print(f"ALERTA_RUNTIME: {hit['id']} ({hit['assignee']}) detectada tras {hit['elapsed_seconds']}s "
              f"sin max_runtime_seconds; solo detección, sin contención -- \"{hit['title']}\"")

    return 1 if (runtime_hits or patched or reconciled) else 0


if __name__ == "__main__":
    raise SystemExit(main())
