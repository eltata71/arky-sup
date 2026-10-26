#!/usr/bin/env bash
# Da de alta un proyecto nuevo con despacho automático propio, sin tocar el
# tablero "actual" de nadie más -- el mismo procedimiento que se siguió a
# mano para separar latam-factory de arky-maintenance (2026-10-25).
#
# También ADOPTA un tablero que ya existe (2026-10-25, hueco 3 de la prueba
# del coordinador): Hermes crea un tablero solo, con solo nombrarlo en una
# llamada a kanban_create -- un agente no pasa por este script para eso, así
# que el tablero nace sin gateway y su trabajo corre fuera de cualquier
# despachador, invisible al tope de concurrencia y a todo lo demás. Si el
# tablero ya existe, este script NO falla: se salta el paso 1 y le da perfil
# y gateway igual que a uno nuevo. `estado-fabrica.py` avisa de estos casos
# ("TABLERO SIN GOBERNANZA"); este script es el único comando que hace falta
# para resolverlo, sin levantar nada automáticamente sin que alguien lo vea
# primero -- ver el porqué de esa elección en el hallazgo que la acompaña.
#
# Qué hace, en orden, y por qué cada paso es necesario (no opcional):
#   1. Crea el tablero kanban, atado a la ruta del repo (--default-workdir)
#      -- o, si ya existe (adopción), lo deja tal cual: un tablero es un
#      proyecto en esta fábrica, nuevo o adoptado.
#   2. Crea un perfil de infraestructura dedicado, clonado de arkysupabase
#      (hereda sus hooks de seguridad: bloqueo de escritura contra el motor
#      y registro de uso de modelos -- sin eso, auto_decompose en el tablero
#      nuevo no tendría la misma red que ya protege a los demás).
#      --clone (no --clone-channels) deja atrás cualquier token de
#      mensajería del perfil origen, a propósito: dos perfiles con el mismo
#      token colisionan.
#   3. Fija ese perfil a SU tablero mediante HERMES_KANBAN_BOARD en su propio
#      .env -- NUNCA como Environment= en la unidad systemd, porque
#      `hermes gateway run` reescribe esa unidad a su plantilla por defecto
#      en cada arranque y borraría cualquier variable añadida a mano ahí
#      (comprobado en vivo: así se perdió la primera vez que se probó esto).
#   4. Instala y arranca su propio gateway systemd --user, igual al que ya
#      sostiene arkysupabase -- sobrevive a reinicios porque es un servicio
#      `enable`d, no un proceso en primer plano.
#
# Ya no hace falta nada a mano después (2026-10-25): `vigilar-limites.sh` y
# `estado-fabrica.py` descubren los tableros preguntando a Hermes en cada
# pasada, no leyendo una lista escrita aquí.
#
# Límite conocido, dicho en voz alta: el tope `max_in_progress_per_profile`
# es por tablero, no cruzado. Si el mismo agente tiene tarea asignada en dos
# proyectos a la vez, puede correr en los dos simultáneamente. El tope
# agregado (`max_in_progress`) sí es cruzado entre tableros y sigue
# acotando el gasto total de la máquina.
#
# Lo que esto NO hace, a propósito: no se dispara solo cuando
# `estado-fabrica.py` detecta un tablero huérfano. Levantar infraestructura
# persistente (perfil + unidad systemd que sobrevive a reinicios) sin que
# nadie lo vea primero cambia "un agente creó un tablero de prueba" por "la
# fábrica acumula un gateway permanente por cada experimento" -- el aviso es
# automático, el remedio es un comando, decidir usarlo sigue siendo de una
# persona.
#
# Uso:
#   scripts/agentes/nuevo-proyecto.sh <slug-del-tablero> </ruta/al/repo>
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Uso: $0 <slug-del-tablero> </ruta/al/repo>" >&2
  exit 2
fi

SLUG="$1"
WORKDIR="$2"
PROFILE="$(echo "$SLUG" | tr -cd 'a-z0-9')"
HERMES_AGENT_DIR="/home/tata/.local/share/hermes-agent-v0.22.2"
UNIT="/home/tata/.config/systemd/user/hermes-gateway-${PROFILE}.service"

if [ -z "$PROFILE" ]; then
  echo "El slug '$SLUG' no deja ningún carácter alfanumérico para el nombre del perfil." >&2
  exit 2
fi
if [ ! -d "$WORKDIR" ]; then
  echo "La ruta '$WORKDIR' no existe -- créala o clona el repo antes de continuar." >&2
  exit 2
fi
BOARD_EXISTS=0
if hermes kanban boards list --json 2>/dev/null | grep -q "\"slug\": \"${SLUG}\""; then
  BOARD_EXISTS=1
