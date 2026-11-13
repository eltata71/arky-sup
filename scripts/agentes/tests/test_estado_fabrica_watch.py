"""Contrato no-agent: Bash real, HOME temporal e intérprete canónico simulado.

No ejecuta Hermes, modelos, cron ni el vigilante contra el host.
"""
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest

WRAPPER = Path(__file__).resolve().parents[1] / 'estado-fabrica-watch.sh'


class WatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.logs = self.root / '.hermes/logs'
        self.state = self.logs / 'estado-fabrica-watch.consecutive-failures'
        self.result = self.logs / 'estado-fabrica.json'
        interpreter = self.root / 'python-stub'
        interpreter.write_text(f'''#!{sys.executable}
import os
from pathlib import Path
import sys
if sys.argv[1:] == ['-c', 'import yaml']:
    sys.exit(int(os.environ.get('YAML_EXIT', '0')))
assert sys.argv[1:] == ['/home/tata/workspace/arky-sup/scripts/agentes/estado-fabrica.py']
result = Path.home() / '.hermes/logs/estado-fabrica.json'
if os.environ.get('PUBLISH', 'yes') == 'yes':
    result.parent.mkdir(parents=True, exist_ok=True)
    tmp = result.with_suffix('.tmp')
    tmp.write_text('{{"verdict": "ATENCION"}}')
    # Publicación atómica idéntica al canónico, incluso con el mismo mtime.
    os.utime(tmp, ns=(100000000000, 100000000000))
    os.replace(tmp, result)
print('ATENCION: hallazgo de prueba')
sys.exit(int(os.environ.get('CANONICAL_EXIT', '1')))
''')
        interpreter.chmod(0o700)
        # Sólo la copia de prueba cambia de intérprete; producción queda fijado.
        self.wrapper = self.root / 'watch.sh'
        self.wrapper.write_text(WRAPPER.read_text().replace(
            'INTERPRETER=/usr/bin/python3', f'INTERPRETER={shlex.quote(str(interpreter))}'))

    def run_watch(self, **env):
        return subprocess.run(['bash', str(self.wrapper)], text=True,
                              capture_output=True, timeout=10,
                              env={**os.environ, 'HOME': str(self.root), **env})

    def seed_result(self):
        self.logs.mkdir(parents=True)
        self.result.write_text('{"verdict": "ATENCION"}')
        os.utime(self.result, ns=(100000000000, 100000000000))

    def test_no_agent_valid_attention_is_cron_success_and_preserves_output(self):
        result = self.run_watch()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout, 'ATENCION: hallazgo de prueba\n')
        self.assertEqual(self.state.read_text(), '0\n')

    def test_ok_resets_existing_failures(self):
        self.logs.mkdir(parents=True)
        self.state.write_text('2\n')
        result = self.run_watch(CANONICAL_EXIT='0')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.state.read_text(), '0\n')

    def test_atomic_publication_with_same_timestamp_and_content_is_fresh(self):
        self.seed_result()
        result = self.run_watch(CANONICAL_EXIT='0')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_missing_publication_is_failure_even_with_exit_zero(self):
        result = self.run_watch(PUBLISH='no', CANONICAL_EXIT='0')
        self.assertEqual(result.returncode, 1)
        self.assertIn('no se actualizó', result.stdout)
        self.assertEqual(self.state.read_text(), '1\n')

    def test_unchanged_existing_publication_is_failure(self):
        self.seed_result()
        result = self.run_watch(PUBLISH='no')
        self.assertEqual(result.returncode, 1)
        self.assertIn('no se actualizó', result.stdout)

    def test_unexpected_canonical_exit_is_failure_even_if_published(self):
        result = self.run_watch(CANONICAL_EXIT='2')
        self.assertEqual(result.returncode, 1)
        self.assertIn('código 2', result.stdout)
        self.assertEqual(self.state.read_text(), '1\n')

    def test_first_preflight_failure_creates_state_directory(self):
        result = self.run_watch(YAML_EXIT='1')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.state.read_text(), '1\n')

    def test_three_failures_alert_and_persist(self):
        result = self.run_watch(YAML_EXIT='1')
        for _ in range(2):
            result = self.run_watch(YAML_EXIT='1')
        self.assertEqual(result.returncode, 1)
        self.assertIn('3 ticks seguidos', result.stdout)
        self.assertEqual(self.state.read_text(), '3\n')

    def test_unavailable_state_directory_is_explicit_failure(self):
        (self.root / '.hermes').write_text('not a directory')
        result = self.run_watch()
        self.assertEqual(result.returncode, 1)
        self.assertIn('no se pudo preparar', result.stderr)

    def test_failed_reset_write_is_explicit_failure(self):
        self.state.mkdir(parents=True)
        result = self.run_watch(CANONICAL_EXIT='0')
        self.assertEqual(result.returncode, 1)
        self.assertIn('no se pudo persistir', result.stderr)

    def test_failed_failure_counter_write_is_explicit_failure(self):
        self.state.mkdir(parents=True)
        result = self.run_watch(YAML_EXIT='1')
        self.assertEqual(result.returncode, 1)
        self.assertIn('no se pudo persistir', result.stderr)


if __name__ == '__main__':
    unittest.main()
