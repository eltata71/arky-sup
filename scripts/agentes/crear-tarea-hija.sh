#!/usr/bin/env bash
# Crea una tarea hija de Kanban que NO PUEDE nacer sin reloj nativo.
#
# La regla de `--max-runtime` ya estaba escrita en el canónico, con énfasis y
# con su motivo al lado, y falló en su primera prueba real: t_0e4d6e31
# (2026-10-26) se creó con `hermes kanban create --parent` pero sin el flag,
# y quedó corriendo sin límite hasta que un vigilante externo lo parcheó
# media hora después. Reforzar la prosa una vez más no arregla un fallo
# estructural -- este envoltorio sí, porque sin `--max-runtime` no llama a
# Hermes en absoluto. La puerta nativa sigue abierta al lado (este script no
# puede cerrarla -- es el propio CLI de Hermes); lo que sí cierra esa puerta
# es scripts/agentes/require-max-runtime-on-create.py.referencia, un hook
# pre_tool_call independiente de este envoltorio. Ver el paso 3 del canónico.
#
# Uso:
#   bash scripts/agentes/crear-tarea-hija.sh --parent <id-padre> \
#     --max-runtime <segundos> --assignee <perfil> [--board <slug>] \
#     [--override-ceiling-reason <texto>] [--max-retries N] [--priority N] \
#     [--project <id|slug>] [--workspace <modo>] [--body-file <ruta>] \
#     [--created-by <actor>] -- <título de la tarea>
#
# Ejemplo:
#   bash scripts/agentes/crear-tarea-hija.sh --board arky-maintenance \
#     --parent t_3eb92119 --max-runtime 300 --max-retries 1 \
#     --assignee andres-integration --project arky-sup-factory \
#     --workspace worktree --body-file /tmp/cuerpo.md \
#     -- "Remediar #262: orden estable en invocationBranches"
#
# Sin --parent, sin --assignee, sin --max-runtime (entero positivo) o sin
# título tras `--`, este script se niega con un mensaje claro y código de
# salida != 0, sin tocar Kanban. Sin --assignee la hija cae en
# default_assignee: jose -- aterriza en José, justo lo que PR #295 le
# prohíbe ejecutar -- así que --assignee es tan obligatorio como los otros
# dos, no una comodidad.
#
# --max-runtime por encima de 300s (el techo del paso 5) se rechaza salvo
# que se acompañe de --override-ceiling-reason "<texto>": un presupuesto
# distinto requiere aprobación humana explícita y registrada en la propia
# llamada, no solo en la cabeza de quien la hizo.
#
# No hay valor por defecto para --max-runtime a propósito: el número lo
# decide quien crea la tarea (el canónico lo dice en el paso 3), y un valor
# por defecto solo cambiaría "se olvidó" por "no se pensó".
set -euo pipefail

RUNTIME_CEILING=300

parent=""
max_runtime=""
assignee=""
board=""
override_reason=""
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
      shift 2
      ;;
    --assignee)
      assignee="${2:?--assignee necesita un valor}"
      extra_args+=(--assignee "$2")
      shift 2
      ;;
    --board)
      board="${2:?--board necesita un valor}"
      shift 2
      ;;
    --override-ceiling-reason)
      override_reason="${2:?--override-ceiling-reason necesita un valor}"
      shift 2
      ;;
    --)
      shift
      titulo="$*"
      break
      ;;
    *)
      # Bandera desconocida: solo se consume un segundo token como su valor
      # si existe y no empieza por '-' -- --triage y similares son booleanas
      # (sin valor), y sin esta comprobación una al final de la línea revienta
      # bajo `set -u` en vez de dar un mensaje claro.
      if [ $# -ge 2 ] && [[ "$2" != -* ]]; then
        extra_args+=("$1" "$2")
        shift 2
      else
        extra_args+=("$1")
        shift 1
      fi
      ;;
  esac
done

fallo=0
if [ -z "$parent" ]; then
  echo "crear-tarea-hija.sh: falta --parent <id-padre>. No se crea ninguna tarea." >&2
  fallo=1
fi
if [ -z "$assignee" ]; then
  echo "crear-tarea-hija.sh: falta --assignee <perfil>. No se crea ninguna tarea." >&2
  echo "  Sin él la hija cae en default_assignee: jose -- aterriza en José," >&2
  echo "  justo lo que PR #295 le prohíbe ejecutar. No hay valor por defecto." >&2
  fallo=1
fi
if [ -z "$max_runtime" ]; then
  echo "crear-tarea-hija.sh: falta --max-runtime <segundos>. No se crea ninguna tarea." >&2
  echo "  Esta es la regla que ya falló una vez estando escrita (t_0e4d6e31, 2026-10-26)." >&2
  echo "  El número lo decide la tarea; no hay valor por defecto a propósito." >&2
  fallo=1
elif ! [[ "$max_runtime" =~ ^[0-9]+$ ]] || [ "$max_runtime" -le 0 ]; then
  echo "crear-tarea-hija.sh: --max-runtime debe ser un entero positivo (recibido: '$max_runtime'). No se crea ninguna tarea." >&2
  fallo=1
elif [ "$max_runtime" -gt "$RUNTIME_CEILING" ] && [ -z "$override_reason" ]; then
  echo "crear-tarea-hija.sh: --max-runtime $max_runtime supera el techo de ${RUNTIME_CEILING}s del paso 5. No se crea ninguna tarea." >&2
  echo "  Un presupuesto distinto requiere --override-ceiling-reason \"<motivo>\" con aprobación humana explícita." >&2
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

extra_args+=(--max-runtime "$max_runtime")
if [ -n "$override_reason" ] && [ "$max_runtime" -gt "$RUNTIME_CEILING" ]; then
  echo "crear-tarea-hija.sh: --max-runtime $max_runtime excede el techo de ${RUNTIME_CEILING}s -- motivo registrado: $override_reason" >&2
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
