#!/usr/bin/env bash
# Limpieza segura del espacio de trabajo. En seco por defecto: sólo lista.
#   bash scripts/agentes/limpieza.sh            # qué se borraría
#   bash scripts/agentes/limpieza.sh --aplicar  # borrarlo
#
# Sólo toca lo que ya está en main y no tiene nada sin guardar:
#   - worktrees sin cambios, sin bloqueo (sin sesión viva) y fusionados;
#   - ramas locales fusionadas que ningún worktree tiene abiertas;
#   - ramas remotas cuya PR está fusionada (nunca main ni las de Dependabot).
# Un worktree con cambios o bloqueado se informa y se deja: decide una persona.
# Ver docs/operacion/multiagente.md.

source "$(dirname "$0")/comun.sh"

aplicar=no
[ "${1:-}" = --aplicar ] && aplicar=si
hacer() { if [ "$aplicar" = si ]; then "$@"; else echo "  [en seco] $*"; fi; }

actualizar_remoto
FUSIONADAS="$(ramas_con_pr_fusionada)"
fusionada() { { [ -n "$1" ] && grep -qxF "$1" <<<"$FUSIONADAS"; } || contenido_en_main "$2"; }

echo "== Worktrees"
while IFS='|' read -r ruta rama head bloq; do
  [ "$ruta" = "$PRINCIPAL" ] && continue
  fusionada "$rama" "$head" || continue
  sucio="$(cambios_sin_commit "$ruta")"
  if [ "$bloq" = si ]; then echo "  se deja (sesión viva): $ruta"; continue; fi
  if [ "$sucio" != 0 ]; then echo "  se deja ($sucio cambios sin commit): $ruta"; continue; fi
  hacer git worktree remove "$ruta"
done < <(listar_worktrees)
[ "$aplicar" = si ] && git worktree prune

echo "== Ramas locales"
abiertas="$(listar_worktrees | cut -d'|' -f2)"
rutas="$(listar_worktrees | cut -d'|' -f1)"
git for-each-ref refs/heads --format='%(refname:short)' | while read -r rama; do
  [ "$rama" = main ] && continue
  grep -qxF "$rama" <<<"$abiertas" && continue
  # La rama de una sesión de Claude Code (worktree-<nombre>) es de esa sesión mientras su worktree exista.
  case "$rama" in worktree-*) grep -q "/${rama#worktree-}\$" <<<"$rutas" && continue ;; esac
  fusionada "$rama" "$rama" && hacer git branch -D "$rama"
done

echo "== Ramas remotas con la PR fusionada"
remotas="$(git for-each-ref refs/remotes/origin --format='%(refname:lstrip=3)' \
  | grep -vxE 'main|HEAD|origin' | grep -v '^dependabot/' \
  | while read -r rama; do grep -qxF "$rama" <<<"$FUSIONADAS" && echo "$rama"; done || true)"
if [ -n "$remotas" ]; then
  # shellcheck disable=SC2086
  hacer git push origin --delete $remotas
fi

[ "$aplicar" = si ] || echo "Nada borrado. Repite con --aplicar para hacerlo."
