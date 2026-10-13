#!/usr/bin/env bash
# ¿En qué plan está una tarea, y se puede reservar? Sólo lee: no cambia nada.
#   bash scripts/agentes/localizar-tarea.sh <id>
#   bash scripts/agentes/localizar-tarea.sh 15.0
#
# Imprime «plan|prefijo|fila» y sale con 0 si la tarea está abierta. Busca el id
# en la tabla de seguimiento de cada plan de PLANES, tal como está en
# origin/main: lo que diga una copia local sin publicar no es la verdad que ven
# los demás agentes.
#
# Códigos de salida (nueva-tarea.sh los traduce):
#   0 abierta · 1 Hecha o Descartada (no se reabre) · 3 en ningún plan
#   4 en más de un plan (ambigua: fija ARKY_PLAN) · 2 uso incorrecto
#
# ARKY_PLAN=<fichero> fuerza el plan; ARKY_PLANES_DIR=<dir> lee los planes de
# un directorio en vez de origin/main (lo usan las pruebas).
# Ver docs/operacion/multiagente.md.

source "$(dirname "$0")/comun.sh"

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "uso: $0 <id>   (p. ej. $0 15.0)" >&2
  exit 2
fi
id="$1"
patron="^\| ${id//./\\.} "

encontrados=()
for entrada in "${PLANES[@]}"; do
  plan="${entrada%%|*}"
  if [ -n "${ARKY_PLAN:-}" ] && [ "$plan" != "$ARKY_PLAN" ]; then continue; fi
  fila="$(leer_plan "$plan" | grep -E "$patron" | head -n 1 || true)"
  [ -n "$fila" ] && encontrados+=("${entrada}|${fila}")
done

if [ "${#encontrados[@]}" -eq 0 ]; then
  echo "La tarea $id no está en la tabla de seguimiento de ningún plan (${PLANES[*]%%|*})." >&2
  echo "Una tarea nueva se propone al propietario antes de empezar." >&2
  exit 3
fi
if [ "${#encontrados[@]}" -gt 1 ]; then
  echo "La tarea $id aparece en más de un plan; fija cuál con ARKY_PLAN=<fichero>:" >&2
  printf '  %s\n' "${encontrados[@]%%|*}" >&2
  exit 4
fi

resultado="${encontrados[0]}"
fila="${resultado#*|*|}"
if grep -qE '\| (Hecha|Descartada)' <<<"$fila"; then
  echo "La tarea $id está cerrada: $fila" >&2
  echo "No se reabre. Si hace falta más trabajo, propónlo como tarea nueva." >&2
  exit 1
fi
echo "$resultado"
