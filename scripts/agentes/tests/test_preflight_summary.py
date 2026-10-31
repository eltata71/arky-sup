"""Ejercita el resumen real del preflight sin GitHub ni mutaciones Git."""
from pathlib import Path
import subprocess
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'estado.sh'

class PreflightSummaryTests(unittest.TestCase):
    def run_summary(self, branches, merged='', warnings=0):
        source = SCRIPT.read_text()
        tail = source[source.index('echo "== Ramas remotas'):]
        prefix = 'set -euo pipefail\n'
        prefix += f'avis os={warnings}\n'.replace('avis os', 'avisos')
        prefix += 'FUSIONADAS=' + __import__('shlex').quote(merged) + '\n'
        prefix += 'git(){ printf "%s\\n" ' + ' '.join(__import__('shlex').quote(b) for b in branches) + '; }\n'
        return subprocess.run(['bash', '-c', prefix + tail],capture_output=True,text=True)

    def test_unmerged_last_branch_is_not_an_operational_error(self):
        result = self.run_summary(['main','merged','zzz-open'], 'merged')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Sin avisos.', result.stdout)

    def test_only_main_is_a_valid_empty_cleanup_list(self):
        result = self.run_summary(['main'])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('(0 ramas)', result.stdout)

    def test_real_warning_still_blocks(self):
        result = self.run_summary(['open'], warnings=1)
        self.assertEqual(result.returncode, 1)
        self.assertIn('1 aviso(s)',result.stdout)

if __name__ == '__main__':
    unittest.main()
