#!/usr/bin/env python3
"""Real PostgreSQL SQL-contract fallback; NOT a Supabase services/E2E substitute.

Requires initdb, pg_ctl, psql and the pgTAP/plpgsql_check extensions installed
for the same PostgreSQL major. PG_BINDIR can select a relocatable installation;
LD_LIBRARY_PATH can select its shared libraries. No downloads or sudo here.
Creates two fresh Unix-socket-only clusters, then stops/removes them even on failure.
Run: PG_BINDIR=/path/to/postgresql/bin python3 scripts/supabase/test-native.py
"""
from pathlib import Path
import os
import re
import shlex
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BIN = Path(os.environ.get("PG_BINDIR", str(Path(shutil.which("psql") or "/missing/psql").parent)))


def run(args, **kwargs):
    result = subprocess.run([str(arg) for arg in args], text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f"Command failed: {args[0]}\n{result.stdout}\n{result.stderr}")
    return result.stdout


def check_tap(output):
    assertions = re.findall(r"^(not ok|ok) (\d+)(?:\s|$)", output, re.MULTILINE)
    plans = re.findall(r"^1\.\.(\d+)$", output, re.MULTILINE)
    if (len(plans) != 1 or not assertions or int(plans[0]) != len(assertions)
            or any(state != "ok" or int(number) != index
                   for index, (state, number) in enumerate(assertions, 1))
            or re.search(r"^Bail out!", output, re.MULTILINE)):
        raise RuntimeError(f"pgTAP did not pass its complete plan:\n{output}")
    return len(assertions)


def main():
    for tool in ("initdb", "pg_ctl", "psql"):
        if not (BIN / tool).is_file():
            raise RuntimeError(f"Missing {BIN / tool}; install PostgreSQL + pgTAP + plpgsql_check or set PG_BINDIR")
    print(run([BIN / "psql", "--version"]).strip(), flush=True)
    migrations = sorted((ROOT / "supabase/migrations").glob("*.sql"))
    tests = sorted((ROOT / "supabase/tests/database").glob("*.sql"))
    if not migrations or not tests:
        raise RuntimeError("Missing migrations or SQL tests")
    # The mutation check is specific to the foundation probe policy; do not rely
    # on `tests[0]`, which changes as test files are added.
    foundation = [test for test in tests if test.name == "platform_foundation.test.sql"]
    if not foundation:
        raise RuntimeError("Missing platform_foundation.test.sql for the mutation check")
    for iteration in (1, 2):
        with tempfile.TemporaryDirectory(prefix="arky-sql-") as folder:
            directory = Path(folder)
            data = directory / "data"
            run([BIN / "initdb", "-D", data, "-U", "postgres", "-A", "trust", "--no-locale", "-E", "UTF8"])
            options = shlex.join(["-h", "", "-k", folder, "-p", "55439"])
            started = False
            try:
                run([BIN / "pg_ctl", "-D", data, "-l", directory / "server.log", "-o", options, "-w", "start"])
                started = True
                psql = [BIN / "psql", "-XAtq", "-h", folder, "-p", "55439", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
                run(psql + ["-f", ROOT / "scripts/supabase/sql-contract-bootstrap.sql"])
                for migration in migrations:
                    run(psql + ["-f", migration])
                # Idempotent seed replay must neither duplicate probes nor audit.
                for _ in (1, 2):
                    run(psql + ["-f", ROOT / "supabase/seed.sql"])
                counts = run(psql + ["-c", "select (select count(*) from api.platform_probes), (select count(*) from private.audit_events)"]).strip()
                if counts != "2|2":
                    raise RuntimeError(f"Seed replay changed expected state: {counts}")
                for test in tests:
                    output = run(psql + ["-f", test])
                    count = check_tap(output)
                    print(f"Fresh reconstruction {iteration}: {test.name}: {count}/{count} PASS; seed replay 2 probes / 2 audit events", flush=True)
                run(psql + ["-c", "create extension plpgsql_check with schema extensions"])
                lint = run(psql + ["-c", "select * from extensions.plpgsql_check_function_tb('private.audit_platform_probe()', 'api.platform_probes')"]).strip()
                if lint:
                    raise RuntimeError(f"plpgsql_check findings: {lint}")
                print(f"Fresh reconstruction {iteration}: plpgsql_check: no findings", flush=True)
                # Prove the tests reject a weakened RLS policy (not a false green).
                run(psql + ["-c", "alter policy probe_select_owner on api.platform_probes using (true)"])
                mutant = run(psql + ["-f", foundation[0]])
                try:
                    check_tap(mutant)
                except RuntimeError:
                    print(f"Fresh reconstruction {iteration}: deliberately weakened SELECT policy detected", flush=True)
                else:
                    raise RuntimeError("Tests accepted a cross-owner SELECT vulnerability")
            finally:
                if started:
                    run([BIN / "pg_ctl", "-D", data, "-m", "fast", "-w", "stop"])
    print("SQL contracts verified. Supabase Auth/REST/Storage, PG17 parity and CLI type generation still require the Docker CI stack.")


if __name__ == "__main__":
    main()
