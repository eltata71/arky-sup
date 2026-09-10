# ============================================================================
# Arky 10 — Makefile de mantenimiento profesional
# ----------------------------------------------------------------------------
# Target de uso diario para un mantenimiento productivo y consistente.
# Ejecutable con:  make <target>   (en git-bash / bash)
# ============================================================================

.PHONY: help install dev build typecheck lint lint-fix test test-ci test-watch \
        quality e2e e2e-install health audit build-check ci-check report \
        doctor baseline status branch new-feature

# --- Ayuda ------------------------------------------------------------------
help:
	@echo "Arky 10 - Mantenimiento. Targets disponibles:"
	@echo "  make install       Instala dependencias (npm install)"
	@echo "  make dev           Arranca el servidor de desarrollo (Vite)"
	@echo "  make typecheck     TypeScript strict (tsc --noEmit)"
	@echo "  make lint          ESLint 9 flat config"
	@echo "  make lint-fix      Auto-corrige lo que ESLint puede"
	@echo "  make test          Vitest en watch mode"
	@echo "  make test-ci       Vitest una sola pasada"
	@echo "  make quality       Puerta de calidad: typecheck + lint + test-ci"
	@echo "  make build         Build de produccion + warning de code-splitting"
	@echo "  make e2e           Playwright (e2e)"
	@echo "  make e2e-install   Instala navegadores Playwright"
	@echo "  make audit         npm audit + resumen de dependencias"
	@echo "  make health        Script de salud del entorno (.hermes/bin/health.sh)"
	@echo "  make baseline      Escribe reporte de baseline en .hermes/workspace/reports/"
	@echo "  make ci-check      Misma puerta que el CI de GitHub (npm run quality + build)"
	@echo "  make status        Git status + branch + ultimos commits"
	@echo "  make new-feature   Crear rama de feature desde main"

# --- Ciclo de vida ----------------------------------------------------------
install:
	npm install

dev:
	npm run dev

build:
	npm run build

typecheck:
	@NODE_OPTIONS="--max-old-space-size=6144" npm run typecheck

lint:
	npm run lint

lint-fix:
	npm run lint:fix

test:
	npm test

test-ci:
	npm run test:ci

test-watch:
	npm run test

quality:
	npm run quality

e2e:
	npm run e2e

e2e-install:
	npm run e2e:install

# --- Seguridad / mantenimiento ---------------------------------------------
audit:
	npm audit

# --- Salud del entorno ------------------------------------------------------
health:
	@bash .hermes/bin/health.sh

baseline:
	@mkdir -p .hermes/workspace/reports
	@bash .hermes/bin/health.sh > .hermes/workspace/reports/health-$$(date +%Y%m%d-%H%M).txt
	@echo "Reporte guardado en .hermes/workspace/reports/"

ci-check:
	@NODE_OPTIONS="--max-old-space-size=6144" npm run quality && npm run build

# --- Git --------------------------------------------------------------------
status:
	@echo "=== Branch ==="; git branch --show-current
	@echo "=== Status ==="; git status -s
	@echo "=== Ultimos commits ==="; git log --oneline -5

new-feature:
	@read -p "Nombre de la feature: " f; \
	git checkout main && git pull && git checkout -b "feature/$$f"
