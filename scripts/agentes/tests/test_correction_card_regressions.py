"""Pruebas aisladas: nunca tablero real, GitHub ni creación operacional."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import correction_card_trigger as trigger

SHA = 'a' * 40


class CorrectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / 'board.db'
        self.con = sqlite3.connect(self.db)
        self.addCleanup(self.con.close)
        self.con.executescript('CREATE TABLE tasks (id TEXT,title TEXT,body TEXT,status TEXT,assignee TEXT,branch_name TEXT,max_runtime_seconds INTEGER,created_at INTEGER,idempotency_key TEXT);'
                               'CREATE TABLE task_runs (id INTEGER,task_id TEXT,profile TEXT,metadata TEXT,summary TEXT,started_at INTEGER,ended_at INTEGER,outcome TEXT,max_runtime_seconds INTEGER DEFAULT 300);'
                               'CREATE TABLE task_events (id INTEGER,task_id TEXT,run_id INTEGER,kind TEXT,payload TEXT,created_at INTEGER);')
        self.cr = trigger.ChangesRequested(331, SHA, 't_review', 12, {'medium': 2}, 'Informe preciso en comentario 99', 200)
        self.guard = patch.object(trigger.subprocess, 'run', side_effect=AssertionError('E/S externa no sustituida'))
        self.guard.start()
        self.addCleanup(self.guard.stop)

    @unittest.skipUnless(hasattr(os, 'fork'), 'exclusión real requiere fork POSIX')
    def test_concurrent_invocation_cannot_create_while_lock_is_held(self):
        with patch.object(trigger, 'EXECUTION_LOCK', self.root/'global.lock'), \
             patch.object(trigger, '_run_tick', side_effect=AssertionError('segundo escritor')):
            with trigger.execution_lock():
                pid = os.fork()
                if pid == 0:
                    try:
                        with contextlib.redirect_stdout(io.StringIO()):
                            result = trigger.main([])
                        os._exit(0 if result == 0 else 2)
                    except BaseException:
                        os._exit(3)
                _, status = os.waitpid(pid, 0)
                self.assertEqual(os.waitstatus_to_exitcode(status), 0)

    def test_watcher_reuses_episode_eligibility_and_keeps_unknown_visible(self):
        spec = importlib.util.spec_from_file_location('correction_fixture_watch', SCRIPTS / 'estado-fabrica.py')
        watch = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(watch)
        with patch.object(watch, 'latest_changes_requested', return_value=([self.cr], 0)), \
             patch.object(watch, 'existing_correction_card', return_value=None, create=True), \
             patch.object(watch, 'assess_correction_episode', create=True) as assess:
            for status in ('consumed', 'active', 'terminal'):
                assess.return_value = {'status':status}
                self.assertEqual(watch.changes_requested_without_correction_card(20000), [])
            assess.return_value = {'status':'eligible'}
            self.assertEqual(watch.changes_requested_without_correction_card(20000)[0]['pr'], 331)
            for status in ('unknown', 'diverged'):
                assess.return_value = {'status':status, 'reason':'no comprobado'}
                self.assertIn('problem', watch.changes_requested_without_correction_card(20000)[0])

    def test_main_consumes_archived_episode_and_new_run_gets_one_card(self):
        created = []
        info = {'state': 'OPEN', 'headRefOid': SHA, 'headRefName': 'fix/fixture', 'title': 'fixture'}
        def create(cr, title, impl):
            tid = 't_fix_' + str(cr.review_run_id)
            self.con.execute('INSERT INTO tasks (id,title,status,idempotency_key) VALUES (?,?,?,?)',
                             (tid, 'Corregir PR #331: fixture', 'done', trigger.episode_key(cr)))
            self.con.commit()
            created.append(tid)
            return trigger.CreatedCard(cr.pr, tid, impl.assignee)
        with patch.object(trigger, 'BOARD_DB', self.db), patch.object(trigger, 'EXECUTION_LOCK', self.root/'trigger.lock', create=True), \
             patch.object(trigger, 'latest_changes_requested', return_value=([self.cr], 0)), \
             patch.object(trigger, 'pr_info', return_value=info), \
             patch.object(trigger, 'resolve_implementer', return_value=(trigger.Implementer('t_impl','lucia',300), None)), \
             patch.object(trigger, 'create_correction_card', side_effect=create), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(trigger.main([]), 0)
            self.con.execute("UPDATE tasks SET status='archived'")
            self.con.commit()
            self.assertEqual(trigger.main([]), 0)
            self.assertEqual(created, ['t_fix_12'])
            self.cr.review_run_id = 13
            self.assertEqual(trigger.main([]), 0)
            self.assertEqual(created, ['t_fix_12', 't_fix_13'])

    def test_creation_does_not_self_authorize_budget_and_passes_reasons(self):
        for budget in (None, 0, -1, True, 1800):
            with self.subTest(budget=budget), self.assertRaises(ValueError):
                trigger.create_correction_card(self.cr, 'fixture', trigger.Implementer('t_impl', 'lucia', budget))
        def run(cmd, **kwargs):
            self.assertNotIn('--override-ceiling-reason', cmd)
            self.assertEqual(cmd[cmd.index('--max-runtime')+1], '300')
            self.assertIn('--priority-reason', cmd)
            self.assertIn('--parent-reason', cmd)
            self.assertEqual(cmd[cmd.index('--idempotency-key')+1], 'correction-t_review-12')
            body = cmd[cmd.index('--body')+1]
            self.assertIn('Informe preciso en comentario 99', body)
            self.assertIn('t_review', body)
            return subprocess.CompletedProcess(cmd, 0, json.dumps({'id': 't_created'}))
        with patch.object(trigger.subprocess, 'run', side_effect=run):
            result = trigger.create_correction_card(self.cr, 'fixture', trigger.Implementer('t_impl', 'lucia', 300))
            self.assertEqual(result.task_id, 't_created')

    def test_provenance_does_not_use_current_assignee_or_future_handoff(self):
        self.con.execute("INSERT INTO tasks (id,title,status,assignee,branch_name,max_runtime_seconds) VALUES ('t_review','work','review','rafael','fix/fixture',300)")
        self.con.execute("INSERT INTO task_runs (id,task_id,profile,started_at,ended_at,outcome) VALUES (12,'t_review','alexis',150,200,'completed')")
        self.con.commit()
        impl, reason = trigger.resolve_implementer(self.cr, 'fix/fixture', db_path=self.db)
        self.assertIsNone(impl)  # incluso único candidato reasignado no acredita autor
        self.assertTrue(reason)
        self.con.execute("INSERT INTO task_runs (id,task_id,profile,started_at,ended_at,outcome) VALUES (10,'t_review','lucia',90,100,'review_requested')")
        self.con.execute("INSERT INTO task_events VALUES (1,'t_review',10,'review_requested',?,100)", (json.dumps({'implementer':'lucia'}),))
        # Una ronda posterior no debe cambiar el productor de este episodio.
        self.con.execute("INSERT INTO task_runs (id,task_id,profile,started_at,ended_at,outcome) VALUES (15,'t_review','andres',210,220,'review_requested')")
        self.con.execute("INSERT INTO task_events VALUES (2,'t_review',15,'review_requested',?,220)", (json.dumps({'implementer':'andres'}),))
        self.con.commit()
        impl, reason = trigger.resolve_implementer(self.cr, 'fix/fixture', db_path=self.db)
        self.assertIsNone(reason)
        self.assertIsNotNone(impl)
        self.assertEqual(impl.assignee, 'lucia')
        self.assertEqual(impl.task_id, 't_review')

    def test_episode_eligibility_shared_with_watcher(self):
        for state, head, expected in [('OPEN', SHA, 'eligible'), ('CLOSED', SHA, 'terminal'),
                                      ('MERGED', SHA, 'terminal'), ('OPEN', 'b' * 40, 'diverged')]:
            with self.subTest(state=state, head=head), patch.object(trigger, 'pr_info', return_value={
                    'state': state, 'headRefOid': head, 'headRefName': 'fix/fixture', 'title': 'fixture'}):
                result = trigger.assess_correction_episode(self.cr, db_path=self.db)
                self.assertEqual(result['status'], expected)
        with patch.object(trigger, 'pr_info', return_value=None):
            self.assertEqual(trigger.assess_correction_episode(self.cr, db_path=self.db)['status'], 'unknown')
        self.con.execute("INSERT INTO tasks (id,title,status,idempotency_key) VALUES ('t_old','Corregir PR #331','archived','correction-t_review-12')")
        self.con.commit()
        with patch.object(trigger, 'pr_info', side_effect=AssertionError('episodio ya consumido')):
            self.assertEqual(trigger.assess_correction_episode(self.cr, db_path=self.db)['status'], 'consumed')

    def test_episode_consumed_even_when_done_or_archived(self):
        for status in ('done', 'archived', 'blocked', 'running'):
            with self.subTest(status=status):
                self.con.execute('DELETE FROM tasks')
                self.con.execute('INSERT INTO tasks (id,title,status,idempotency_key) VALUES (?,?,?,?)',
                                 ('t_fix', 'Corregir PR #331', status, 'correction-t_review-12'))
                self.con.commit()
                self.assertEqual(trigger.episode_correction_card(self.cr, db_path=self.db), 't_fix')
                next_round = trigger.ChangesRequested(331, SHA, 't_review', 13, None, '', 201)
                self.assertIsNone(trigger.episode_correction_card(next_round, db_path=self.db))


if __name__ == '__main__':
    unittest.main()
