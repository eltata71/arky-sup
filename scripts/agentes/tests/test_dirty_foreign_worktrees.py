"""Contrato de salida del preflight; nunca ejecuta el vigilante real."""
import importlib.util
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SOURCE = Path(os.environ.get('ARKY_ESTADO_MODULE', Path(__file__).resolve().parents[1] / 'estado-fabrica.py'))
spec = importlib.util.spec_from_file_location('estado_fixture', SOURCE)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DirtyWorktreeTests(unittest.TestCase):
    def run_result(self, stdout, returncode=0, stderr=''):
        with patch.object(module.subprocess, 'run', return_value=subprocess.CompletedProcess([], returncode, stdout, stderr)):
            return module.dirty_foreign_worktrees()

    def test_empty_success_is_not_a_clean_inventory(self):
        result = self.run_result('')
        self.assertTrue(result['check_failed'])

    def test_truncated_expected_exit_is_not_a_clean_inventory(self):
        result = self.run_result('== Worktrees\n', 1, 'gh unavailable')
        self.assertTrue(result['check_failed'])

    def test_unexpected_exit_is_visible_even_with_complete_output(self):
        result = self.run_result('== Worktrees\nSin avisos.\n', 2, 'fetch failed')
        self.assertIn('exit 2', result['check_failed'])

    def test_execution_failure_and_timeout_are_visible(self):
        for error in [OSError('missing'), subprocess.TimeoutExpired('bash', 120)]:
            with self.subTest(error=type(error).__name__), patch.object(module.subprocess, 'run', side_effect=error):
                self.assertTrue(module.dirty_foreign_worktrees()['check_failed'])

    def test_complete_clean_inventory(self):
        self.assertEqual(self.run_result('== Worktrees\nSin avisos.\n'), {'items': [], 'check_failed': None})

    def test_machine_record_preserves_spaces_without_human_prose(self):
        result = self.run_result('== Worktrees\nWORKTREE_AJENO_SUCIO\tantigua\t/home/fixture/otra tarea\nSin avisos.\n')
        self.assertEqual(result, {'items': [{'estado': 'antigua', 'ruta': '/home/fixture/otra tarea'}], 'check_failed': None})

    def test_valid_warning_exit_keeps_foreign_inventory(self):
        result = self.run_result('== Worktrees\nWORKTREE_AJENO_SUCIO\tfusionada\t/fixture/foreign\n1 aviso(s): bloqueado\n', 1)
        self.assertIsNone(result['check_failed'])
        self.assertEqual(result['items'][0]['estado'], 'fusionada')


if __name__ == '__main__':
    unittest.main()
