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


# Assertions that require Supabase-managed behavior and are verified
# remotely instead. Fails closed: the run passes only when the failed set is
# EXACTLY this pinned set (descriptions, not numbers); any deviation — a new
# failure, a missing one, or the gap healing without a doc update — is an
# error.
PLATFORM_GAPS = {
    # The managed Storage layer rejects direct deletes with its own trigger
    # message; vanilla PostgreSQL denies at grant level instead. errcode
    # (42501) matches on both; the message is proven by test-remote.py.
    "storage_private_objects.test.sql": [
        "El cliente no elimina un objeto no registrado",
    ],
}


def tap_failures(output):
    """Descriptions of failed TAP assertions in a complete plan run."""
    failed = re.findall(r"^not ok \d+ - (.*?)(?:\n|$)", output, re.MULTILINE)
    plans = re.findall(r"^1\.\.(\d+)$", output, re.MULTILINE)
    total = re.findall(r"^(?:not ok|ok) \d+(?:\s|$)", output, re.MULTILINE)
    complete = len(plans) == 1 and bool(total) and int(plans[0]) == len(total)
    return failed, complete


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
                # Harness-only: reproduce the documented Supabase-managed
                # Storage reachability that survives REVOKE (see
                # docs/fase-6/cierre-fase-6.md: anon keeps SELECT via
                # platform-owned grants). RLS + policies still decide every
                # row; the contract itself proves it. Never deploy this.
                run(psql + ["-c", "grant select on storage.objects to anon"])
                # Idempotent seed replay must neither duplicate probes nor audit.
                for _ in (1, 2):
                    run(psql + ["-f", ROOT / "supabase/seed.sql"])
                counts = run(psql + ["-c", "select (select count(*) from api.platform_probes), (select count(*) from private.audit_events)"]).strip()
                if counts != "2|2":
                    raise RuntimeError(f"Seed replay changed expected state: {counts}")
                for test in tests:
                    output = run(psql + ["-f", test])
                    try:
                        count = check_tap(output)
                    except RuntimeError:
                        failed, complete = tap_failures(output)
                        expected = PLATFORM_GAPS.get(test.name, [])
                        if complete and sorted(failed) == sorted(expected) and expected:
                            count = len(re.findall(r"^(?:not ok|ok) \d+(?:\s|$)", output, re.MULTILINE))
                            print(f"Fresh reconstruction {iteration}: {test.name}: {count}/{count} PASS WITH DOCUMENTED PLATFORM GAP {failed}; seed replay 2 probes / 2 audit events", flush=True)
                            continue
                        raise
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
