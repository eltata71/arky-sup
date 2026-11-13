"""Capacidad CLI efectiva y estados de revisión, sin tocar perfiles/DB reales."""
import importlib.util
import json
import subprocess
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'estado-fabrica.py'
SPEC = importlib.util.spec_from_file_location('terminal_monitor', SCRIPT)
assert SPEC is not None and SPEC.loader is not None
monitor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(monitor)


class EffectiveTerminalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.profiles = root / 'profiles'
        (self.profiles / 'worker').mkdir(parents=True)
        self.db = root / 'board.db'
        with sqlite3.connect(self.db) as con:
            con.execute('CREATE TABLE tasks (id TEXT, title TEXT, assignee TEXT, status TEXT, workspace_kind TEXT)')
            for status in ['ready', 'todo', 'running', 'triage', 'scheduled', 'review', 'done', 'archived', 'blocked']:
                con.execute('INSERT INTO tasks VALUES (?,?,?,?,?)', (status, status, 'worker', status, 'worktree'))
        p = patch.object(monitor, 'PROFILES_DIR', self.profiles)
        p.start()
        self.addCleanup(p.stop)

    def find(self, cfg):
        (self.profiles / 'worker' / 'config.yaml').write_text(json.dumps(cfg))
        return monitor.profiles_missing_terminal_for_worktree_work({'fixture': self.db})

    @unittest.skipUnless(monitor.RUNTIME_PYTHON.is_file(), 'requiere runtime operacional para integración nativa')
    def test_default_and_composite_include_native_terminal(self):
        for cfg in [{}, {'platform_toolsets': {'cli': ['hermes-cli']}}, {'platform_toolsets': {'cli': ['terminal']}}]:
            with self.subTest(cfg=cfg):
                self.assertEqual(self.find(cfg), [])

    @unittest.skipUnless(monitor.RUNTIME_PYTHON.is_file(), 'requiere runtime operacional para integración nativa')
    def test_disabled_terminal_and_review_are_visible(self):
        result = self.find({'platform_toolsets': {'cli': ['terminal']}, 'agent': {'disabled_toolsets': ['terminal']}})
        self.assertEqual(len(result), 1)
        self.assertEqual(set(result[0]['tasks']), {'ready', 'todo', 'running', 'triage', 'scheduled', 'review'})

    @unittest.skipUnless(monitor.RUNTIME_PYTHON.is_file(), 'requiere runtime operacional para integración nativa')
    def test_explicit_absent_tool_and_empty_selection(self):
        for tools in [['file'], []]:
            with self.subTest(tools=tools):
                result = self.find({'platform_toolsets': {'cli': tools}})
                self.assertEqual(len(result), 1)
                self.assertIn('review', result[0]['tasks'])

    def test_resolver_error_is_not_capability_success(self):
        with patch.object(monitor.subprocess, 'run', side_effect=OSError('runtime unavailable')):
            result = self.find({'platform_toolsets': {'cli': ['terminal']}})
        self.assertEqual(len(result), 1)
        self.assertIn('no se pudo resolver', result[0]['problem'])

    def test_protocol_and_state_selection_without_runtime_dependency(self):
        before = self.db.read_bytes()
        response = subprocess.CompletedProcess([], 0, stdout='["file"]', stderr='')
        with patch.object(monitor.subprocess, 'run', return_value=response) as run:
            result = self.find({'platform_toolsets': {'cli': ['file']}})
        self.assertEqual(set(result[0]['tasks']), {'ready', 'todo', 'running', 'triage', 'scheduled', 'review'})
        self.assertEqual(self.db.read_bytes(), before)
        self.assertEqual(json.loads(run.call_args.kwargs['input']), {'platform_toolsets': {'cli': ['file']}})
        self.assertTrue(run.call_args.kwargs['check'])
        self.assertEqual(run.call_args.kwargs['timeout'], 20)

    def test_invalid_resolver_output_and_timeout_are_visible(self):
        for output in ['not json', '{}', '[3]']:
            response = subprocess.CompletedProcess([], 0, stdout=output, stderr='')
            with self.subTest(output=output), patch.object(monitor.subprocess, 'run', return_value=response):
                self.assertIn('no se pudo resolver', self.find({})[0]['problem'])
        with patch.object(monitor.subprocess, 'run', side_effect=subprocess.TimeoutExpired('runtime', 20)):
            self.assertIn('no se pudo resolver', self.find({})[0]['problem'])

    def test_missing_or_invalid_profile_is_visible(self):
        for raw in ['[invalid]', '\\xff']:
            (self.profiles / 'worker' / 'config.yaml').write_text(raw)
            result = monitor.profiles_missing_terminal_for_worktree_work({'fixture': self.db})
            self.assertIn('no se pudo resolver', result[0]['problem'])
        (self.profiles / 'worker' / 'config.yaml').unlink()
        self.assertIn('no se pudo resolver', monitor.profiles_missing_terminal_for_worktree_work({'fixture': self.db})[0]['problem'])


if __name__ == '__main__':
    unittest.main()
