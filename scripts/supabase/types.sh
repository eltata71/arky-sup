#!/usr/bin/env bash
# Only the exposed API contract is generated, never auth/private internals.
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ $# -eq 1 && ( "$1" == write || "$1" == check ) ]] || exit 2
[[ "$(supabase --version)" == "$(<supabase/.cli-version)" ]] || { printf 'Supabase CLI version mismatch\n' >&2; exit 1; }
unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD
target=supabase/database.types.ts
temporary=$(mktemp)
trap 'rm -f "$temporary"' EXIT
if ! supabase gen types typescript --local --schema api > "$temporary"; then
  printf 'Type generation failed:\n%s\n' "$(<"$temporary")" >&2
  exit 1
fi
# CLI 2.117 emits a harmless extra newline at EOF. Normalize it so the
# committed contract remains compatible with the repository's whitespace gate.
python3 - "$temporary" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
path.write_text(path.read_text().rstrip() + '\n')
PY
[[ -s "$temporary" && "$(<"$temporary")" == *'export type Database'* ]] || { printf 'Missing Database contract; refusing to replace types\n' >&2; exit 1; }
if [[ "$1" == write ]]; then
  cp "$temporary" "$target"
else
  [[ -f "$target" ]] || { printf 'Missing real generated baseline: run bash scripts/supabase/local.sh types with Docker available. No hand-written substitute is accepted.\n' >&2; exit 1; }
  diff -u "$target" "$temporary"
fi
