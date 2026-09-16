#!/usr/bin/env python3
"""Fail-closed pgTAP verdicts; stdout/evidence never contain database row values.

Wraps each contract file so the Supabase CLI (which may only expose the final
result set) returns EVERY TAP line in one final SELECT. Verdicts come from
parsing the complete TAP plan, never from the CLI exit status.
Run: python3 scripts/supabase/test-remote.py [contract.sql ...]
Offline unit tests: python3 -m unittest discover -s scripts/supabase -p 'test_remote_runner.py'
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path


def check_tap(values):
    """Validate a complete, strictly numbered TAP stream, not the CLI exit status."""
    lines = [line.strip() for value in values for line in value.splitlines() if line.strip()]
    assertions = []
    plans = []
    reasons = []
    for line in lines:
        assertion = re.fullmatch(r'(not ok|ok) (\d+)(?:\s.*)?', line)
        plan = re.fullmatch(r'1\.\.(\d+)', line)
        if assertion:
            assertions.append({'number': int(assertion[2]), 'passed': assertion[1] == 'ok'})
            if re.search(r'#\s*(?:TODO|SKIP)\b', line, re.I):
                reasons.append('unexpected-directive')
        elif plan:
            plans.append(int(plan[1]))
        elif not line.startswith('#'):
            reasons.append('unrecognized-tap-or-bailout')
    if len(plans) != 1 or not assertions or plans[0] != len(assertions):
        reasons.append('missing-or-incomplete-plan')
    if [item['number'] for item in assertions] != list(range(1, len(assertions) + 1)):
        reasons.append('nonsequential-assertions')
    failed = [item['number'] for item in assertions if not item['passed']]
    if failed:
        reasons.append('failed-assertions')
    return {'passed': not reasons, 'assertions': len(assertions), 'plan': plans,
            'failed_assertions': failed, 'assertion_results': assertions,
            'reasons': sorted(set(reasons))}


def contract_statements(sql):
    """Split a contract file into executable statements.

    Respects single/double quotes, dollar-quoting and line/block comments so a
    semicolon inside a literal never splits. Drops standalone transaction
    controls (begin/commit/rollback) — the wrapper owns the transaction.
    """
    statements = []
    buf: list[str] = []
    i, n = 0, len(sql)
    single = double = False
    dollar_tag: str | None = None
    line_comment = block_comment = False
    while i < n:
        if line_comment:
            buf.append(sql[i])
            if sql[i] == '\n':
                line_comment = False
            i += 1
            continue
        if block_comment:
            if sql.startswith('*/', i):
                block_comment = False
                buf.append('*/')
                i += 2
            else:
                buf.append(sql[i])
                i += 1
            continue
        if dollar_tag is not None:
            if sql.startswith(dollar_tag, i):
                buf.append(dollar_tag)
                i += len(dollar_tag)
                dollar_tag = None
            else:
                buf.append(sql[i])
                i += 1
            continue
        if single:
            buf.append(sql[i])
            if sql[i] == "'":
                if sql.startswith("''", i):
                    buf.append("'")
                    i += 2
                else:
                    single = False
                    i += 1
            else:
                i += 1
            continue
        if double:
            buf.append(sql[i])
            if sql[i] == '"':
                double = False
            i += 1
            continue
        if sql.startswith('--', i):
            # '--' inside an operator (e.g. 'a--b' already handled in quotes);
            # outside quotes it starts a line comment.
            line_comment = True
            buf.append('--')
            i += 2
            continue
        if sql.startswith('/*', i):
            block_comment = True
            buf.append('/*')
            i += 2
            continue
        if sql[i] == "'":
            single = True
            buf.append(sql[i])
            i += 1
            continue
        if sql[i] == '"':
            double = True
            buf.append(sql[i])
            i += 1
            continue
        dollar = re.match(r'\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$', sql[i:])
        if dollar:
            dollar_tag = dollar.group(0)
            buf.append(dollar_tag)
            i += len(dollar_tag)
            continue
        if sql[i] == ';':
            chunk = ''.join(buf).strip()
            # Detect transaction controls on a comment-stripped copy, but keep
            # the original chunk: '--' inside a string literal is data.
            code = re.sub(r'--[^\n]*', '', chunk).strip()
            if code and code.lower() not in ('begin', 'start transaction', 'commit', 'rollback'):
                statements.append(chunk)
            buf = []
            i += 1
            continue
        buf.append(sql[i])
        i += 1
    tail = ''.join(buf).strip()
    tail_code = re.sub(r'--[^\n]*', '', tail).strip()
    if tail_code and tail_code.lower() not in ('begin', 'start transaction', 'commit', 'rollback'):
        statements.append(tail)
    # Drop pure-comment remnants (detection only; originals are preserved).
    cleaned = [s for s in statements if re.sub(r'--[^\n]*', '', s).strip(' \n;')]
    return cleaned


def _is_select_statement(statement):
    # Prefix scan with comment awareness: '--' can hide inside a block
    # comment (and '/*' inside a line comment), so strip whichever comment
    # opens first instead of regexing one kind globally.
    i, n = 0, len(statement)
    while i < n:
        if statement[i].isspace():
            i += 1
            continue
        if statement.startswith('--', i):
            end = statement.find('\n', i)
            i = n if end < 0 else end + 1
            continue
        if statement.startswith('/*', i):
            end = statement.find('*/', i + 2)
            i = n if end < 0 else end + 2
            continue
        break
    return statement[i:].lower().startswith(('select', 'with', 'values', 'table'))


def wrap_sql(statements, nonce):
    """Wrap statements so every TAP line returns in one final result set.

    SELECTs are captured row-by-row into a temp table (preserving order);
    utility statements (CREATE EXTENSION, SET, GRANT, INSERT, ...) run
    directly because they return no rows and cannot be opened as a cursor.
    """
    tag = re.sub(r'[^A-Za-z_0-9]', '', nonce or 'tap') or 'tap'
    parts = [
        'begin;',
        "set local lock_timeout = '3s';",
        'create temp table tap_lines(line text) on commit drop;',
        # Contracts switch roles mid-file (anon/authenticated/service_role); the
        # temp table is owned by the login role, so grant capture rights
        # before any switch. Public is safe: pg_temp, session-local, rolled back.
        'grant all on tap_lines to public;',
    ]
    for statement in statements:
        if _is_select_statement(statement):
            literal = "'" + statement.replace("'", "''") + "'"
            parts.append(
                f'DO ${tag}$DECLARE statement text := {literal}; result_row record; BEGIN\n'
                'for result_row in execute statement loop\n'
                'INSERT INTO tap_lines(line) SELECT value FROM jsonb_each_text(jsonb_build_array(to_jsonb(result_row))->0) LIMIT 1;\n'
                'end loop;\n'
                f'END${tag}$;'
            )
        else:
            parts.append(statement.rstrip('; ') + ';')
    parts.append('SELECT line FROM tap_lines;')
    parts.append('rollback;')
    return '\n'.join(parts)


def run_contract(path):
    sql = Path(path).read_text()
    statements = contract_statements(sql)
    if not statements:
        return {'passed': False, 'assertions': 0, 'failed_assertions': [],
                'reasons': ['missing-or-incomplete-plan']}
    wrapped = wrap_sql(statements, Path(path).stem)
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as handle:
        handle.write(wrapped)
        tmp = handle.name
    try:
        proc = subprocess.run(
            ['supabase', 'db', 'query', '--linked', '--file', tmp],
            text=True, capture_output=True, timeout=300,
        )
    finally:
        Path(tmp).unlink(missing_ok=True)
    if proc.returncode != 0:
        return {'passed': False, 'assertions': 0, 'failed_assertions': [],
                'reasons': ['unrecognized-tap-or-bailout']}
    try:
        payload = json.loads(proc.stdout or '{}')
    except json.JSONDecodeError:
        return {'passed': False, 'assertions': 0, 'failed_assertions': [],
                'reasons': ['unrecognized-tap-or-bailout']}
    rows = payload.get('rows', []) if isinstance(payload, dict) else []
    values = []
    for row in rows:
        if isinstance(row, dict):
            for value in row.values():
                if isinstance(value, str):
                    values.append(value)
                elif value is not None:
                    values.append(json.dumps(value))
        elif isinstance(row, str):
            values.append(row)
    # The wrapper emits one TAP line per row; join and validate the plan.
    return check_tap(values)


def main(argv=None):
    root = Path(__file__).resolve().parents[2]
    targets = sorted((root / 'supabase/tests/database').glob('*.sql'))
    if argv:
        targets = [Path(a) for a in argv]
    failed = 0
    for target in targets:
        result = run_contract(str(target))
        status = 'PASS' if result['passed'] else 'FAIL'
        # Evidence carries counts and reasons only — never database row values.
        print(f"{target.name}: {status} "
              f"{result['assertions']}/{result['assertions']} "
              f"reasons={','.join(result['reasons']) or 'none'}", flush=True)
        if not result['passed']:
            failed += 1
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
