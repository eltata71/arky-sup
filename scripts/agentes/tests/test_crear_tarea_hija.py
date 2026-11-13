"""Ejercita crear-tarea-hija.sh de verdad (subproceso real, hermes falso)."""
from pathlib import Path
import os
import stat
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'crear-tarea-hija.sh'


class CrearTareaHijaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        fake_hermes = Path(self.tmp.name) / 'hermes'
        self.captured = Path(self.tmp.name) / 'captured.txt'
        # El hermes falso vuelca su argv y, si hay --body-file, el cuerpo que
        # recibiría de verdad -- así se puede comprobar byte a byte.
        fake_hermes.write_text(
            '#!/usr/bin/env bash\n'
            f'printf "%s\\n" "$@" > "{self.captured}"\n'
            'for ((i=1; i<=$#; i++)); do\n'
            '  if [ "${!i}" = "--body-file" ]; then\n'
            '    j=$((i+1))\n'
            f'    cp "${{!j}}" "{self.tmp.name}/body-recibido.txt"\n'
            '  fi\n'
            'done\n'
            'echo "Created t_fake (ready, assignee=x)"\n'
        )
        fake_hermes.chmod(fake_hermes.stat().st_mode | stat.S_IEXEC)
        self.env = dict(os.environ)
        self.env['PATH'] = f"{self.tmp.name}:{self.env['PATH']}"

    def run_script(self, *args):
        return subprocess.run(
            ['bash', str(SCRIPT), *args],
            capture_output=True, text=True, env=self.env,
        )

    BASE_OK = [
        '--parent', 't_padre', '--parent-reason', 'motivo del padre',
        '--max-runtime', '60', '--assignee', 'bob',
        '--priority', '5', '--priority-reason', 'motivo de la prioridad',
    ]

    def test_refuses_without_priority(self):
        args = [a for a in self.BASE_OK if a not in ('--priority', '5')]
        result = self.run_script(*args, '--', 'Titulo')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('falta --priority', result.stderr)

    def test_refuses_without_priority_reason(self):
        args = list(self.BASE_OK)
        i = args.index('--priority-reason')
        del args[i:i + 2]
        result = self.run_script(*args, '--', 'Titulo')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('falta --priority-reason', result.stderr)

    def test_refuses_without_parent_reason(self):
        args = [a for a in self.BASE_OK
                if a not in ('--parent-reason', 'motivo del padre')]
        result = self.run_script(*args, '--', 'Titulo')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('falta --parent-reason', result.stderr)

    def test_priority_must_be_integer(self):
        args = list(self.BASE_OK)
        args[args.index('5')] = 'alto'
        result = self.run_script(*args, '--', 'Titulo')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('--priority debe ser un entero', result.stderr)

    def test_missing_reason_value_names_the_right_flag_not_the_title(self):
        # Regresión del hallazgo de la revisión independiente del PR #310:
        # omitir el valor de --priority-reason no debe tragarse el '--' real
        # ni hacer que el error apunte al título en vez de a la bandera.
        args = [a for a in self.BASE_OK if a != 'motivo de la prioridad']
        result = self.run_script(*args, '--', 'Un Titulo Real')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('--priority-reason necesita un valor', result.stderr)
        self.assertNotIn("falta el título", result.stderr)

    def test_happy_path_sets_priority_and_writes_reasons_to_body(self):
        result = self.run_script(*self.BASE_OK, '--', 'Titulo real')
        self.assertEqual(result.returncode, 0, result.stderr)
        captured = (Path(self.tmp.name) / 'captured.txt').read_text()
        self.assertIn('--priority\n5', captured)
        self.assertIn('--parent\nt_padre', captured)
        body = (Path(self.tmp.name) / 'body-recibido.txt').read_text()
        self.assertIn('**Prioridad 5.** motivo de la prioridad', body)
        self.assertIn('**Depende de t_padre.** motivo del padre', body)

    def test_body_file_trailing_blank_lines_survive(self):
        # Regresión del hallazgo de la revisión independiente del PR #310:
        # `$(cat ...)` recortaba en silencio las líneas en blanco finales.
        original = Path(self.tmp.name) / 'cuerpo.txt'
        contenido = b'linea1\nlinea2\n\n\n\n'
        original.write_bytes(contenido)
        result = self.run_script(*self.BASE_OK, '--body-file', str(original),
                                  '--', 'Titulo real')
        self.assertEqual(result.returncode, 0, result.stderr)
        body = (Path(self.tmp.name) / 'body-recibido.txt').read_bytes()
        self.assertEqual(body.split(b'\n\n---\n\n', 1)[1], contenido + b'\n')

    def test_refuses_missing_body_file_without_calling_hermes(self):
        missing = Path(self.tmp.name) / 'no-existe.txt'
        result = self.run_script(*self.BASE_OK, '--body-file', str(missing),
                                 '--', 'Titulo real')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('--body-file', result.stderr)
        self.assertIn(str(missing), result.stderr)
        self.assertIn('No se crea ninguna tarea', result.stderr)
        self.assertFalse(self.captured.exists())

    def test_refuses_directory_body_file_without_calling_hermes(self):
        result = self.run_script(*self.BASE_OK, '--body-file', self.tmp.name,
                                 '--', 'Titulo real')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('--body-file', result.stderr)
        self.assertIn(self.tmp.name, result.stderr)
        self.assertIn('No se crea ninguna tarea', result.stderr)
        self.assertFalse(self.captured.exists())

    def test_temp_body_file_is_removed_after_success(self):
        result = self.run_script(*self.BASE_OK, '--', 'Titulo real')
        self.assertEqual(result.returncode, 0, result.stderr)
        captured = (Path(self.tmp.name) / 'captured.txt').read_text()
        lines = captured.splitlines()
        tmp_path = lines[lines.index('--body-file') + 1]
        self.assertFalse(Path(tmp_path).exists())


if __name__ == '__main__':
    unittest.main()
