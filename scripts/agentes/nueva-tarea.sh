#!/usr/bin/env bash
# Reserva una tarea del plan para un agente, sin pisar a otro.
#   bash scripts/agentes/nueva-tarea.sh <agente> <id> <tema>
#   bash scripts/agentes/nueva-tarea.sh claude 11.0 estandar-adm
#
# 1. Se niega si la tarea ya está «Hecha» en docs/plan-clase-mundial.md: una
#    tarea cerrada no se reabre; lo nuevo se propone como tarea nueva.
# 2. Se niega si otro agente ya la tiene: una rama remota o una PR abierta.
# 3. Crea la rama clase-mundial/<id>-<tema> desde origin/main en un worktree
#    propio, fuera del checkout principal.
# 4. La publica y abre una PR en borrador: ésa es la reserva que ven todos.
# Ver docs/operacion/multiagente.md.

source "$(dirname "$0")/comun.sh"

if [ $# -ne 3 ]; then
  echo "uso: $0 <agente> <id> <tema>   (p. ej. $0 claude 11.0 estandar-adm)" >&2
  exit 2
fi
agente="$1"; id="$2"; tema="$3"
rama="clase-mundial/${id}-${tema}"
ruta="$WORKTREES/${agente}-${id}"
plan="$PRINCIPAL/docs/plan-clase-mundial.md"

actualizar_remoto

fila="$(git show origin/main:docs/plan-clase-mundial.md | grep -E "^\| ${id//./\\.} " || true)"
if [ -z "$fila" ]; then
  echo "La tarea $id no está en la tabla de seguimiento de $plan. Una tarea nueva se propone al propietario antes de empezar." >&2
  exit 1
fi
if grep -q '| Hecha' <<<"$fila"; then
  echo "La tarea $id ya está Hecha: $fila" >&2
  echo "No se reabre. Si hace falta más trabajo, propónlo como tarea nueva." >&2
  exit 1
fi

ocupada="$(git for-each-ref "refs/remotes/origin/clase-mundial/${id}-*" --format='%(refname:lstrip=3)')"
if [ -n "$ocupada" ]; then
  echo "La tarea $id ya tiene rama remota: $ocupada" >&2
  gh pr list --head "$ocupada" --state all --json number,state,title \
    --jq '.[] | "  PR #\(.number) [\(.state)] \(.title)"' >&2
  exit 1
fi
abierta="$(gh pr list --state open --search "\"${id}\" in:title" --json number,title --jq '.[] | "#\(.number) \(.title)"')"
if [ -n "$abierta" ]; then
  echo "Ya hay una PR abierta que nombra $id:" >&2
  echo "  $abierta" >&2
  exit 1
fi

mkdir -p "$WORKTREES"
git worktree add -b "$rama" "$ruta" origin/main
# El worktree vive fuera del repositorio: sin esto no encuentra dependencias.
# Si la tarea cambia package.json, sustituye el enlace por un `npm ci` propio.
if [ -d "$PRINCIPAL/node_modules" ] && [ ! -e "$ruta/node_modules" ]; then
  ln -s "$PRINCIPAL/node_modules" "$ruta/node_modules"
fi
git -C "$ruta" commit --allow-empty -q -m "Reserva de la tarea ${id} (${agente})"
git -C "$ruta" push -u origin "$rama" --quiet
gh pr create --draft --head "$rama" --base main \
  --title "Ola ${id} [${agente}]: ${tema} (en curso)" \
  --body "Reserva de la tarea **${id}** de \`docs/plan-clase-mundial.md\` para **${agente}**.

Mientras esta PR esté abierta nadie más toma la tarea. Ver \`docs/operacion/multiagente.md\`."

echo
echo "Listo. Trabaja en: $ruta  (rama $rama)"
