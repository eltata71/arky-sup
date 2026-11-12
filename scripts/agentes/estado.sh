#!/usr/bin/env bash
# Estado del espacio de trabajo con varios agentes. Sólo lee: no cambia nada.
# Sale con 1 si hay avisos: un agente no empieza una tarea con avisos abiertos.
#   bash scripts/agentes/estado.sh
# Ver docs/operacion/multiagente.md.
#
# Alcance de cada chequeo, fijado el 2026-11-12 con autorización de Jose
# (relayada: "autorizo los dos temas que me propusiste y sugeriste"), tras
# que una auditoría legítima en curso (t_c3a8b0d7, worktree ajeno antiguo y
# sucio por estar bloqueada esperando una decisión) bloqueara 10 de 12
# correcciones no relacionadas con ella:
#   - El checkout principal (abajo) sigue siendo GLOBAL: es el recurso que
#     documenta docs/operacion/multiagente.md como origen de la regla (el
#     incidente real del 2026-10-07 fue sobre él, no sobre worktrees
#     ajenos), y es el único sitio que todos comparten — no hay "worktree
#     propio" que lo sustituya.
#   - El bucle de worktrees de abajo sólo BLOQUEA (cuenta un aviso, exit 1)
#     sobre el worktree desde el que se invoca este script — el de la
#     tarea que está a punto de empezar. El texto original de la regla 5
#     en multiagente.md ya hablaba en singular ("una tarea", no "cualquier
#     tarea de la flota"); el bucle global era el modo en que
#     `listar_worktrees` se implementó, no una decisión escrita aparte.
#   - La fila de cada worktree ajeno SIGUE IMPRIMIÉNDOSE (visibilidad), y
#     un worktree ajeno sucio sobre base antigua/fusionada sigue
#     reportándose — pero como ATENCION en estado-fabrica.py (el
#     vigilante, que ya revisa la flota por edad), no como bloqueo aquí.
#     Lo que se quita es el frenazo a quien no tiene nada que ver; la
#     señal de que algo anda raro en otro worktree no desaparece, cambia
#     de canal.

source "$(dirname "$0")/comun.sh"
actualizar_remoto
FUSIONADAS="$(ramas_con_pr_fusionada)"
AQUI="$(git rev-parse --show-toplevel 2>/dev/null || true)"
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
  if [ "$sucio" != 0 ] && { [ "$estado" = fusionada ] || [ "$estado" = antigua ]; }; then
    motivo="cambios sin commit sobre $([ "$estado" = fusionada ] && echo 'una tarea ya fusionada — ¿alguien la reabrió?' || echo 'una base anterior a main — rebasa antes de seguir.')"
    if [ "$ruta" = "$AQUI" ]; then
      echo "  AVISO: $motivo"
      avisos=$((avisos + 1))
    else
      echo "  (sin bloquear — no es tu worktree) $ruta: $motivo — lo vigila estado-fabrica.py"
    fi
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
git for-each-ref refs/remotes/origin --format='%(refname:lstrip=3)' \
  | while read -r rama; do
      case "$rama" in main|HEAD|origin) continue ;; esac
      if grep -qxF "$rama" <<<"$FUSIONADAS"; then echo "  $rama"; fi
    done | sed -n '1,200p' | awk '{print} END {print "  (" NR " ramas)"}'

echo
if [ "$avisos" = 0 ]; then echo "Sin avisos."; else echo "$avisos aviso(s): resuélvelos antes de empezar."; exit 1; fi
