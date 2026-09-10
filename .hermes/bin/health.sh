#!/usr/bin/env bash
# ============================================================================
# Arky 10 — Script de salud del entorno (.hermes/bin/health.sh)
# ----------------------------------------------------------------------------
# Diagnostica en un solo comando el estado del proyecto: tools, dependencias,
# calidad y seguridad. Se invoca via `make health` o directamente.
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "======================================================"
echo " Arky 10 - Health Check  ($(date '+%Y-%m-%d %H:%M:%S'))"
echo "======================================================"

# --- Tools ----------------------------------------------------------------
echo ""
echo "[TOOLS]"
for t in node npm git gh; do
  if command -v "$t" >/dev/null 2>&1; then
    printf "  %-6s %s\n" "$t:" "$("$t" --version 2>/dev/null | head -1)"
  else
    printf "  %-6s FALTA\n" "$t:"
  fi
done

# --- Git -------------------------------------------------------------------
echo ""
echo "[GIT]"
printf "  branch:  %s\n" "$(git branch --show-current 2>/dev/null || echo '(no git)')"
printf "  estado:  %s\n" "$(git status -s 2>/dev/null | wc -l | tr -d ' ') archivo(s) sin commit"
printf "  ultimo:  %s\n" "$(git log --oneline -1 2>/dev/null)"

# --- Dependencias ----------------------------------------------------------
echo ""
echo "[DEPENDENCIAS]"
if [ -d node_modules ]; then
  printf "  instaladas: %s paquetes\n" "$(ls node_modules 2>/dev/null | wc -l | tr -d ' ')"
else
  echo "  NO instaladas (npm install)"
fi
echo "  vulnerable: $(npm audit --omit=dev 2>/dev/null | grep -E '^[0-9]+ vulnerabilities' || echo 'n/a')"

# --- Calidad ---------------------------------------------------------------
echo ""
echo "[CALIDAD]"
printf "  typecheck: " ; if npm run typecheck >/dev/null 2>&1; then echo "OK"; else echo "FALLA"; fi
printf "  lint:      " ; if npm run lint >/dev/null 2>&1; then echo "OK"; else echo "FALLA"; fi
printf "  tests:     " ; npx vitest run 2>/dev/null | grep -Eo "Tests +[0-9]+ passed" | tail -1 || echo "n/a"

echo ""
echo "======================================================"
echo " Health Check finalizado."
echo "======================================================"
