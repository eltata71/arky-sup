#!/usr/bin/env bash
# Crea una tarea hija de Kanban que NO PUEDE nacer sin reloj nativo, sin
# prioridad razonada ni dependencia declarada.
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
# `--priority`/`--priority-reason` y `--parent-reason` existen por la misma
# razón, con un segundo incidente real detrás: el 2026-11-03 el tablero
# `arky-maintenance` tenía 16 tarjetas bloqueadas numeradas con la convención
# Unix (0 = más urgente) mientras el despachador ordena `priority DESC` (el
# número MÁS ALTO se atiende primero) -- lo más crítico estaba al final de la
# cola, y nadie podía leer el tablero y saber qué seguía. No fue un número mal
# puesto una vez: fue que nada obligaba a razonar el número, así que cada
# quien eligió por su cuenta con la convención que tenía en la cabeza. Esto
# cierra la puerta de este envoltorio -- la puerta nativa (`hermes kanban
# create` a mano, sin pasar por aquí) sigue abierta, igual que con
# `--max-runtime` antes de que existiera `require-max-runtime-on-create.py`;
# un hook equivalente para `--priority` queda fuera de este cambio, no
# construido todavía.
#
# Uso:
#   bash scripts/agentes/crear-tarea-hija.sh --parent <id-padre> \
#     --parent-reason <texto> --max-runtime <segundos> --assignee <perfil> \
#     --priority <N> --priority-reason <texto> [--board <slug>] \
#     [--override-ceiling-reason <texto>] [--max-retries N] \
#     [--parent <otro-id-padre> ...] [--project <id|slug>] \
#     [--workspace <modo>] [--body <texto> | --body-file <ruta>] \
#     [--created-by <actor>] -- <título de la tarea>
#
# Ejemplo:
#   bash scripts/agentes/crear-tarea-hija.sh --board arky-maintenance \
#     --parent t_3eb92119 --parent-reason "no puede empezar hasta que 16a confirme el alcance" \
#     --max-runtime 300 --max-retries 1 --priority 12 \
#     --priority-reason "defecto de código #262, por delante del endurecimiento" \
#     --assignee andres-integration --project arky-sup-factory \
#     --workspace worktree --body-file /tmp/cuerpo.md \
#     -- "Remediar #262: orden estable en invocationBranches"
#
# Sin --parent (al menos uno), sin --parent-reason, sin --assignee, sin
# --max-runtime (entero positivo), sin --priority (entero) o su
# --priority-reason, o sin título tras `--`, este script se niega con un
# mensaje claro y código de salida != 0, sin tocar Kanban. Sin --assignee la
# hija cae en default_assignee: jose -- aterriza en José, justo lo que PR
# #295 le prohíbe ejecutar -- así que --assignee es tan obligatorio como los
# demás, no una comodidad.
#
# --max-runtime por encima de 300s (el techo del paso 5) se rechaza salvo
# que se acompañe de --override-ceiling-reason "<texto>": un presupuesto
# distinto requiere aprobación humana explícita y registrada en la propia
# llamada, no solo en la cabeza de quien la hizo.
#
# No hay valor por defecto para --max-runtime ni para --priority a propósito:
# el número lo decide quien crea la tarea (el canónico lo dice en el paso 3),
# y un valor por defecto solo cambiaría "se olvidó" por "no se pensó". Las
# razones (--priority-reason, --parent-reason) no van al número en sí -- van
# al cuerpo de la tarjeta, en texto plano, para que se lean al abrirla sin
# tener que preguntarle a quien la creó.
set -euo pipefail

RUNTIME_CEILING=300

parents=()
parent_reason=""
max_runtime=""
assignee=""
board=""
override_reason=""
priority=""
priority_reason=""
body_text=""
body_file=""
extra_args=()
titulo=""

while [ $# -gt 0 ]; do
  case "$1" in
    --parent)
      parents+=("${2:?--parent necesita un valor}")
      extra_args+=(--parent "$2")
      shift 2
      ;;
    --parent-reason)
      parent_reason="${2:?--parent-reason necesita un valor}"
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
    --priority)
      priority="${2:?--priority necesita un valor}"
      shift 2
      ;;
    --priority-reason)
      priority_reason="${2:?--priority-reason necesita un valor}"
      shift 2
      ;;
    --body)
      body_text="${2:?--body necesita un valor}"
      shift 2
      ;;
    --body-file)
      body_file="${2:?--body-file necesita un valor}"
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
if [ "${#parents[@]}" -eq 0 ]; then
  echo "crear-tarea-hija.sh: falta --parent <id-padre> (al menos uno). No se crea ninguna tarea." >&2
  fallo=1
