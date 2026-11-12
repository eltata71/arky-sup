#!/usr/bin/env bash
# Repara los enlaces de la skill canónica latam-factory-orchestration.
#
# Por qué existe (hallazgos 2 y 3 de la revisión independiente del PR #293,
# 2026-10-26): los 18 enlaces se crearon con un comando de shell, una vez, a
# mano -- una acción de sistema de ficheros fuera de control de versiones.
# Dos consecuencias si nadie repara esto:
#   1. Un perfil nuevo (clonado, restaurado, o dado de alta por
#      nuevo-proyecto.sh) puede nacer con una COPIA real del fichero en vez
#      de un enlace, y se bifurca en silencio -- exactamente el defecto que
#      el PR #293 existe para cerrar, entrando por la puerta de atrás.
#   2. Hermes ya tiene un curador que reescribe directorios de skills
#      (`.curator_ledger.jsonl` / `.curator_backups` con fecha en cada
#      perfil -- no es hipotético, ya pasó una vez). Si alguna vez sustituye
#      un enlace por un fichero, ese perfil se bifurca sin aviso: un enlace
#      roto o reemplazado en una carpeta de skills no da ningún error
#      visible, Hermes simplemente deja de cargar la skill.
#
# Qué hace: para cada perfil que YA TIENE el directorio
# skills/latam-factory-orchestration/ (nunca lo crea donde no existía --
# eso sería inventar quién debe tener la skill, decisión que no es de este
# script), asegura que SKILL.md es un enlace simbólico RELATIVO que resuelve
# exactamente al fichero canónico del repo. Si es un fichero real, un enlace
# roto, o un enlace a otro sitio, lo reemplaza. Idempotente: correrlo sobre
# un perfil ya correcto no hace nada y no lo dice como si fuera un cambio.
#
# Enlaces relativos, no absolutos (hallazgo de la revisión, confirmado con
# `ls -l`: eran absolutos hasta este script): un enlace absoluto
# (/home/tata/workspace/arky-sup/...) solo sirve si esa ruta exacta existe;
# uno relativo (../../../../../workspace/arky-sup/...) sobrevive a que todo
# el árbol de /home/tata se mueva o se restaure en otra ruta, mientras
# .hermes/profiles/ y workspace/ se muevan juntos -- el escenario real de
# backup/restauración, no el de "la ruta absoluta cambia pero nada más".
#
# Uso:
#   scripts/agentes/enlazar-skill-canonica.sh [--quiet]
#
# Código de salida: 0 siempre que el canónico exista (reparar es su trabajo,
# no un fallo); 1 si el propio fichero canónico no se encuentra -- ahí no
# hay nada que enlazar y hay que decirlo alto, no en silencio.
set -euo pipefail

CANON="/home/tata/workspace/arky-sup/scripts/agentes/skills/latam-factory-orchestration/SKILL.md"
PROFILES_DIR="/home/tata/.hermes/profiles"
SKILL_REL="skills/latam-factory-orchestration/SKILL.md"
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

if [ ! -f "$CANON" ]; then
  echo "ENLAZAR-SKILL-CANONICA: falta el canónico ($CANON) -- no se toca ningún perfil." >&2
  exit 1
fi

fixed=0
checked=0
for profile_dir in "$PROFILES_DIR"/*/; do
  profile="$(basename "$profile_dir")"
  [ "$profile" = ".deleted" ] && continue
  target="${profile_dir}${SKILL_REL}"
  skill_dir="$(dirname "$target")"
  [ -d "$skill_dir" ] || continue  # este perfil nunca tuvo la skill -- no se inventa
  checked=$((checked + 1))

  rel="$(python3 -c "import os,sys; print(os.path.relpath(sys.argv[1], start=sys.argv[2]))" "$CANON" "$skill_dir")"

  if [ -L "$target" ]; then
    current="$(readlink "$target")"
    resolved="$(readlink -f "$target" 2>/dev/null || true)"
    canon_resolved="$(readlink -f "$CANON")"
    if [ "$current" = "$rel" ] && [ "$resolved" = "$canon_resolved" ]; then
      continue  # ya correcto, relativo, y resuelve al canónico -- nada que hacer
    fi
  fi

  # No es enlace correcto: fichero real, enlace absoluto, enlace roto, o
  # enlace a otro sitio. Se repara siempre hacia el canónico -- José decidió
  # una sola fuente sin sincronización, no hay caso en que "dejarlo como
  # está" sea correcto.
  rm -f "$target"
  ln -s "$rel" "$target"
  fixed=$((fixed + 1))
  [ "$QUIET" -eq 1 ] || echo "REPARADO: $profile -> $rel"
done

if [ "$QUIET" -eq 0 ]; then
  if [ "$fixed" -eq 0 ]; then
    echo "sin cambios -- $checked perfil(es) con la skill, todos ya enlazados en correcto"
  else
    echo "reparados $fixed de $checked perfil(es) con la skill"
  fi
fi
exit 0
