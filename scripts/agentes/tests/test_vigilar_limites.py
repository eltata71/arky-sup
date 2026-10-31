"""Regresión del vigilante: SQLite aislado, nunca tablero ni procesos reales."""
import importlib.util
from pathlib import Path
import sqlite3
import subprocess
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
                with patch.object(vigilante.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
                    with self.assertRaisesRegex(ValueError, 't_test'):
                        self.check(dry_run=False)
                    self.assertEqual(run.call_count, 1)
                    self.assertEqual(run.call_args.args[0][6:8], ['reclaim', 't_valid'])

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


    def test_failed_reclaim_does_not_continue_to_block(self):
        self.db.execute("INSERT INTO task_events VALUES ('t_test', 'reclaimed', 'vigilar-limites: anterior')")
        failure = subprocess.CompletedProcess([], 1)
        with patch.object(vigilante.subprocess, 'run', return_value=failure) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                self.check(dry_run=False)
            self.assertEqual(run.call_count, 1)

    def test_successful_reclaim_is_bounded_and_precedes_escalation(self):
        self.db.execute("INSERT INTO task_events VALUES ('t_test', 'reclaimed', 'vigilar-limites: anterior')")
        with patch.object(vigilante.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            self.assertTrue(self.check(dry_run=False)[0]['escalated'])
            self.assertEqual([call.args[0][6] for call in run.call_args_list], ['reclaim', 'block'])
            for call in run.call_args_list:
                self.assertEqual(call.args[0][:6], ['hermes', '-p', 'perfil', 'kanban', '--board', 'tablero'])
                self.assertGreater(call.kwargs['timeout'], 0)
                self.assertTrue(call.kwargs['check'])


    def test_boundary_reclaims_at_ceiling_not_before(self):
        self.assertEqual(self.check(now=799), [])
        self.assertEqual(self.check(now=800)[0]['elapsed_seconds'], 600)

    def test_terminal_and_bounded_tasks_are_not_reclaimed(self):
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


if __name__ == '__main__':
    unittest.main()