elif [ -z "$parent_reason" ]; then
  echo "crear-tarea-hija.sh: falta --parent-reason <texto>. No se crea ninguna tarea." >&2
  echo "  Por qué depende de ese padre (o esos padres) va al cuerpo de la tarjeta," >&2
  echo "  en texto plano -- no basta con declarar el enlace, hay que poder leer el motivo." >&2
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
if [ -z "$priority" ]; then
  echo "crear-tarea-hija.sh: falta --priority <N>. No se crea ninguna tarea." >&2
  echo "  El despachador ordena priority DESC: el número MÁS ALTO se atiende primero." >&2
  echo "  No hay valor por defecto a propósito -- mismo motivo que --max-runtime." >&2
  fallo=1
elif ! [[ "$priority" =~ ^-?[0-9]+$ ]]; then
  echo "crear-tarea-hija.sh: --priority debe ser un entero (recibido: '$priority'). No se crea ninguna tarea." >&2
  fallo=1
elif [ -z "$priority_reason" ]; then
  echo "crear-tarea-hija.sh: falta --priority-reason <texto>. No se crea ninguna tarea." >&2
  echo "  Por qué ese número y no otro va al cuerpo de la tarjeta, en texto plano." >&2
  fallo=1
fi
if [ -n "$body_text" ] && [ -n "$body_file" ]; then
  echo "crear-tarea-hija.sh: --body y --body-file son mutuamente excluyentes." >&2
  fallo=1
fi
if [ -z "$titulo" ]; then
  echo "crear-tarea-hija.sh: falta el título tras '--'. No se crea ninguna tarea." >&2
  fallo=1
fi
if [ "$fallo" != 0 ]; then
  echo >&2
  echo "Uso: $0 --parent <id> --parent-reason <texto> --max-runtime <seg> --assignee <perfil> --priority <N> --priority-reason <texto> [...] -- <título>" >&2
  exit 2
fi

extra_args+=(--max-runtime "$max_runtime" --priority "$priority")
if [ -n "$override_reason" ] && [ "$max_runtime" -gt "$RUNTIME_CEILING" ]; then
  echo "crear-tarea-hija.sh: --max-runtime $max_runtime excede el techo de ${RUNTIME_CEILING}s -- motivo registrado: $override_reason" >&2
fi

# El cuerpo original (si lo hay) se conserva entero; la nota de prioridad y
# dependencia va delante, para que se lea sin tener que bajar a buscarla.
cuerpo_original=""
if [ -n "$body_file" ]; then
  if [ "$body_file" = "-" ]; then
    cuerpo_original="$(cat)"
  else
    cuerpo_original="$(cat "$body_file")"
  fi
elif [ -n "$body_text" ]; then
  cuerpo_original="$body_text"
fi

nota_cuerpo="**Prioridad $priority.** $priority_reason

**Depende de ${parents[*]}.** $parent_reason"

tmp_body="$(mktemp)"
trap 'rm -f "$tmp_body"' EXIT
if [ -n "$cuerpo_original" ]; then
  printf '%s\n\n---\n\n%s\n' "$nota_cuerpo" "$cuerpo_original" > "$tmp_body"
else
  printf '%s\n' "$nota_cuerpo" > "$tmp_body"
fi
extra_args+=(--body-file "$tmp_body")

cmd=(hermes)
if [ -n "$board" ]; then
  cmd+=(kanban --board "$board" create)
else
  cmd+=(kanban create)
fi
cmd+=("$titulo" "${extra_args[@]}")

echo "+ ${cmd[*]}" >&2
# No exec: el temporal del cuerpo tiene que sobrevivir hasta que hermes lo
# lea, y exec sustituye este proceso sin pasar por el trap de limpieza.
"${cmd[@]}"
estado=$?
rm -f "$tmp_body"
exit "$estado"
