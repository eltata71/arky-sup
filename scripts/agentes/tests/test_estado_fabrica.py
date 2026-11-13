"""Regresión del chequeo cron; fixtures temporales, sin tocar Hermes real.

Ejecutar: /usr/bin/python3 -m unittest discover -s scripts/agentes/tests -p test_estado_fabrica.py -v
"""
import importlib.util
from contextlib import ExitStack, redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    'estado_fabrica', Path(__file__).resolve().parents[1] / 'estado-fabrica.py')
assert SPEC is not None and SPEC.loader is not None
estado = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(estado)


class CronTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.profiles = self.home / 'profiles'
        self.profiles.mkdir()
        override = patch.object(estado, 'PROFILES_DIR', self.profiles)
        override.start()
        self.addCleanup(override.stop)

    def write_jobs(self, data, profile='demo', raw=False):
        root = self.home if profile is None else self.profiles / profile
        path = root / 'cron' / 'jobs.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data if raw else json.dumps(data), encoding='utf-8')
        return path

    def broken(self, **fields):
        return dict(id='job-1', name='roto', enabled=True, failure_streak=3,
                    last_error='SyntaxError', **fields)

    def check_job(self, **overrides):
        job = self.broken()
        job.update(overrides)
        self.write_jobs({'jobs': [job]})
        return estado.cron_job_failure_streaks()

    def test_broken_threshold(self):
        self.assertEqual(self.check_job()[0]['failure_streak'], 3)

    def test_healthy_and_below_threshold(self):
        for streak in [0, 1, 2, None]:
            with self.subTest(streak=streak):
                self.assertEqual(self.check_job(failure_streak=streak), [])

    def test_disabled_and_pause_markers(self):
        for fields in [dict(enabled=False), dict(state='paused'),
                       dict(state=' paused '), dict(paused_at='2026-11-11')]:
            with self.subTest(fields=fields):
                self.assertEqual(self.check_job(**fields), [])

    def test_missing_enabled_defaults_to_true(self):
        job = self.broken()
        del job['enabled']
        self.write_jobs({'jobs': [job]})
        self.assertEqual(len(estado.cron_job_failure_streaks()), 1)

    def test_bare_list_is_supported(self):
        self.write_jobs([self.broken()])
        self.assertEqual(len(estado.cron_job_failure_streaks()), 1)

    def test_self_exclusion_uses_script_not_job_name(self):
        for script in ['estado-fabrica.py', '/opt/watch/estado-fabrica.py']:
            with self.subTest(script=script):
                self.assertEqual(self.check_job(script=script), [])
        self.assertEqual(len(self.check_job(script='/opt/watch/other.py')), 1)

    def test_corrupt_and_unexpected_shapes_are_findings(self):
        for data in ['{', 'null', '42', '{}', '{"jobs": {}}', '{"jobs": [null]}']:
            with self.subTest(data=data):
                self.write_jobs(data, raw=True)
                hits = estado.cron_job_failure_streaks()
                self.assertTrue(hits)
                self.assertEqual(hits[0]['kind'], 'cron_registry_error')
                self.assertEqual(hits[0]['profile'], 'demo')

    def test_read_error_is_finding(self):
        self.write_jobs({'jobs': []})
        with patch.object(Path, 'read_text', side_effect=PermissionError('denied')):
            self.assertEqual(estado.cron_job_failure_streaks()[0]['kind'], 'cron_registry_error')

    def test_invalid_utf8_is_finding(self):
        path = self.write_jobs({'jobs': []})
        path.write_bytes(b'\xff')
        self.assertEqual(estado.cron_job_failure_streaks()[0]['kind'], 'cron_registry_error')

    def test_missing_registry_is_not_error(self):
        self.assertEqual(estado.cron_job_failure_streaks(), [])

    def test_bad_profile_does_not_hide_other_jobs(self):
        self.write_jobs('{', profile='a', raw=True)
        self.write_jobs([self.broken()], profile='b')
        self.assertEqual([hit['profile'] for hit in estado.cron_job_failure_streaks()], ['a', 'b'])

    def test_bad_record_does_not_hide_other_jobs(self):
        self.write_jobs([None, self.broken()])
        hits = estado.cron_job_failure_streaks()
        self.assertEqual(hits[0]['kind'], 'cron_registry_error')
        self.assertEqual(hits[1]['job_id'], 'job-1')

    def test_profile_enumeration_error_is_finding(self):
        with patch.object(Path, 'iterdir', side_effect=PermissionError('denied')):
            hits = estado.cron_job_failure_streaks()
        self.assertEqual(hits[0]['kind'], 'cron_registry_error')

    def test_root_profile_with_no_profiles_directory(self):
        self.profiles.rmdir()
        self.write_jobs([self.broken()], profile=None)
        hits = estado.cron_job_failure_streaks()
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]['profile'], 'root')

    def test_deleted_profiles_ignored(self):
        self.write_jobs([self.broken()], profile='.deleted')
        self.assertEqual(estado.cron_job_failure_streaks(), [])

    def test_string_streak_and_non_string_error(self):
        hit = self.check_job(failure_streak='5', last_error={'message': 'error'})[0]
        self.assertEqual(hit['failure_streak'], 5)
        self.assertIn('error', hit['last_error'])

    def test_invalid_streak_is_finding_not_crash_or_silence(self):
        for value in ['unknown', [], {}, 3.5, True]:
            with self.subTest(value=value):
                hits = self.check_job(failure_streak=value)
                self.assertEqual(hits[0]['kind'], 'cron_registry_error')

    def test_first_nonempty_error_line(self):
        self.assertEqual(self.check_job(last_error='\n  \nSyntaxError\ntrace')[0]['last_error'], 'SyntaxError')
        self.assertIsNone(self.check_job(last_error='\n  ')[0]['last_error'])

    def test_main_critical_reason_json_and_exit_code(self):
        self.write_jobs('{', raw=True)
        self.run_main(1, 'CRON REGISTRO ILEGIBLE')
        self.write_jobs([self.broken()])
        self.run_main(1, 'CRON ROTO')
        self.write_jobs([])
        self.run_main(0, None)

    def run_main(self, expected_code, reason):
        result_path = self.home / 'result.json'
        with ExitStack() as stack:
            for name, value in {
                'discover_boards': {'demo': self.home / 'unused.db'},
                'discover_gateway_units': [], 'gateways_alive': (True, {}),
                'watched_boards': set(), 'unwatched_boards_with_work': [],
                'blocked_tasks': [], 'motor_blocks_recent': [],
                'broken_canonical_skill_links': [], 'policy_drift_findings': [],
                'auto_decompose_true_everywhere': [],
                'dispatcher_lock_status': {'critical': False},
                'dirty_foreign_worktrees': {'items': [], 'check_failed': None},
            }.items():
                stack.enter_context(patch.object(estado, name, return_value=value))
            stack.enter_context(patch.object(estado, 'RESULT_FILE', result_path))
            stack.enter_context(patch('sys.argv', ['estado-fabrica.py', '--json']))
            # Toda E/S externa debe quedar explícitamente sustituida.
            stack.enter_context(patch.object(estado.subprocess, 'run', side_effect=AssertionError('subproceso real en fixture aislada')))
            output = stack.enter_context(redirect_stdout(io.StringIO()))
            self.assertEqual(estado.main(), expected_code)
        result = json.loads(output.getvalue())
        self.assertEqual(json.loads(result_path.read_text()), result)
        self.assertEqual(result['verdict'], 'ATENCION' if expected_code else 'OK')
        if reason:
            self.assertIn(reason, result['reasons'][0])
        self.assertIn('jobs del crontab del sistema', result['not_covered'])
        self.assertIn('job activo que deja de dispararse sin que el streak lo delate', result['not_covered'])


if __name__ == '__main__':
    unittest.main()
