#!/usr/bin/env bash
# ============================================================================
# Arky 10 — Runner de mantenimiento (funciona en Windows/git-bash y Linux)
# ----------------------------------------------------------------------------
# Replica los targets del Makefile sin depender de `make` (disponible en
# entornos Unix/CI pero normalmente ausente en Windows).
#
# Uso:  ./run.sh <target>      (o  bash run.sh <target>)
# Ayuda: ./run.sh help
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

show_help() {
  cat <<'EOF'
Arky 10 - Mantenimiento. Targets disponibles:

  install       Instala dependencias (npm install)
  dev           Arranca el servidor de desarrollo (Vite)
  typecheck     TypeScript strict (tsc --noEmit)
  lint          ESLint 9 flat config
  lint-fix      Auto-corrige lo que ESLint puede
  test          Vitest en watch mode
  test-ci       Vitest una sola pasada
  quality       Puerta de calidad: typecheck + lint + test-ci
  build         Build de produccion + warning de code-splitting
  e2e           Playwright (e2e)
  e2e-install   Instala navegadores Playwright
  audit         npm audit (produccion) + resumen
  health        Diagnostico del entorno (.hermes/bin/health.sh)
  baseline      Guarda reporte de salud con timestamp
  ci-check      Misma puerta que el CI: quality + build
  status        Branch + cambios + ultimos commits
  new-feature   Crea rama de feature desde main
EOF
}

case "${1:-help}" in
  install)      npm install ;;
  dev)          npm run dev ;;
  typecheck)    npm run typecheck ;;
  lint)         npm run lint ;;
  lint-fix)     npm run lint:fix ;;
  test)         npm test ;;
  test-ci)      npm run test:ci ;;
  quality)      npm run quality ;;
  build)        npm run build ;;
  e2e)          npm run e2e ;;
  e2e-install)  npm run e2e:install ;;
  audit)        echo "=== npm audit (produccion) ==="; npm audit --omit=dev; echo; echo "=== dependencias totales ==="; npm audit ;;
  health)       bash .hermes/bin/health.sh ;;
  baseline)
      mkdir -p .hermes/workspace/reports
      bash .hermes/bin/health.sh > ".hermes/workspace/reports/health-$(date +%Y%m%d-%H%M).txt"
      echo "Reporte guardado en .hermes/workspace/reports/"
      ;;
  ci-check)     npm run quality && npm run build ;;
  status)
      echo "=== Branch ==="; git branch --show-current
      echo "=== Status ==="; git status -s
      echo "=== Ultimos commits ==="; git log --oneline -5 ;;
  new-feature)
      read -rp "Nombre de la feature: " f
      git checkout main && git pull && git checkout -b "feature/$f" ;;
  help|-h|*)    show_help ;;
esac
