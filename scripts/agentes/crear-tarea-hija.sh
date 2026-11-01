#!/usr/bin/env bash
# Crea una tarea hija de Kanban que NO PUEDE nacer sin reloj nativo.
#
# La regla de `--max-runtime` ya estaba escrita en el canónico, con énfasis y
# con su motivo al lado, y falló en su primera prueba real: t_0e4d6e31
# (2026-10-26) se creó con `hermes kanban create --parent` pero sin el flag,
# y quedó corriendo sin límite hasta que un vigilante externo lo parcheó
# media hora después. Reforzar la prosa una vez más no arregla un fallo
# estructural -- este envoltorio sí, porque sin `--max-runtime` no llama a
# Hermes en absoluto.
#
# Uso:
#   bash scripts/agentes/crear-tarea-hija.sh --parent <id-padre> \
#     --max-runtime <segundos> --assignee <perfil> [--board <slug>] \
#     [--max-retries N] [--priority N] [--project <id|slug>] \
#     [--workspace <modo>] [--body-file <ruta>] [--created-by <actor>] \
#     -- <título de la tarea>
#
# Ejemplo:
#   bash scripts/agentes/crear-tarea-hija.sh --board arky-maintenance \
#     --parent t_3eb92119 --max-runtime 300 --max-retries 1 \
#     --assignee andres-integration --project arky-sup-factory \
#     --workspace worktree --body-file /tmp/cuerpo.md \
#     -- "Remediar #262: orden estable en invocationBranches"
#
# Sin --parent, sin --max-runtime o sin título tras `--`, este script se
# niega con un mensaje claro y código de salida != 0, sin tocar Kanban. No
# hay valor por defecto para --max-runtime a propósito: el número lo decide
# quien crea la tarea (el canónico lo dice en el paso 3), y un valor por
# defecto solo cambiaría "se olvidó" por "no se pensó".
set -euo pipefail

parent=""
max_runtime=""
board=""
extra_args=()
titulo=""

while [ $# -gt 0 ]; do
  case "$1" in
    --parent)
      parent="${2:?--parent necesita un valor}"
      extra_args+=(--parent "$2")
      shift 2
      ;;
    --max-runtime)
      max_runtime="${2:?--max-runtime necesita un valor}"
      extra_args+=(--max-runtime "$2")
      shift 2
      ;;
    --board)
      board="${2:?--board necesita un valor}"
      shift 2
      ;;
    --)
      shift
      titulo="$*"
      break
      ;;
    *)
      extra_args+=("$1" "$2")
      shift 2
      ;;
  esac
done

fallo=0
if [ -z "$parent" ]; then
  echo "crear-tarea-hija.sh: falta --parent <id-padre>. No se crea ninguna tarea." >&2
  fallo=1
fi
if [ -z "$max_runtime" ]; then
  echo "crear-tarea-hija.sh: falta --max-runtime <segundos>. No se crea ninguna tarea." >&2
  echo "  Esta es la regla que ya falló una vez estando escrita (t_0e4d6e31, 2026-10-26)." >&2
  echo "  El número lo decide la tarea; no hay valor por defecto a propósito." >&2
  fallo=1
fi
if [ -z "$titulo" ]; then
  echo "crear-tarea-hija.sh: falta el título tras '--'. No se crea ninguna tarea." >&2
  fallo=1
fi
if [ "$fallo" != 0 ]; then
  echo >&2
  echo "Uso: $0 --parent <id> --max-runtime <seg> --assignee <perfil> [...] -- <título>" >&2
  exit 2
fi

cmd=(hermes)
if [ -n "$board" ]; then
  cmd+=(kanban --board "$board" create)
else
  cmd+=(kanban create)
fi
cmd+=("$titulo" "${extra_args[@]}")

echo "+ ${cmd[*]}" >&2
exec "${cmd[@]}"
