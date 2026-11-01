#!/usr/bin/env bash
# Envoltorio seguro para `hermes kanban specify`. No es parte del core de
# Hermes: vive fuera de él a propósito (ver defecto t_4dec3959 en el tablero
# arky-maintenance). `specify` es el único comando nativo que saca una
# tarjeta de `triage`, pero llama a un LLM auxiliar que puede reescribir
# título y cuerpo y, al hacerlo, omitir restricciones explícitas que la
# tarjeta ya tenía (NO-GO, "no producción", "no servicios externos"...).
#
# Este script respalda título y cuerpo literales antes de llamar a `specify`,
# los restaura de inmediato con `hermes kanban edit`, y verifica BYTE A BYTE
# que lo restaurado es idéntico al original. Si la verificación no cuadra,
# sale con código distinto de cero y no sigue adelante — quien lo invoque debe
# pararse ahí y escalarlo, nunca reintentar a ciegas.
#
# El único cambio que deja `specify` es el que de verdad se busca: sacar la
# tarjeta de `triage`. El estado resultante (ready/todo/blocked, según
# dependencias) se conserva; solo título y cuerpo se fuerzan de vuelta.
#
# Uso:
#   scripts/agentes/safe-specify.sh <kanban.db> <board-slug> <task_id> [perfil]
#
# Ejemplo:
#   scripts/agentes/safe-specify.sh \
#     /home/tata/workspace/latam-factory-e2e/kanban.db \
#     latam-factory-e2e t_b065b9c4 jose
#
# Requiere el CLI `hermes` en PATH y python3. No toca nada de
# /home/tata/.local/share/hermes-agent-*; solo invoca su CLI público.
#
# Deja un respaldo permanente (antes/después, no solo temporal) en
# scripts/agentes/safe-specify-backups/<task_id>-<timestamp>.json y una línea
# en scripts/agentes/safe-specify.log — la evidencia de cada uso queda en el
# repositorio, no solo en la salida de la terminal.

set -euo pipefail

usage() {
  echo "Uso: $0 <kanban.db> <board-slug> <task_id> [perfil]" >&2
  echo "Ver cabecera del script para el porqué y las garantías." >&2
  exit 64
}

[ $# -ge 3 ] || usage

DB="$1"
BOARD="$2"
TASK="$3"
PROFILE="${4:-jose}"

[ -f "$DB" ] || { echo "safe-specify: no existe el fichero '$DB'" >&2; exit 1; }
command -v hermes >/dev/null || { echo "safe-specify: 'hermes' no está en PATH" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$HERE/safe-specify-backups"
LOG_FILE="$HERE/safe-specify.log"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BEFORE_JSON="$BACKUP_DIR/${TASK}-${STAMP}-before.json"
AFTER_JSON="$BACKUP_DIR/${TASK}-${STAMP}-after.json"

export HERMES_KANBAN_DB="$DB"
export HERMES_KANBAN_BOARD="$BOARD"

log() { echo "[safe-specify] $*"; }
fail() {
  echo "[safe-specify] FALLO: $*" >&2
  echo "$(date -u +%FT%TZ)  $DB  $BOARD  $TASK  FALLO: $*" >>"$LOG_FILE"
  exit 1
}

log "respaldando título/cuerpo/estado de $TASK antes de tocar nada"
python3 - "$DB" "$TASK" "$BEFORE_JSON" <<'PY'
import sqlite3, json, sys
db, task_id, out = sys.argv[1], sys.argv[2], sys.argv[3]
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
row = con.execute("select id, title, body, assignee, status from tasks where id=?", (task_id,)).fetchone()
if row is None:
    sys.stderr.write(f"safe-specify: no existe la tarea {task_id} en {db}\n")
    sys.exit(1)
json.dump(dict(row), open(out, "w"), ensure_ascii=False, indent=2)
print(f"status={row['status']}")
PY

STATUS_BEFORE="$(python3 -c "import json; print(json.load(open('$BEFORE_JSON'))['status'])")"
if [ "$STATUS_BEFORE" != "triage" ]; then
  fail "la tarea está en '$STATUS_BEFORE', no en 'triage'. specify solo tiene sentido ahí — abortando sin tocar nada."
fi

log "ejecutando 'hermes kanban specify' (perfil $PROFILE)"
hermes -p "$PROFILE" kanban specify "$TASK" --author safe-specify --json \
  || fail "'hermes kanban specify' terminó con error; la tarjeta puede seguir en triage o a medio especificar. Revisar a mano, no reintentar automáticamente."

log "restaurando título y cuerpo originales con 'hermes kanban edit'"
python3 - "$BEFORE_JSON" "$BACKUP_DIR/.title.$$" "$BACKUP_DIR/.body.$$" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
open(sys.argv[2], "w").write(d["title"])
open(sys.argv[3], "w").write(d["body"])
PY
TITLE="$(cat "$BACKUP_DIR/.title.$$")"
BODY="$(cat "$BACKUP_DIR/.body.$$")"
rm -f "$BACKUP_DIR/.title.$$" "$BACKUP_DIR/.body.$$"

hermes -p "$PROFILE" kanban edit "$TASK" --title "$TITLE" --body "$BODY" \
  || fail "'hermes kanban edit' terminó con error al intentar restaurar — la tarjeta puede haber quedado con el cuerpo reescrito por el LLM auxiliar. Revisar a mano."

log "verificando byte a byte contra el respaldo"
if ! python3 - "$DB" "$TASK" "$BEFORE_JSON" "$AFTER_JSON" <<'PY'
import sqlite3, json, sys
db, task_id, before_path, after_path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
row = con.execute("select id, title, body, assignee, status from tasks where id=?", (task_id,)).fetchone()
after = dict(row)
json.dump(after, open(after_path, "w"), ensure_ascii=False, indent=2)
before = json.load(open(before_path))
ok_title = after["title"] == before["title"]
ok_body = after["body"] == before["body"]
ok_assignee = after["assignee"] == before["assignee"]
print(f"title identico:    {ok_title}")
print(f"body identico:     {ok_body}")
print(f"assignee intacto:  {ok_assignee}")
print(f"status:            {before['status']} -> {after['status']}")
sys.exit(0 if (ok_title and ok_body and ok_assignee) else 1)
PY
then
  fail "la restauración NO es byte a byte idéntica al original. Respaldo en $BEFORE_JSON, estado tras el intento en $AFTER_JSON. No se reintenta solo: hace falta revisión manual."
fi

echo "$(date -u +%FT%TZ)  $DB  $BOARD  $TASK  OK  before=$BEFORE_JSON after=$AFTER_JSON" >>"$LOG_FILE"
log "OK: $TASK fuera de triage, título y cuerpo byte a byte idénticos al original."
log "respaldo: $BEFORE_JSON"
