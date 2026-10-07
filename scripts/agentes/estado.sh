#!/usr/bin/env bash
# Estado del espacio de trabajo con varios agentes. Sólo lee: no cambia nada.
# Sale con 1 si hay avisos: un agente no empieza una tarea con avisos abiertos.
#   bash scripts/agentes/estado.sh
# Ver docs/operacion/multiagente.md.

source "$(dirname "$0")/comun.sh"
actualizar_remoto
FUSIONADAS="$(ramas_con_pr_fusionada)"
avisos=0

echo "== main"
echo "origin/main  $(git log -1 --format='%h %s' origin/main)"

echo
echo "== Checkout principal ($PRINCIPAL)"
rama_principal="$(git -C "$PRINCIPAL" rev-parse --abbrev-ref HEAD)"
sucio_principal="$(git -C "$PRINCIPAL" status --porcelain --untracked-files=normal -- . ':!.claude/worktrees' | wc -l | tr -d ' ')"
echo "rama=$rama_principal  cambios=$sucio_principal"
if [ "$rama_principal" != main ] || [ "$sucio_principal" != 0 ]; then
  echo "  AVISO: el checkout principal sólo sigue a main y no se edita. Trabaja en un worktree (nueva-tarea.sh)."
  avisos=$((avisos + 1))
fi

echo
echo "== Worktrees"
printf '%-9s %-6s %-5s %-45s %s\n' ESTADO CAMBIO BLOQ RAMA RUTA
while IFS='|' read -r ruta rama head bloq; do
  [ "$ruta" = "$PRINCIPAL" ] && continue
  sucio="$(cambios_sin_commit "$ruta")"
  if [ -n "$rama" ] && grep -qxF "$rama" <<<"$FUSIONADAS"; then estado=fusionada
  elif [ "$head" = "$(git rev-parse --short=7 origin/main)" ]; then estado=nueva
  elif contenido_en_main "$head"; then estado=antigua
  else estado=activa; fi
  printf '%-9s %-6s %-5s %-45s %s\n' "$estado" "$sucio" "$bloq" "${rama:-(separado $head)}" "$ruta"
  if [ "$sucio" != 0 ] && [ "$estado" = fusionada ]; then
    echo "  AVISO: cambios sin commit sobre una tarea ya fusionada — ¿alguien la reabrió?"
    avisos=$((avisos + 1))
  elif [ "$sucio" != 0 ] && [ "$estado" = antigua ]; then
    echo "  AVISO: cambios sin commit sobre una base anterior a main — rebasa antes de seguir."
    avisos=$((avisos + 1))
  fi
done < <(listar_worktrees)

echo
echo "== Ramas locales sin publicar (sin upstream y con commits fuera de main)"
git for-each-ref refs/heads --format='%(refname:short)|%(upstream:short)' | while IFS='|' read -r rama up; do
  [ -z "$up" ] || continue
  n="$(git rev-list --count "origin/main..$rama")"
  [ "$n" = 0 ] || echo "  $rama  ($n commits sin publicar)"
done

echo
echo "== PR abiertas (cada tarea en curso tiene la suya)"
gh pr list --state open --json number,title,headRefName,isDraft \
  --jq '.[] | "  #\(.number) \(if .isDraft then "[borrador] " else "" end)\(.headRefName) — \(.title)"'

echo
echo "== Ramas remotas con la PR ya fusionada (candidatas a limpieza.sh)"
git for-each-ref refs/remotes/origin --format='%(refname:lstrip=3)' | grep -vxE 'main|HEAD|origin' \
  | while read -r rama; do grep -qxF "$rama" <<<"$FUSIONADAS" && echo "  $rama"; done | sed -n '1,200p' | awk '{print} END {print "  (" NR " ramas)"}'

echo
if [ "$avisos" = 0 ]; then echo "Sin avisos."; else echo "$avisos aviso(s): resuélvelos antes de empezar."; exit 1; fi
