#!/usr/bin/env python3
"""Instala el disparador en crontab con candado; --print no cambia nada.

Ejecutar tras revisión, desde el checkout que deba permanecer en disco:
/usr/bin/python3 scripts/agentes/install_pr_review_cron.py --install
No copia scripts: el cron ejecuta el fichero versionado indicado por --script.
"""
import argparse
import os
from pathlib import Path
import shlex
import shutil
import subprocess

MARKER = "# arky-pr-review-trigger"


def cron_line(script: Path, home: Path) -> str:
    if not script.is_file():
        raise ValueError("no existe el script del disparador")
    # Cron no hereda el PATH de la sesión interactiva. Resolver ambas CLI
    # sin leer credenciales y conservar sus directorios explícitamente.
    tools = [shutil.which(name) for name in ("gh", "hermes")]
    if not all(tools):
        raise ValueError("gh y hermes deben estar instalados y accesibles")
    path = os.pathsep.join(dict.fromkeys([str(Path(t).parent) for t in tools if t is not None] + ["/usr/bin", "/bin"]))
    logs = home / ".hermes" / "logs"
    command = shlex.join([
        "/usr/bin/flock", "-n", str(logs / "pr-review-trigger.lock"),
        "/usr/bin/env", f"PATH={path}", "/usr/bin/python3", str(script.resolve()),
    ])
    command += " >> " + shlex.quote(str(logs / "pr-review-trigger.log")) + " 2>&1"
    # El parser de cron interpreta % incluso dentro de comillas de shell.
    return "*/5 * * * * " + command.replace("%", "\\%") + " " + MARKER


def read_crontab() -> str:
    result = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=15,
                            env={**os.environ, "LC_ALL": "C"})
    if result.returncode == 0:
        return result.stdout
    if result.returncode == 1 and "no crontab for" in result.stderr:
        return ""
    raise RuntimeError("no se pudo leer crontab; no se modifica")


def install(script: Path, home: Path) -> str:
    line = cron_line(script, home)
    before = read_crontab()
    lines = before.splitlines()
    if any("pr_review_trigger.py" in entry and not entry.endswith(MARKER) for entry in lines):
        raise RuntimeError("entrada del disparador no gestionada; conciliar manualmente antes de instalar")
    after = "\n".join([entry for entry in lines if not entry.endswith(MARKER)] + [line]) + "\n"
    if before != after:
        (home / ".hermes" / "logs").mkdir(parents=True, exist_ok=True)
        subprocess.run(["crontab", "-"], input=after, text=True, capture_output=True, timeout=15, check=True)
    if read_crontab() != after:
        raise RuntimeError("crontab no coincide después de instalar; comprobar concurrencia")
    return line


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--print", action="store_true", help="mostrar sin instalar")
    mode.add_argument("--install", action="store_true", help="instalar y verificar crontab")
    parser.add_argument("--script", type=Path, default=Path(__file__).with_name("pr_review_trigger.py"))
    args = parser.parse_args()
    print(install(args.script, Path.home()) if args.install else cron_line(args.script, Path.home()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
