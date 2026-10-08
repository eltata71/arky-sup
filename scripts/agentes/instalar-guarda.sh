#!/usr/bin/env bash
# Activa los hooks de scripts/agentes/hooks/ para todos los worktrees del clon.
#   bash scripts/agentes/instalar-guarda.sh
# Ver docs/operacion/multiagente.md.
source "$(dirname "$0")/comun.sh"
git -C "$PRINCIPAL" config core.hooksPath scripts/agentes/hooks
echo "Guarda instalada: core.hooksPath = scripts/agentes/hooks"
