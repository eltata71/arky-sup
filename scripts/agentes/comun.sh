# shellcheck shell=bash
# Funciones compartidas por los scripts de operación multiagente.
# Ver docs/operacion/multiagente.md.

set -euo pipefail

# Raíz del checkout principal: el directorio del `.git` común a todos los worktrees.
PRINCIPAL="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"

# Donde nacen los worktrees de tarea, fuera del checkout principal para que
# ningún agente los vea como ficheros sin seguimiento del repositorio.
WORKTREES="${ARKY_WORKTREES:-$(dirname "$PRINCIPAL")/arky-sup-worktrees}"

actualizar_remoto() {
  git fetch origin --prune --quiet
}

# Ramas cuya PR ya está fusionada (una por línea). Una sola llamada a GitHub.
ramas_con_pr_fusionada() {
  gh pr list --state merged --limit 1000 --json headRefName --jq '.[].headRefName' | sort -u
}

# ¿El commit ya está contenido en origin/main?
contenido_en_main() {
  git merge-base --is-ancestor "$1" origin/main 2>/dev/null
}

# Imprime «ruta|rama|head|bloqueado» por worktree. rama vacía = HEAD separado.
listar_worktrees() {
  git worktree list --porcelain | awk '
    /^worktree / { if (r != "") print r "|" b "|" h "|" l; r = substr($0, 10); b = ""; h = ""; l = "no" }
    /^HEAD /     { h = substr($2, 1, 7) }
    /^branch /   { b = substr($2, 12) }
    /^locked/    { l = "si" }
    END          { if (r != "") print r "|" b "|" h "|" l }'
}

cambios_sin_commit() {
  git -C "$1" status --porcelain 2>/dev/null | wc -l | tr -d ' '
}