fi
if [ -d "/home/tata/.hermes/profiles/${PROFILE}" ]; then
  echo "El perfil '$PROFILE' ya existe. Revisa a mano antes de continuar." >&2
  exit 1
fi

if [ "$BOARD_EXISTS" -eq 1 ]; then
  echo "1/4 -- Tablero '$SLUG' ya existe (adopción, no creación) -- se le da perfil y gateway propios"
else
  echo "1/4 -- Creando tablero '$SLUG' sobre $WORKDIR"
  hermes kanban boards create "$SLUG" --default-workdir "$WORKDIR"
fi

echo "2/4 -- Creando perfil de infraestructura '$PROFILE' (clonado de arkysupabase)"
hermes profile create "$PROFILE" --clone-from arkysupabase \
  --description "Identidad de infraestructura: gateway dedicado al tablero kanban ${SLUG}. No forma parte del reparto de agentes."

echo "3/4 -- Fijando el tablero en el .env del perfil (sobrevive al autoajuste del gateway)"
printf '\nHERMES_KANBAN_BOARD=%s\n' "$SLUG" >> "/home/tata/.hermes/profiles/${PROFILE}/.env"

echo "4/4 -- Instalando y arrancando el gateway dedicado"
cat > "$UNIT" <<EOF
[Unit]
Description=Hermes Agent Gateway - Messaging Platform Integration
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart="${HERMES_AGENT_DIR}/.hermes/bin/hermes" "--profile" "${PROFILE}" "gateway" "run"
WorkingDirectory=/home/tata/.hermes/profiles/${PROFILE}
Environment="PATH=${HERMES_AGENT_DIR}/node_modules/.bin:/home/tata/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

Environment="HERMES_HOME=/home/tata/.hermes/profiles/${PROFILE}"
Environment="HERMES_SUPERVISED_CHILD=1"
Restart=always
RestartSec=5
RestartForceExitStatus=75
SuccessExitStatus=75
RestartPreventExitStatus=78
KillMode=mixed
KillSignal=SIGTERM
ExecReload=/bin/kill -USR1 \$MAINPID
ExecStop=-"${HERMES_AGENT_DIR}/.hermes/bin/hermes" "--run-module" "gateway.systemd_stop_mark"
ExecStopPost=-"${HERMES_AGENT_DIR}/.hermes/bin/hermes" "--run-module" "gateway.cgroup_cleanup"
TimeoutStopSec=70
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now "hermes-gateway-${PROFILE}.service"

echo "    Reiniciando y volviendo a comprobar -- no basta con que arranque la"
echo "    primera vez. hermes gateway run reescribe su propia unidad systemd al"
echo "    arrancar y se come cualquier variable añadida a mano ahí; la única"
echo "    forma de saber si HERMES_KANBAN_BOARD sobrevive de verdad es apagar,"
echo "    encender y volver a preguntar -- no fiarse de que quedó puesto."
systemctl --user restart "hermes-gateway-${PROFILE}.service"
sleep 6
if ! systemctl --user is-active --quiet "hermes-gateway-${PROFILE}.service"; then
  echo "FALLO: hermes-gateway-${PROFILE}.service no quedó activo tras el reinicio." >&2
  exit 1
fi
CURRENT_AFTER_RESTART="$(hermes --profile "$PROFILE" kanban boards list 2>&1 | awk '/^●/{print $2}')"
if [ "$CURRENT_AFTER_RESTART" != "$SLUG" ]; then
  echo "FALLO: tras reiniciar, el perfil '$PROFILE' resuelve '$CURRENT_AFTER_RESTART' como tablero actual, no '$SLUG'." >&2
  echo "       Revisa HERMES_KANBAN_BOARD en /home/tata/.hermes/profiles/${PROFILE}/.env -- no asumas que quedó bien." >&2
  exit 1
fi
echo "    Confirmado tras reinicio real: el perfil '$PROFILE' sigue resolviendo '$SLUG' como su tablero."

echo "5/4 -- Reparando enlaces de la skill canónica (hallazgo 2, PR #293): un"
echo "    perfil nuevo clonado puede heredar una copia real en vez de un enlace;"
echo "    esto lo corrige si hace falta. No crea la skill donde no existía."
bash "$(dirname "${BASH_SOURCE[0]}")/enlazar-skill-canonica.sh" --quiet || true

echo ""
echo "Listo. Tablero '$SLUG' con gateway propio (perfil '$PROFILE', unidad hermes-gateway-${PROFILE}.service)."
echo "vigilar-limites.sh y estado-fabrica.py lo descubren solos en su próxima pasada -- nada más que hacer a mano."
