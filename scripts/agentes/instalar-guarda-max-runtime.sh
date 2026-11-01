#!/usr/bin/env bash
# Instala el hook require-max-runtime-on-create.py (hermano de
# block-hermes-engine-writes.py) en cada perfil que ya tenga el hook del
# motor registrado -- mismo criterio de alcance, descubierto en vivo, nunca
# una lista escrita a mano. Idempotente: si un perfil ya lo tiene, lo deja
# igual.
#   bash scripts/agentes/instalar-guarda-max-runtime.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LIVE="/home/tata/.hermes/agent-hooks/require-max-runtime-on-create.py"
REF="${REPO}/scripts/agentes/require-max-runtime-on-create.py.referencia"

cp "$REF" "$LIVE"
chmod +x "$LIVE"
echo "Hook instalado en $LIVE"

python3 - "$LIVE" <<'PY'
import sys
from pathlib import Path

live_hook = sys.argv[1]
PROFILES = Path("/home/tata/.hermes/profiles")

OLD_BLOCK = (
    '  pre_tool_call:\n'
    '    - matcher: "terminal|write_file|patch"\n'
    '      command: "/home/tata/.hermes/agent-hooks/block-hermes-engine-writes.py"\n'
    '      timeout: 5\n'
    '      fail_closed: true\n'
)
NEW_ENTRY = (
    f'    - matcher: "terminal"\n'
    f'      command: "{live_hook}"\n'
    f'      timeout: 5\n'
    f'      fail_closed: true\n'
)

tocados, saltados, sin_bloque = [], [], []

for profile_dir in sorted(PROFILES.iterdir()):
    cfg = profile_dir / "config.yaml"
    if not cfg.is_file():
        continue
    text = cfg.read_text(encoding="utf-8")
    if "block-hermes-engine-writes.py" not in text:
        continue  # no es del alcance: este perfil nunca tuvo el hook del motor
    if live_hook in text:
        saltados.append(profile_dir.name)
        continue
    if OLD_BLOCK not in text:
        sin_bloque.append(profile_dir.name)
        continue
    cfg.write_text(text.replace(OLD_BLOCK, OLD_BLOCK + NEW_ENTRY), encoding="utf-8")

    allow = profile_dir / "shell-hooks-allowlist.json"
    if allow.is_file():
        import json
        data = json.loads(allow.read_text(encoding="utf-8"))
        approvals = data.setdefault("approvals", [])
        if not any(a.get("command") == live_hook for a in approvals):
            approvals.append({"event": "pre_tool_call", "command": live_hook})
            allow.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tocados.append(profile_dir.name)

print(f"Instalado en {len(tocados)} perfiles: {', '.join(tocados) or '(ninguno nuevo)'}")
if saltados:
    print(f"Ya lo tenían ({len(saltados)}): {', '.join(saltados)}")
if sin_bloque:
    print(f"AVISO -- bloque pre_tool_call con forma inesperada, no tocados: {', '.join(sin_bloque)}")
PY
