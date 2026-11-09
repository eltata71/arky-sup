#!/usr/bin/env bash
# Centinela de cron para scripts/agentes/estado-fabrica.py (repo arky-sup).
#
# Es wrapper, no copia: igual que vigilancia-tarjetas.sh / vigilar-autorrevision.sh /
# vigilar-limites.sh, invoca el canónico por ruta absoluta para que un merge en main
# surta efecto en el siguiente tick, sin que nadie tenga que sincronizar nada a mano.
# Antes de este wrapper, estado-fabrica.py vivía como una copia plana instalada en
# ~/.hermes/profiles/<perfil>/scripts/, que divergió del canónico desde el 25-oct --
# y cuando por fin se sincronizó (8-nov), resultó que el canónico necesita pyyaml
# desde el commit daa7695 (2026-11-01), que el intérprete propio de Hermes (el que
# el modo no-agent del cron usa por defecto) no tiene instalado: el cron llevó 808
# fallos consecutivos sin que nadie se enterara, porque "activo" no es lo mismo que
# "produciendo".
#
# INTERPRETE FIJADO AQUI A PROPOSITO, no en la config del job (`hermes cron edit
# --interpreter`): si el día que alguien reinstale o actualice el intérprete de
# Hermes esto vuelve a romperse, la razón tiene que estar en un fichero versionado
# en git, no colgando de un flag que nadie recuerda que existe. Si el Python del
# sistema cambia de ruta, actualízala aquí -- y si deja de tener pyyaml, instálalo
# ahí o fija aquí otro intérprete que lo tenga; cualquiera de las dos cosas se nota
# sola la próxima corrida, ver más abajo.
INTERPRETER=/usr/bin/python3
REPO=/home/tata/workspace/arky-sup
SCRIPT="${REPO}/scripts/agentes/estado-fabrica.py"
RESULT_FILE="${HOME}/.hermes/logs/estado-fabrica.json"
STATE_FILE="${HOME}/.hermes/logs/estado-fabrica-watch.consecutive-failures"

# "El propio vigilante lleva fallando" (hallazgo 2026-11-09, 808 fallos consecutivos
# sin aviso): con el tick de 15 min, 3 fallos consecutivos son 45 min en silencio --
# bastante para notarlo sin disparar por un único fallo transitorio (p. ej. un deploy
# a mitad de tick), pero mucho antes de llegar a los cientos que costaron un mes.
SELF_FAILURE_ALERT_THRESHOLD=3

fail() {
  local reason="$1" consecutive
  consecutive=$(($(cat "$STATE_FILE" 2>/dev/null || echo 0) + 1))
  echo "$consecutive" > "$STATE_FILE"
  echo "VIGILANTE CAIDO (intento $consecutive consecutivo): $reason"
  if [ "$consecutive" -ge "$SELF_FAILURE_ALERT_THRESHOLD" ]; then
    echo "ATENCION: el propio vigilante de estado-fabrica lleva $consecutive ticks seguidos sin producir una lectura válida -- esto es exactamente el fallo silencioso que costó un mes: un vigilante 'activo' en el cron que en la práctica no vigila nada. Repararlo es prioritario sobre cualquier otro hallazgo de este informe, porque mientras esté así no hay ningún otro hallazgo llegando."
  fi
  exit 1
}

if [ ! -x "$INTERPRETER" ]; then
  fail "el intérprete fijado ($INTERPRETER) ya no existe o no es ejecutable en esta máquina -- actualiza INTERPRETER en este wrapper (scripts/agentes/estado-fabrica-watch.sh)"
fi
if ! "$INTERPRETER" -c 'import yaml' >/dev/null 2>&1; then
  fail "el intérprete fijado ($INTERPRETER) no tiene pyyaml instalado -- el canónico lo necesita desde el commit daa7695 (2026-11-01, auto_decompose/hooks por perfil). Instala pyyaml en ese intérprete, o fija aquí otro que lo tenga"
fi

before=$(stat -c %Y "$RESULT_FILE" 2>/dev/null || echo 0)
OUTPUT=$("$INTERPRETER" "$SCRIPT" 2>&1)
EXIT=$?
after=$(stat -c %Y "$RESULT_FILE" 2>/dev/null || echo 0)

# El script sale 1 también cuando ATENCION es un veredicto normal (hay hallazgos reales
# que informar) -- eso NO es un fallo del vigilante. Lo que de verdad indica que se cayó
# es que RESULT_FILE no se tocó: corrió y no llegó a escribir su resultado (traceback a
# mitad, señal, lo que sea). Por eso la detección de fallo mira el fichero, no el exit code.
if [ "$after" = "$before" ]; then
  fail "el script corrió pero ${RESULT_FILE} no se actualizó -- no llegó a escribir su resultado. Salida cruda:
${OUTPUT}"
fi

echo 0 > "$STATE_FILE"
echo "$OUTPUT"
exit "$EXIT"
