"""Contrato de la referencia de calibración: SQLite aislado y sólo lectura."""
import ast
import hashlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REFERENCE = Path(__file__).resolve().parents[1] / 'calibrar-redespacho.py.referencia'
REASON = 'SHA abcdef1 corrige el parser de scripts/agentes/estado.sh y verifica siete regresiones nuevas'


class CalibrationTests(unittest.TestCase):
    def calibrate(self, events, comments):
        with tempfile.TemporaryDirectory() as root:
            db = Path(root) / 'fixture.db'
            with sqlite3.connect(db) as con:
                con.executescript('CREATE TABLE tasks (id TEXT, title TEXT);'
                                  'CREATE TABLE task_events (id INTEGER,task_id TEXT,kind TEXT,created_at INTEGER,payload TEXT);'
                                  'CREATE TABLE task_runs (task_id TEXT,ended_at INTEGER);'
                                  'CREATE TABLE task_comments (id INTEGER,task_id TEXT,author TEXT,body TEXT,created_at INTEGER);')
                con.execute("INSERT INTO tasks VALUES ('t_fixture','Resolver bloqueo documentado')")
                for event_id, kind, timestamp in events:
                    con.execute('INSERT INTO task_events VALUES (?,\'t_fixture\',?,?,NULL)', (event_id, kind, timestamp))
                for i, (body, timestamp) in enumerate(comments):
                    con.execute('INSERT INTO task_comments VALUES (?,\'t_fixture\',\'operator\',?,?)', (i, body, timestamp))
            before = hashlib.sha256(db.read_bytes()).hexdigest()
            result = subprocess.run([sys.executable, '-B', str(REFERENCE), str(db)], text=True,
                                    capture_output=True, timeout=10, check=True)
            self.assertEqual(hashlib.sha256(db.read_bytes()).hexdigest(), before)
            return ast.literal_eval(result.stdout.splitlines()[0])

    def test_reopen_does_not_reuse_an_earlier_review_verdict_comment(self):
        actual = self.calibrate([(1, 'review_reopened', 100)],
                                [('CHANGES REQUESTED: '+REASON, 99)])
        self.assertEqual(actual, {(False, 'falla'): 1})

    def test_completed_resets_ordinal_and_previous_comment(self):
        actual = self.calibrate([(1, 'unblocked', 100), (2, 'completed', 110),
                                 (3, 'unblocked', 120)],
                                [('UNBLOCK: '+REASON, 99), ('UNBLOCK: '+REASON, 119)])
        self.assertEqual(actual, {(False, 'ok'): 2})

    def test_comment_prefix_belongs_to_its_manual_event(self):
        for kind, prefix, category in [
            ('unblocked', 'UNBLOCK:', 'ok'),
            ('review_reopened', 'CHANGES REQUESTED:', 'ok'),
            ('unblocked', 'CHANGES REQUESTED:', 'falla'),
            ('review_reopened', 'UNBLOCK:', 'falla'),
        ]:
            with self.subTest(kind=kind, prefix=prefix):
                timestamp = 99 if kind == 'unblocked' else 101
                actual = self.calibrate([(1, kind, 100)], [(prefix+' '+REASON, timestamp)])
                self.assertEqual(actual, {(False, category): 1})


if __name__ == '__main__':
    unittest.main()
