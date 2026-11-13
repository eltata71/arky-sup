"""Regresión del vigilante: SQLite aislado, nunca tablero ni procesos reales."""
import importlib.util
from contextlib import closing, contextmanager, redirect_stderr, redirect_stdout
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('vigilante', Path(__file__).resolve().parents[1] / 'vigilar-limites.py')
assert SPEC is not None and SPEC.loader is not None
vigilante = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vigilante)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            CREATE TABLE tasks (id TEXT PRIMARY KEY, assignee TEXT, title TEXT,
                status TEXT, max_runtime_seconds INTEGER, worker_started_at TEXT,
                started_at, current_run_id INTEGER);
            CREATE TABLE task_runs (id INTEGER PRIMARY KEY, started_at);
            CREATE TABLE task_events (task_id TEXT, kind TEXT, payload TEXT);
            INSERT INTO tasks VALUES ('t_test', 'autor', 'Prueba', 'running',
                NULL, 'boot-identity|process-start', 100, 1);
            INSERT INTO task_runs VALUES (1, 200);
        ''')

    def check(self, now=1000, dry_run=True):
        with patch.object(vigilante.time, 'time', return_value=now):
            return vigilante.check_runtime(self.db, 'perfil', 'tablero', 600, dry_run)

    def test_fingerprint_is_not_a_clock(self):
        hits = self.check()
        self.assertEqual(hits[0]['elapsed_seconds'], 800)
        self.assertEqual(hits[0]['id'], 't_test')


    def test_invalid_clock_is_reported_before_any_command(self):
        for value in [None, 'unreadable', 'nan', 'inf', -1, 2000]:
            with self.subTest(value=value):
                self.db.execute('UPDATE task_runs SET started_at=?', (value,))
                self.db.execute('UPDATE tasks SET started_at=?', (value,))
                with patch.object(vigilante.subprocess, 'run') as run:
                    with self.assertRaisesRegex(ValueError, 't_test'):
                        self.check(dry_run=False)
                    run.assert_not_called()

    def test_invalid_clock_does_not_starve_other_overdue_tasks(self):
        for invalid in [None, 'unreadable', 'nan', 'inf', -1, 2000]:
            with self.subTest(invalid=invalid):
                self.db.execute('UPDATE task_runs SET started_at=?', (invalid,))
                self.db.execute('UPDATE tasks SET started_at=? WHERE id=?', (invalid, 't_test'))
                self.db.execute("INSERT OR REPLACE INTO tasks VALUES ('t_valid', 'autor', 'Vencida', 'running', NULL, 'identity|start', 200, NULL)")
                before = list(self.db.iterdump())
                with patch.object(vigilante.subprocess, 'run') as run:
                    with self.assertRaises(ValueError) as error:
                        self.check(dry_run=False)
                    self.assertIn('t_test', str(error.exception))
                    self.assertIn('t_valid', str(error.exception))
                    self.assertIn('recuperación manual', str(error.exception))
                    run.assert_not_called()
                self.assertEqual(list(self.db.iterdump()), before)

    def test_retry_uses_current_attempt_not_first_start(self):
        self.db.execute('UPDATE task_runs SET started_at=900')
        self.assertEqual(self.check(), [])

    def test_fallback_to_task_clock_for_legacy_run(self):
        self.db.execute('UPDATE tasks SET current_run_id=NULL')
        self.assertEqual(self.check()[0]['elapsed_seconds'], 900)

    def test_dry_run_never_calls_cli_or_changes_database(self):
        before = list(self.db.iterdump())
        with patch.object(vigilante.subprocess, 'run') as run:
            self.assertEqual(len(self.check()), 1)
            run.assert_not_called()
        self.assertEqual(list(self.db.iterdump()), before)


    def test_overdue_mutating_mode_cannot_reach_redispatch_or_block(self):
        for prior in [0, 1, 2]:
            with self.subTest(prior=prior):
                self.db.execute('DELETE FROM task_events')
                self.db.executemany("INSERT INTO task_events VALUES ('t_test', 'reclaimed', 'vigilar-limites: anterior')", [()] * prior)
                before = list(self.db.iterdump())
                redispatched = []

                def unsafe_cli(command, **kwargs):
                    # Intercalado del revisor: reclaim habilitaría un nuevo worker.
                    # No se lanza ningún proceso: ese punto debe ser inalcanzable.
                    if command[6] == 'reclaim':
                        redispatched.append('nuevo-worker')
                    return subprocess.CompletedProcess(command, 0)

                with patch.object(vigilante.subprocess, 'run', side_effect=unsafe_cli) as run:
                    with self.assertRaisesRegex(RuntimeError, 't_test.*recuperación manual.*dispatcher detenido.*verificado'):
                        self.check(dry_run=False)
                    run.assert_not_called()
                self.assertEqual(redispatched, [])
                self.assertEqual(list(self.db.iterdump()), before)
                hits = self.check()
                self.assertFalse(hits[0]['escalated'])
                self.assertFalse(hits[0]['applied'])

    def test_multiple_overdue_tasks_are_all_reported_without_mutation(self):
        self.db.execute("INSERT INTO tasks VALUES ('t_second', 'revisor', 'Otra vencida', 'running', NULL, 'identity', 300, NULL)")
        before = list(self.db.iterdump())
        with patch.object(vigilante.subprocess, 'run') as run:
            hits = self.check()
            self.assertEqual({hit['id']: hit['elapsed_seconds'] for hit in hits}, {'t_test': 800, 't_second': 700})
            with self.assertRaises(RuntimeError) as error:
                self.check(dry_run=False)
            self.assertIn('t_test (800s)', str(error.exception))
            self.assertIn('t_second (700s)', str(error.exception))
            run.assert_not_called()
        self.assertEqual(list(self.db.iterdump()), before)

    def test_invalid_clock_after_overdue_preserves_both_diagnostics(self):
        self.db.execute("INSERT INTO tasks VALUES ('t_bad', 'autor', 'Reloj inválido', 'running', NULL, 'identity', 'nan', NULL)")
        before = list(self.db.iterdump())
        for dry_run in [False, True]:
            with self.subTest(dry_run=dry_run), patch.object(vigilante.subprocess, 'run') as run:
                with self.assertRaises(ValueError) as error:
                    self.check(dry_run=dry_run)
                self.assertIn('t_bad', str(error.exception))
                self.assertIn('t_test (800s)', str(error.exception))
                run.assert_not_called()
        self.assertEqual(list(self.db.iterdump()), before)

    def test_review_origin_is_detected_without_reclaim_or_block(self):
        self.db.execute('ALTER TABLE task_runs ADD COLUMN phase TEXT')
        self.db.execute("UPDATE task_runs SET phase='review'")
        before = list(self.db.iterdump())
        with patch.object(vigilante.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 't_test.*recuperación manual'):
                self.check(dry_run=False)
            hits = self.check()
            self.assertFalse(hits[0]['escalated'])
            self.assertFalse(hits[0]['applied'])
            run.assert_not_called()
        self.assertEqual(list(self.db.iterdump()), before)


    def test_boundary_detects_at_ceiling_not_before(self):
        self.assertEqual(self.check(now=799), [])
        self.assertEqual(self.check(now=800)[0]['elapsed_seconds'], 600)

    def test_terminal_and_bounded_tasks_are_not_selected(self):
        with patch.object(vigilante.subprocess, 'run') as run:
            for status in ['done', 'blocked', 'review', 'todo', 'ready', 'triage']:
                self.db.execute('UPDATE tasks SET status=?', (status,))
                self.assertEqual(self.check(dry_run=False), [])
            self.db.execute("UPDATE tasks SET status='running', max_runtime_seconds=300")
            self.assertEqual(self.check(dry_run=False), [])
            run.assert_not_called()

    def test_proactive_dry_run_is_read_only(self):
        before = list(self.db.iterdump())
        with patch.object(vigilante.subprocess, 'run') as run:
            hits = vigilante.patch_missing_runtime_ceiling(self.db, 'perfil', 'tablero', 600, True)
            self.assertEqual([hit['id'] for hit in hits], ['t_test'])
            run.assert_not_called()
        self.assertEqual(list(self.db.iterdump()), before)

    def test_proactive_write_is_idempotent_and_audited(self):
        with patch.object(vigilante.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            vigilante.patch_missing_runtime_ceiling(self.db, 'perfil', 'tablero', 600, False)
            self.assertEqual(self.db.execute('SELECT max_runtime_seconds FROM tasks').fetchone()[0], 600)
            self.assertEqual(vigilante.patch_missing_runtime_ceiling(self.db, 'perfil', 'tablero', 600, False), [])
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][6], 'comment')
            self.assertEqual(run.call_args.kwargs['timeout'], 30)

    def test_proactive_comment_failure_is_visible_after_update(self):
        with patch.object(vigilante.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                vigilante.patch_missing_runtime_ceiling(self.db, 'perfil', 'tablero', 600, False)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][6], 'comment')
        self.assertEqual(self.db.execute('SELECT max_runtime_seconds FROM tasks').fetchone()[0], 600)

    def reconcile(self, dry_run=False, piso=1200):
        with patch.object(vigilante, '_profile_run_budget_seconds', return_value=piso):
            with patch.object(vigilante.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
                return vigilante.patch_mismatched_runtime_ceiling(self.db, 'perfil', 'tablero', dry_run), run

    def test_reconcile_only_detects_card_below_profile_budget(self):
        self.db.execute("UPDATE tasks SET max_runtime_seconds=300, status='ready'")
        hits, run = self.reconcile(piso=1200)
        self.assertEqual([h['id'] for h in hits], ['t_test'])
        self.assertEqual(hits[0]['old'], 300)
        self.assertEqual(hits[0]['new'], 1200)
        self.assertEqual(self.db.execute('SELECT max_runtime_seconds FROM tasks').fetchone()[0], 300)
        self.assertFalse(hits[0]['applied'])
        run.assert_not_called()

    def test_reconcile_never_lowers_a_card_above_the_floor(self):
        # Excepción puntual concedida (como Andrés a 7200s): pedir más que el
        # perfil no es el defecto, y este vigilante no la toca.
        self.db.execute("UPDATE tasks SET max_runtime_seconds=7200, status='ready'")
        with patch.object(vigilante.subprocess, 'run') as run:
            hits, _ = self.reconcile(piso=300)
            self.assertEqual(hits, [])
            run.assert_not_called()
        self.assertEqual(self.db.execute('SELECT max_runtime_seconds FROM tasks').fetchone()[0], 7200)

    def test_reconcile_skips_card_already_at_the_floor(self):
        self.db.execute("UPDATE tasks SET max_runtime_seconds=1200, status='ready'")
        with patch.object(vigilante.subprocess, 'run') as run:
            hits, _ = self.reconcile(piso=1200)
            self.assertEqual(hits, [])
            run.assert_not_called()

    def test_reconcile_skips_when_profile_has_no_known_floor(self):
        self.db.execute("UPDATE tasks SET max_runtime_seconds=300, status='ready'")
        with patch.object(vigilante, '_profile_run_budget_seconds', return_value=None):
            with patch.object(vigilante.subprocess, 'run') as run:
                hits = vigilante.patch_mismatched_runtime_ceiling(self.db, 'perfil', 'tablero', False)
                self.assertEqual(hits, [])
                run.assert_not_called()
        self.assertEqual(self.db.execute('SELECT max_runtime_seconds FROM tasks').fetchone()[0], 300)

    def test_reconcile_dry_run_never_writes(self):
        self.db.execute("UPDATE tasks SET max_runtime_seconds=300, status='ready'")
        before = list(self.db.iterdump())
        hits, run = self.reconcile(dry_run=True, piso=1200)
        self.assertEqual([h['id'] for h in hits], ['t_test'])
        run.assert_not_called()
        self.assertEqual(list(self.db.iterdump()), before)

    def test_reconcile_never_attempts_update_even_with_trigger(self):
        self.db.execute("UPDATE tasks SET max_runtime_seconds=300, status='ready'")
        self.db.executescript('''
            CREATE TRIGGER concurrent_reconcile BEFORE UPDATE OF max_runtime_seconds ON tasks
            WHEN OLD.max_runtime_seconds=300 BEGIN
                UPDATE tasks SET max_runtime_seconds=900 WHERE id=OLD.id;
                SELECT RAISE(IGNORE);
            END;
        ''')
        with patch.object(vigilante, '_profile_run_budget_seconds', return_value=1200):
            with patch.object(vigilante.subprocess, 'run') as run:
                hits = vigilante.patch_mismatched_runtime_ceiling(self.db, 'perfil', 'tablero', False)
                self.assertEqual([hit['id'] for hit in hits], ['t_test'])
                run.assert_not_called()
        self.assertEqual(self.db.execute('SELECT max_runtime_seconds FROM tasks').fetchone()[0], 300)

    @unittest.skipUnless(importlib.util.find_spec('yaml'), 'PyYAML no instalado en este intérprete')
    def test_profile_run_budget_seconds_reads_real_yaml(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            profiles_dir = Path(tmp)
            (profiles_dir / 'camilo').mkdir()
            (profiles_dir / 'camilo' / 'config.yaml').write_text('agent:\n  run_budget_seconds: 900\n')
            (profiles_dir / 'sin-agent').mkdir()
            (profiles_dir / 'sin-agent' / 'config.yaml').write_text('model:\n  default: x\n')
            with patch.object(vigilante, 'PROFILES_DIR', profiles_dir):
                self.assertEqual(vigilante._profile_run_budget_seconds('camilo'), 900)
                for literal, expected in [('1200.0', 1200.0), ('"1200"', 1200.0),
                                          ('true', None), ('false', None), ('0', None)]:
                    (profiles_dir / 'camilo' / 'config.yaml').write_text(
                        f'agent:\n  run_budget_seconds: {literal}\n')
                    self.assertEqual(vigilante._profile_run_budget_seconds('camilo'), expected)
                (profiles_dir / 'camilo' / 'config.yaml').write_text('agent: [')
                with self.assertRaisesRegex(vigilante.ProfileBudgetError, 'YAML'):
                    vigilante._profile_run_budget_seconds('camilo')
                self.assertIsNone(vigilante._profile_run_budget_seconds('sin-agent'))
                self.assertIsNone(vigilante._profile_run_budget_seconds('no-existe'))

    def test_normalize_budget_matches_hermes_numeric_forms(self):
        for value, expected in [(1200, 1200.0), (1200.0, 1200.0), ('1200', 1200.0),
                                ('1.5', 1.5), (True, None), (False, None),
                                (None, None), ('bad', None), (-1, None), (0, None),
                                ('nan', None)]:
            with self.subTest(value=value):
                self.assertEqual(vigilante._normalize_run_budget_seconds(value), expected)

    def test_main_without_yaml_preserves_detection_and_heartbeat(self):
        self.db.execute("INSERT INTO tasks VALUES ('t_bounded', 'autor', 'Acotada', 'ready', 300, NULL, NULL, NULL)")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'autor').mkdir()
            (root / 'autor' / 'config.yaml').write_text('agent:\n  run_budget_seconds: 1200\n')
            with patch.dict(sys.modules, {'yaml': None}), patch.object(vigilante, 'PROFILES_DIR', root):
                # También debe poder cargarse el módulo sin la dependencia.
                assert SPEC is not None and SPEC.loader is not None
                module = importlib.util.module_from_spec(SPEC)
                SPEC.loader.exec_module(module)
                for options in [('--dry-run', '--cron'), ('--cron',)]:
                    self.db.execute("UPDATE tasks SET status=? WHERE id='t_test'",
                                    ('running' if '--dry-run' in options else 'ready',))
                    with self.subTest(options=options), self.main_fixture(*options) as (db, heartbeat, out, err, run), \
                            patch.object(vigilante, 'PROFILES_DIR', root):
                        self.assertEqual(vigilante.main(), 1)
                        self.assertIn('RELOJ_FALTANTE: t_test', out.getvalue())
                        if '--dry-run' in options:
                            self.assertIn('ALERTA_RUNTIME: t_test', out.getvalue())
                        self.assertIn('PyYAML no disponible', err.getvalue())
                        self.assertIn('PyYAML no disponible', json.loads(heartbeat.read_text())['error'])
                        with closing(sqlite3.connect(db)) as copy:
                            values = dict(copy.execute('SELECT id, max_runtime_seconds FROM tasks'))
                        self.assertEqual(values['t_bounded'], 300)
                        self.assertEqual(values['t_test'], None if '--dry-run' in options else 600)
                        self.assertEqual(run.call_count, 0 if '--dry-run' in options else 1)

    def test_main_profile_error_without_hits_is_not_silent_success(self):
        self.db.execute("UPDATE tasks SET max_runtime_seconds=300, status='ready'")
        with self.main_fixture('--cron', '--dry-run') as (_, heartbeat, out, err, run), \
                patch.object(vigilante, '_profile_run_budget_seconds',
                             side_effect=vigilante.ProfileBudgetError('autor: prueba de error')):
            self.assertEqual(vigilante.main(), 1)
            self.assertIn('ERROR_CONCILIACION', err.getvalue())
            self.assertEqual(json.loads(heartbeat.read_text())['runtime_hits'], 0)
            self.assertIn('prueba de error', json.loads(heartbeat.read_text())['error'])
            run.assert_not_called()

    def test_non_utf8_profile_does_not_starve_other_profiles(self):
        self.db.execute("UPDATE tasks SET max_runtime_seconds=300, assignee='bad', status='ready'")
        self.db.execute("INSERT INTO tasks VALUES ('t_good', 'good', 'Sana', 'ready', 300, NULL, NULL, NULL)")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'bad').mkdir()
            (root / 'bad' / 'config.yaml').write_bytes(b'\xff')
            read_budget = vigilante._profile_run_budget_seconds

            def budget(profile):
                return 1200 if profile == 'good' else read_budget(profile)

            errors = []
            with patch.object(vigilante, 'PROFILES_DIR', root), \
                    patch.object(vigilante, '_profile_run_budget_seconds', side_effect=budget), \
                    redirect_stderr(io.StringIO()) as err:
                hits = vigilante.patch_mismatched_runtime_ceiling(self.db, 'p', 'b', False, errors)
            self.assertEqual([hit['id'] for hit in hits], ['t_good'])
            self.assertIn('UnicodeDecodeError', errors[0])
            self.assertIn('ERROR_CONCILIACION', err.getvalue())

    def test_main_null_ceiling_is_written_once_and_matches_dry_run(self):
        self.db.execute("UPDATE tasks SET status='ready'")
        for options in [('--runtime-ceiling-seconds', '300', '--dry-run'),
                        ('--runtime-ceiling-seconds', '300')]:
            with self.subTest(options=options), \
                    patch.object(vigilante, '_profile_run_budget_seconds', return_value=1200), \
                    self.main_fixture(*options) as (db, heartbeat, out, err, run):
                self.assertEqual(vigilante.main(), 1)
                self.assertIn('300s', out.getvalue())
                self.assertNotIn('DOS_VERDADES', out.getvalue())
                self.assertEqual(json.loads(heartbeat.read_text())['runtime_hits'], 1)
                with closing(sqlite3.connect(db)) as copy:
                    value = copy.execute('SELECT max_runtime_seconds FROM tasks').fetchone()[0]
                self.assertEqual(value, None if '--dry-run' in options else 300)
                self.assertEqual(run.call_count, 0 if '--dry-run' in options else 1)


    def install_concurrent_ceiling_trigger(self):
        # Simular otra escritura entre SELECT y UPDATE sin tocar una DB real.
        self.db.executescript('''
            CREATE TRIGGER concurrent_ceiling BEFORE UPDATE OF max_runtime_seconds ON tasks
            WHEN OLD.max_runtime_seconds IS NULL BEGIN
                UPDATE tasks SET max_runtime_seconds=300 WHERE id=OLD.id;
                SELECT RAISE(IGNORE);
            END;
        ''')

    def test_proactive_unapplied_update_is_not_returned_as_applied(self):
        self.install_concurrent_ceiling_trigger()
        with patch.object(vigilante.subprocess, 'run') as run:
            hits = vigilante.patch_missing_runtime_ceiling(self.db, 'perfil', 'tablero', 600, False)
            self.assertEqual(hits, [])
            run.assert_not_called()
        self.assertEqual(self.db.execute('SELECT max_runtime_seconds FROM tasks').fetchone()[0], 300)

    def test_main_unapplied_update_is_not_counted_or_reported(self):
        self.db.execute("UPDATE tasks SET status='ready'")
        self.install_concurrent_ceiling_trigger()
        with self.main_fixture('--cron') as (db_path, heartbeat, stdout, stderr, run):
            self.assertEqual(vigilante.main(), 0)
            self.assertEqual(stdout.getvalue(), '')
            self.assertEqual(stderr.getvalue(), '')
            payload = json.loads(heartbeat.read_text())
            self.assertEqual(payload['runtime_hits'], 0)
            self.assertIsNone(payload['error'])
            run.assert_not_called()

    @contextmanager
    def main_fixture(self, *options):
        # TemporaryDirectory respeta TMPDIR; no artefactos dentro del repositorio.
        with tempfile.TemporaryDirectory(prefix='watchdog-test-') as directory:
            db_path = Path(directory) / 'isolated.db'
            heartbeat = Path(directory) / 'heartbeat.json'
            self.db.commit()
            copy = sqlite3.connect(db_path)
            self.db.backup(copy)
            copy.close()
            stdout, stderr = io.StringIO(), io.StringIO()
            argv = ['vigilar-limites.py', str(db_path), 'tablero', '--profile', 'perfil', *options]
            with (patch.object(vigilante.sys, 'argv', argv),
                  patch.object(vigilante, 'HEARTBEAT', heartbeat),
                  patch.object(vigilante, 'PROFILES_DIR', Path(directory) / 'profiles'),
                  patch.object(vigilante.time, 'time', return_value=1000),
                  patch.object(vigilante.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run,
                  redirect_stdout(stdout), redirect_stderr(stderr)):
                yield db_path, heartbeat, stdout, stderr, run

    def test_main_reports_overdue_before_proactive_patch(self):
        with self.main_fixture('--cron') as (db_path, heartbeat, stdout, stderr, run):
            with self.assertRaisesRegex(RuntimeError, 'recuperación manual'):
                vigilante.main()
            run.assert_not_called()
            with closing(sqlite3.connect(db_path)) as copy:
                self.assertIsNone(copy.execute('SELECT max_runtime_seconds FROM tasks').fetchone()[0])
            self.assertIn('t_test', stderr.getvalue())
            self.assertIn('dispatcher detenido y verificado', json.loads(heartbeat.read_text())['error'])
            self.assertNotIn('se le puso', stdout.getvalue())

    def test_main_closes_database_on_success_and_failure(self):
        connect = sqlite3.connect
        for options in [('--dry-run',), ()]:
            with self.subTest(options=options), self.main_fixture(*options):
                connections = []

                def record_connection(*args, **kwargs):
                    connection = connect(*args, **kwargs)
                    connections.append(connection)
                    self.addCleanup(connection.close)
                    return connection

                with patch.object(vigilante.sqlite3, 'connect', side_effect=record_connection):
                    if options:
                        self.assertEqual(vigilante.main(), 1)
                    else:
                        with self.assertRaises(RuntimeError):
                            vigilante.main()
                self.assertEqual(len(connections), 1)
                with self.assertRaises(sqlite3.ProgrammingError):
                    connections[0].execute('SELECT 1')

    def test_main_dry_run_reports_detection_not_termination(self):
        with self.main_fixture('--dry-run') as (db_path, heartbeat, stdout, stderr, run):
            self.assertEqual(vigilante.main(), 1)
            run.assert_not_called()
            self.assertIn('detectada', stdout.getvalue())
            self.assertNotIn('detenid', stdout.getvalue())
            self.assertIsNone(json.loads(heartbeat.read_text())['error'])
            with closing(sqlite3.connect(db_path)) as copy:
                self.assertIsNone(copy.execute('SELECT max_runtime_seconds FROM tasks').fetchone()[0])


if __name__ == '__main__':
    unittest.main()
