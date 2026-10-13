#!/usr/bin/env bash
# Reserva una tarea del plan para un agente, sin pisar a otro.
#   bash scripts/agentes/nueva-tarea.sh <agente> <id> <tema>
#   bash scripts/agentes/nueva-tarea.sh claude 11.0 estandar-adm
#
# 1. Busca la tarea en la tabla de seguimiento de cada plan (localizar-tarea.sh)
#    y se niega si no está en ninguno o si está «Hecha» o «Descartada»: una
#    tarea cerrada no se reabre; lo nuevo se propone como tarea nueva.
# 2. Se niega si otro agente ya la tiene: una rama remota o una PR abierta.
# 3. Crea la rama <prefijo>/<id>-<tema> desde origin/main —`clase-mundial/`
#    para docs/plan-clase-mundial.md, `agentes/` para docs/plan-agentes-ia.md—
#    en un worktree propio, fuera del checkout principal.
# 4. La publica y abre una PR en borrador: ésa es la reserva que ven todos.
# Ver docs/operacion/multiagente.md.

source "$(dirname "$0")/comun.sh"

if [ $# -ne 3 ]; then
  echo "uso: $0 <agente> <id> <tema>   (p. ej. $0 claude 11.0 estandar-adm)" >&2
  exit 2
fi
agente="$1"; id="$2"; tema="$3"

actualizar_remoto

# Los mensajes de rechazo los escribe localizar-tarea.sh; aquí sólo se para.
localizada="$(bash "$(dirname "$0")/localizar-tarea.sh" "$id")" || exit 1
plan="${localizada%%|*}"
resto="${localizada#*|}"
prefijo="${resto%%|*}"
rama="${prefijo}/${id}-${tema}"
ruta="$WORKTREES/${agente}-${id}"

ocupada="$(git for-each-ref "refs/remotes/origin/${prefijo}/${id}-*" --format='%(refname:lstrip=3)')"
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
  --body "Reserva de la tarea **${id}** de \`${plan}\` para **${agente}**.

Mientras esta PR esté abierta nadie más toma la tarea. Ver \`docs/operacion/multiagente.md\`."

echo
echo "Listo. Trabaja en: $ruta  (rama $rama)"
